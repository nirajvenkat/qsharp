// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-unused-vars */

/* TODO:

- Show the state vector / 'pretty' linear combination
- Show the equations from state vector to bloch angles
- Show as a history running below the gates using LaTeX
- Calculate the T / H gates for an arbitrary point
- Animiate the axes (including for H) when rotating
  - Maybe add a new geo/mesh for axis with rotation arrow that rotates with the qubit
  - Could also use as the X, Y, Z axis anyway with a blade screw on the top
- Show the matrix to be applied when hovering over a gate
- Add the trailing dots with a slider for history and fade out speed

[1] To show the state vector
- Add the complex vector / matrix library
- Map the gate options to matrices
- Start in (1, 0) state
- When a gate is applied, apply to the state vector, save to a list
- Render the matrix multiplication
[2] Add function to convert C^2 to bloch angles
[3] Show (and verify) the state vector to bloch angles

To convert basis coeffeicients a & b into a point on the Bloch sphere:
 - Calculate the angle theta = 2 * acos(magnitute(a))
 - Calculate the angle phi = arg(b) - arg(a), normalized to [0, 2 * PI)
*/

import { useEffect, useRef, useState } from "preact/hooks";

import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshBasicMaterialParameters,
  MeshLambertMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  WireframeGeometry,
} from "three";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

import {
  AppliedGate,
  Rotations,
  Ket0,
  cplx,
  vec2,
  PauliX,
  PauliY,
  PauliZ,
  SGate,
  TGate,
  Hadamard,
} from "../src/cplx.js";

const colors = {
  sphereColor: 0x404080,
  sphereBrightness: 2,
  sphereOpacity: 0.5,
  directionalLightBrightness: 0.25,
  markerColor: 0xc00000,
  sphereLinesOpacity: 0.2,
};

const fontMap = {
  helvetiker: 0,
  optimer: 1,
  gentilis: 2,
  "droid/droid_sans": 3,
  "droid/droid_serif": 4,
};

const weightMap = {
  regular: 0,
  bold: 1,
};

const gateLaTeX = {
  X: "\\begin{bmatrix} 0 & 1 \\\\ 1 & 0 \\end{bmatrix}",
  Y: "\\begin{bmatrix} 0 & -i \\\\ i & 0 \\end{bmatrix}",
  Z: "\\begin{bmatrix} 1 & 0 \\\\ 0 & -1 \\end{bmatrix}",
  S: "\\begin{bmatrix} 1 & 0 \\\\ 0 & e^{i {\\pi \\over 2}} \\end{bmatrix}",
  T: "\\begin{bmatrix} 1 & 0 \\\\ 0 & e^{i {\\pi \\over 4}} \\end{bmatrix}",
  H: "{1 \\over \\sqrt{2}} \\begin{bmatrix} 1 & 1 \\\\ 1 & -1 \\end{bmatrix}",
};

// See https://gizma.com/easing/#easeInOutSine
function easeInOutSine(x: number) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

function easeOutSine(x: number) {
  return Math.sin((x * Math.PI) / 2);
}

function hslToRgb(h: number, s: number, l: number) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  return (
    (Math.min(r * 255, 255) << 16) |
    (Math.min(g * 255, 255) << 8) |
    Math.min(b * 255, 255)
  );
}

function hueToRgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function createText(scene: Scene, done: () => void) {
  const loader = new FontLoader();
  const fontMat = new MeshBasicMaterial({ color: 0x606080, opacity: 1 });
  loader.load("fonts/helvetiker_regular.typeface.json", (font) => {
    const fontProps = {
      font,
      size: 0.6,
      height: 0.01,
      bevelThickness: 0.075,
      bevelSize: 0.01,
      bevelEnabled: true,
    };
    const xGeo = new TextGeometry("x", fontProps);
    const yGeo = new TextGeometry("y", fontProps);
    const zGeo = new TextGeometry("z", fontProps);

    const xMesh = new Mesh(xGeo, fontMat);
    const yMesh = new Mesh(yGeo, fontMat);
    const zMesh = new Mesh(zGeo, fontMat);
    xGeo.computeBoundingBox();
    yGeo.computeBoundingBox();
    zGeo.computeBoundingBox();

    xMesh.position.set(
      -0.5 * (xGeo.boundingBox!.max.x - xGeo.boundingBox!.min.x),
      -0.5 * (xGeo.boundingBox!.max.y - xGeo.boundingBox!.min.y),
      6.4,
    );
    yMesh.position.set(
      6.4,
      -0.5 * (xGeo.boundingBox!.max.y - xGeo.boundingBox!.min.y),
      0,
    );

    zMesh.position.set(
      -0.5 * (zGeo.boundingBox!.max.x - zGeo.boundingBox!.min.x),
      6.4,
      0,
    );
    scene.add(xMesh);
    scene.add(yMesh);
    scene.add(zMesh);
    done();
  });
}

const rotationTimeMs = 750;

class BlochRenderer {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  qubit: Group;
  trail: Group;
  animationCallbackId = 0;
  gateQueue: AppliedGate[] = [];
  rotations: Rotations;

  constructor(canvas: HTMLCanvasElement) {
    this.rotations = new Rotations(64);

    // For VS Code, WebView body attribute 'data-vscode-theme-kind' will contain 'light' if light theme is active.
    // Note: The value is usually 'vscode-light' or 'vscode-dark', but high-contrast dark is just 'vscode-high-contrast',
    // whereas the light high contract theme is 'vscode-high-contrast-light'.
    // Default to 'light' if the attribute is not present. (e.g. in the Playground)
    const isLight = (
      document.body.getAttribute("data-vscode-theme-kind") ?? "light"
    ).includes("light");

    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });

    const scene = new Scene();
    const camera = new PerspectiveCamera(
      30, // fov
      1, // aspect
      0.1, // near
      1000, // far
    );

    // In WebGL, Z is towards the camera (viewer looking towards -Z), Y is up, X is right
    // Position slightly towards the X and Y axis to give a 'canonical' view
    camera.position.x = 4;
    camera.position.y = 4;
    camera.position.z = 27;
    camera.lookAt(0, 0, 0);

    const light = new DirectionalLight(
      0xffffff,
      colors.directionalLightBrightness,
    );
    light.position.set(-1, 2, 4);
    scene.add(light);

    // Note that the orbit controls move the camera, they don't rotate the
    // scene, so the X, Y, and Z axis for the Bloch sphere remain fixed.
    const controls = new OrbitControls(camera, renderer.domElement);

    // Create a group to hold the qubit
    const qubit = new Group();

    // Add the main sphere
    const sphereGeometry = new SphereGeometry(5, 32, 16);
    const material = new MeshLambertMaterial({
      emissive: colors.sphereColor,
      emissiveIntensity: colors.sphereBrightness,
      transparent: true,
      opacity: colors.sphereOpacity,
    });
    const sphere = new Mesh(sphereGeometry, material);
    qubit.add(sphere);

    // Add the 'spin' direction marker
    const coneGeometry = new ConeGeometry(0.2, 0.75, 32);
    const coneMat = new MeshBasicMaterial({ color: colors.markerColor });
    const marker = new Mesh(coneGeometry, coneMat);
    marker.position.set(0, 5.125, 0.4);
    marker.rotateX(Math.PI / 2);
    qubit.add(marker);

    // Draw the wires on it
    const sphereWireGeometry = new SphereGeometry(5.1, 16, 16);
    const wireframe = new WireframeGeometry(sphereWireGeometry);
    const sphereLines = new LineSegments(wireframe);
    const materialProps = sphereLines.material as MeshBasicMaterialParameters;
    materialProps.depthTest = true;
    materialProps.opacity = colors.sphereLinesOpacity;
    materialProps.transparent = true;
    qubit.add(sphereLines);
    scene.add(qubit);

    // Create a group to hold the trailing points
    const trail = new Group();
    scene.add(trail);

    // Add the axes
    const axisMaterial = new MeshBasicMaterial({ color: 0xe0d0c0 });
    const zAxis = new CylinderGeometry(0.075, 0.075, 12, 32, 8);
    const zAxisMesh = new Mesh(zAxis, axisMaterial);
    scene.add(zAxisMesh);

    const zPointer = new ConeGeometry(0.2, 0.8, 16);
    const zPointerMesh = new Mesh(zPointer, axisMaterial);
    zPointerMesh.position.set(0, 6, 0);
    scene.add(zPointerMesh);

    const yAxisMesh = new Mesh(zAxis, axisMaterial);
    yAxisMesh.rotateZ(Math.PI / 2);
    scene.add(yAxisMesh);
    const yPointerMesh = new Mesh(zPointer, axisMaterial);
    yPointerMesh.position.set(6, 0, 0);
    yPointerMesh.rotateZ(-Math.PI / 2);
    scene.add(yPointerMesh);

    const xAxisMesh = new Mesh(zAxis, axisMaterial);
    xAxisMesh.rotateX(Math.PI / 2);
    scene.add(xAxisMesh);
    const xPointerMesh = new Mesh(zPointer, axisMaterial);
    xPointerMesh.position.set(0, 0, 6);
    xPointerMesh.rotateX(Math.PI / 2);
    scene.add(xPointerMesh);

    // See https://threejs.org/manual/#en/rendering-on-demand
    controls.addEventListener("change", () =>
      requestAnimationFrame(() => this.render()),
    );

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.qubit = qubit;
    this.trail = trail;

    // Initial render after text is ready
    createText(scene, () => this.render());
  }

  queueGate(gate: AppliedGate) {
    this.gateQueue.push(gate);
    if (this.animationCallbackId) return; // Queue is already running

    // Close over these values for the running queue
    let currentGate: AppliedGate | undefined;
    let startTime = 0;

    const processQueue = () => {
      if (!currentGate) {
        currentGate = this.gateQueue.shift();
        if (!currentGate) {
          // Queue was empty. Done
          this.animationCallbackId = 0;
          return;
        } else {
          startTime = performance.now();
        }
      }

      // Calculate the percent of rotation time elapsed from start to now
      const x = (performance.now() - startTime) / rotationTimeMs;

      // Ease the rotation
      const t = x < 1 ? easeInOutSine(x) : 1;

      // Rotate the qubit to the correct position
      const currentRotation = this.rotations.getRotationAtPercent(
        currentGate,
        t,
      );

      currentRotation.path.forEach((val) => {
        // Draw any that don't already have a point
        if (val.ref) return;
        const trackGeo = new SphereGeometry(0.05, 16, 16);
        const trackBall = new Mesh(
          trackGeo,
          new MeshBasicMaterial({ color: 0x808080 }),
        );
        trackBall.position.set(0, 5, 0);

        // Conver to world space
        trackBall.position.applyQuaternion(val.pos);

        // Save along with the interpolation point
        this.trail.add(trackBall);
        val.ref = trackBall;
      });

      // Set qubit position to slerped values
      this.qubit.quaternion.copy(currentRotation.pos);

      // Fade out the path trail as needed
      this.trail.children.forEach((child, idx, arr) => {
        const ball = child as Mesh;
        const sat = easeOutSine((idx + 1) / arr.length);
        const color = hslToRgb(0.6, sat, 0.5);
        ball.material = new MeshBasicMaterial({ color });
        ball.scale.setScalar(sat + 0.5);
      });

      this.render();

      // If that gate is done, unset it
      if (t >= 1) currentGate = undefined;

      this.animationCallbackId = requestAnimationFrame(processQueue);
    };

    // Kick off processing
    processQueue();
  }

  rotateX(angle: number) {
    this.queueGate(this.rotations.rotateX(angle));
  }

  rotateY(angle: number) {
    this.queueGate(this.rotations.rotateY(angle));
  }

  rotateZ(angle: number) {
    this.queueGate(this.rotations.rotateZ(angle));
  }

  rotateH(angle: number) {
    this.queueGate(this.rotations.rotateH(angle));
  }

  reset() {
    this.controls.reset();
    this.rotations.reset();
    this.trail.clear();
    this.scene.position.set(0, 0, 0);
    this.qubit.rotation.set(0, 0, 0);
    this.camera.position.set(4, 4, 27);
    this.camera.lookAt(0, 0, 0);
    this.render();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

export function BlochSphere(props: {
  gates?: string[];
  renderLaTeX: (nodes: HTMLElement[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<BlochRenderer | null>(null);
  const latexDiv = useRef<HTMLDivElement>(null);

  const [gates, setGates] = useState<string[]>(props.gates || []);
  const [gateArray, setGateArray] = useState<string[]>([]);
  const [state, setState] = useState(Ket0);

  useEffect(() => {
    if (canvasRef.current) {
      renderer.current = new BlochRenderer(canvasRef.current);
    }
  }, []);

  useEffect(() => {
    if (latexDiv.current) {
      props.renderLaTeX([latexDiv.current]);
    }
  }, [gates]);

  const getLaTeX = (
    gateName: string,
    gateMatrix: string,
    oldState: string,
    newState: string,
  ) => `$$ ${gateName} | \\psi \\rangle =
  ${gateMatrix}
  \\cdot ${oldState}
  = ${newState}
  $$`;

  function rotate(gate: string): void {
    let newState = vec2(state);
    if (renderer.current) {
      switch (gate) {
        case "X":
          renderer.current.rotateX(Math.PI);
          newState = PauliX.mulVec2(state);
          setGateArray([
            ...gateArray,
            getLaTeX("X", gateLaTeX.X, state.toLaTeX(), newState.toLaTeX()),
          ]);
          break;
        case "Y":
          renderer.current.rotateY(Math.PI);
          newState = PauliY.mulVec2(state);
          setGateArray([
            ...gateArray,
            getLaTeX("Y", gateLaTeX.Y, state.toLaTeX(), newState.toLaTeX()),
          ]);
          break;
        case "Z":
          renderer.current.rotateZ(Math.PI);
          newState = PauliZ.mulVec2(state);
          setGateArray([
            ...gateArray,
            getLaTeX("Z", gateLaTeX.Z, state.toLaTeX(), newState.toLaTeX()),
          ]);
          break;
        case "S":
          renderer.current.rotateZ(Math.PI / 2);
          newState = SGate.mulVec2(state);
          setGateArray([
            ...gateArray,
            getLaTeX("S", gateLaTeX.S, state.toLaTeX(), newState.toLaTeX()),
          ]);
          break;
        case "T":
          renderer.current.rotateZ(Math.PI / 4);
          newState = TGate.mulVec2(state);
          setGateArray([
            ...gateArray,
            getLaTeX("T", gateLaTeX.T, state.toLaTeX(), newState.toLaTeX()),
          ]);
          break;
        case "H":
          renderer.current.rotateH(Math.PI);
          newState = Hadamard.mulVec2(state);
          setGateArray([
            ...gateArray,
            getLaTeX("H", gateLaTeX.H, state.toLaTeX(), newState.toLaTeX()),
          ]);
          break;
        default:
          console.error("Unknown gate: " + gate);
      }
    }
    setState(newState);
    setGates([...gates, gate]);
  }

  function reset() {
    setGates([]);
    setGateArray([]);
    setState(vec2(Ket0));
    if (renderer.current) {
      renderer.current.reset();
    }
  }

  return (
    <div style="position: relative;">
      <canvas ref={canvasRef} width="600" height="600"></canvas>
      <div
        ref={latexDiv}
        style="position: absolute; left: 600px; top: 50px; height: 500px; min-width: 200px; background: #eee;overflow-y: scroll;"
      >
        {gateArray.map((str) => (
          <div style="border-bottom: 1px dotted gray; text-align: left">
            {str}
          </div>
        ))}
      </div>
      <div>{"Applied: " + gates.join(", ")}</div>
      <div class="qs-gate-buttons">
        <button type="button" onClick={() => rotate("X")}>
          X
        </button>
        <button type="button" onClick={() => rotate("Y")}>
          Y
        </button>
        <button type="button" onClick={() => rotate("Z")}>
          Z
        </button>
        <button type="button" onClick={() => rotate("S")}>
          S
        </button>
        <button type="button" onClick={() => rotate("T")}>
          T
        </button>
        <button type="button" onClick={() => rotate("H")}>
          H
        </button>
        <button type="button" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}
