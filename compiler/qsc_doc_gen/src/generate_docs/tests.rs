// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

#![allow(clippy::needless_raw_string_hashes)]

use super::generate_docs;
use expect_test::expect;
use qsc_data_structures::language_features::LanguageFeatures;
use qsc_frontend::compile::TargetCapabilityFlags;

#[test]
fn docs_generation() {
    let files = generate_docs(
        None,
        TargetCapabilityFlags::all(),
        LanguageFeatures::default(),
    );
    let (_, metadata, contents) = files
        .iter()
        .find(|(file_name, _, _)| &**file_name == "Microsoft.Quantum.Core/Length.md")
        .expect("Could not file doc file for Length");
    let full_contents = format!("{metadata}\n\n{contents}");

    expect![[r#"
        ---
        uid: Qdk.Microsoft.Quantum.Core.Length
        title: Length function
        ms.date: {TIMESTAMP}
        ms.topic: managed-reference
        qsharp.kind: function
        qsharp.namespace: Microsoft.Quantum.Core
        qsharp.name: Length
        qsharp.summary: "Returns the number of elements in the input array `a`."
        ---

        # Length function

        Namespace: Microsoft.Quantum.Core

        ```qsharp
        function Length<'T>(a : 'T[]) : Int
        ```

        ## Summary
        Returns the number of elements in the input array `a`.

        ## Input
        ### a
        Input array.

        ## Output
        The total number of elements in the input array `a`.

        ## Example
        ```qsharp
        Message($"{ Length([0, 0, 0]) }"); // Prints 3
        ```
    "#]]
    .assert_eq(full_contents.as_str());
}
