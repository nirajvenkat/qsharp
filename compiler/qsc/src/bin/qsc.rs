// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

allocator::assign_global!();

use clap::{crate_version, ArgGroup, Parser, ValueEnum};
use log::info;
use miette::{Context, IntoDiagnostic, Report};
use qsc::compile::compile;
use qsc_codegen::qir_base;
use qsc_data_structures::{language_features::LanguageFeatures, target::TargetCapabilityFlags};
use qsc_frontend::{
    compile::{PackageStore, SourceContents, SourceMap, SourceName},
    error::WithSource,
};
use qsc_hir::hir::{Package, PackageId};
use qsc_passes::PackageType;
use qsc_project::{FileSystem, Manifest, StdFs};
use std::rc::Rc;
use std::{
    concat, fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::ExitCode,
    string::String,
};

#[derive(Debug, Parser)]
#[command(version = concat!(crate_version!(), " (", env!("QSHARP_GIT_HASH"), ")"), arg_required_else_help(false))]
#[clap(group(ArgGroup::new("input").args(["entry", "sources"]).required(false).multiple(true)))]
struct Cli {
    /// Disable automatic inclusion of the standard library.
    #[arg(long)]
    nostdlib: bool,

    /// Emit the compilation unit in the specified format.
    #[arg(long, value_enum)]
    emit: Vec<Emit>,

    /// Write output to compiler-chosen filename in <dir>.
    #[arg(long = "outdir", value_name = "DIR")]
    out_dir: Option<PathBuf>,

    /// Enable verbose output.
    #[arg(short, long)]
    verbose: bool,

    /// Entry expression to execute as the main operation.
    #[arg(short, long)]
    entry: Option<String>,

    /// Q# source files to compile, or `-` to read from stdin.
    #[arg()]
    sources: Vec<PathBuf>,

    /// Path to a Q# manifest for a project
    #[arg(short, long)]
    qsharp_json: Option<PathBuf>,

    /// Language features to compile with
    #[arg(short, long)]
    features: Vec<String>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, ValueEnum)]
enum Emit {
    Hir,
    Qir,
}

fn main() -> miette::Result<ExitCode> {
    env_logger::init();
    let cli = Cli::parse();
    let mut store = PackageStore::new(qsc::compile::core());
    let mut dependencies = Vec::new();

    let (package_type, capabilities) = if cli.emit.contains(&Emit::Qir) {
        (PackageType::Exe, TargetCapabilityFlags::empty())
    } else {
        (PackageType::Lib, TargetCapabilityFlags::all())
    };

    if !cli.nostdlib {
        dependencies.push(store.insert(qsc::compile::std(&store, capabilities)));
    }

    let mut features = LanguageFeatures::from_iter(cli.features);

    let mut sources = cli
        .sources
        .iter()
        .map(read_source)
        .collect::<miette::Result<Vec<_>>>()?;

    let mut project_root_dir = None;
    if sources.is_empty() {
        let fs = StdFs;
        let manifest = Manifest::load(cli.qsharp_json)?;
        if let Some(manifest) = manifest {
            let project = fs.load_project(&manifest)?;
            let mut project_sources = project.sources;

            sources.append(&mut project_sources);

            features.merge(LanguageFeatures::from_iter(
                manifest.manifest.language_features,
            ));
            project_root_dir = Some(Rc::from(manifest.manifest_dir.to_string_lossy()));
        }
    }

    let entry = cli.entry.unwrap_or_default();
    let sources = SourceMap::new(sources, Some(entry.into()), project_root_dir);
    let (unit, errors) = compile(
        &store,
        &dependencies,
        sources,
        package_type,
        capabilities,
        features,
    );
    let package_id = store.insert(unit);
    let unit = store.get(package_id).expect("package should be in store");

    let out_dir = cli.out_dir.as_ref().map_or(".".as_ref(), PathBuf::as_path);
    for emit in &cli.emit {
        match emit {
            Emit::Hir => emit_hir(&unit.package, out_dir)?,
            Emit::Qir => {
                if errors.is_empty() {
                    emit_qir(out_dir, &store, package_id)?;
                }
            }
        }
    }

    if errors.is_empty() {
        Ok(ExitCode::SUCCESS)
    } else {
        for error in errors {
            eprintln!("{:?}", Report::new(error));
        }

        Ok(ExitCode::FAILURE)
    }
}

fn read_source(path: impl AsRef<Path>) -> miette::Result<(SourceName, SourceContents)> {
    let path = path.as_ref();
    if path.as_os_str() == "-" {
        let mut input = String::new();
        io::stdin()
            .read_to_string(&mut input)
            .into_diagnostic()
            .context("could not read standard input")?;

        Ok(("<stdin>".into(), input.into()))
    } else {
        let contents = fs::read_to_string(path)
            .into_diagnostic()
            .with_context(|| format!("could not read source file `{}`", path.display()))?;

        Ok((path.to_string_lossy().into(), contents.into()))
    }
}

fn emit_hir(package: &Package, dir: impl AsRef<Path>) -> miette::Result<()> {
    let path = dir.as_ref().join("hir.txt");
    info!(
        "Writing HIR output file to: {}",
        path.to_str().unwrap_or_default()
    );
    fs::write(&path, package.to_string())
        .into_diagnostic()
        .with_context(|| format!("could not emit HIR file `{}`", path.display()))
}

fn emit_qir(out_dir: &Path, store: &PackageStore, package_id: PackageId) -> Result<(), Report> {
    let path = out_dir.join("qir.ll");
    let result = qir_base::generate_qir(store, package_id);
    match result {
        Ok(qir) => {
            info!(
                "Writing QIR output file to: {}",
                path.to_str().unwrap_or_default()
            );
            fs::write(&path, qir)
                .into_diagnostic()
                .with_context(|| format!("could not emit QIR file `{}`", path.display()))
        }
        Err((error, _)) => {
            let unit = store.get(package_id).expect("package should be in store");
            Err(Report::new(WithSource::from_map(&unit.sources, error)))
        }
    }
}
