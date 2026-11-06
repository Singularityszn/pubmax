// The real 3D Pub Pal, rendered frame by frame.
//
// It draws the same model the app ships (public/brand/pals, copied into
// public/models) with the scene the app's own renderer sets up in
// components/pal/originalPalMeshRenderer.mjs: the model turned a quarter so it
// faces the camera, a 40-degree camera 1.9 units back, a soft ambient light, a
// white key light and the cyan rim light. Only the pose is the video's own,
// and it is a pure function of the frame, so every render is the same.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** A pose in degrees and model units, as the app's head loop uses. */
export type PalPose = { yaw: number; pitch: number; roll: number; lift: number; scale: number };

type PalModel3DProps = {
  /** Model file, relative to video/launch/public. */
  src?: string;
  /** Canvas size in video pixels. The canvas is square. */
  size: number;
  /** The pose for a frame inside the parent sequence. */
  pose: (frame: number) => PalPose;
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;

type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  poseGroup: THREE.Group;
};

export function PalModel3D({ src = "models/circuit-robin.glb", size, pose }: PalModel3DProps) {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const [handle] = useState(() => delayRender(`Pal model ${src}`, { timeoutInMilliseconds: 60000 }));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const renderer = new THREE.WebGLRenderer({
      canvas: element,
      alpha: true,
      antialias: true,
      // Remotion reads the canvas after React commits, so the frame must stay
      // in the drawing buffer until it is captured.
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    // The app's scene, constant for constant.
    const scene = new THREE.Scene();
    const poseGroup = new THREE.Group();
    const originalOrientation = new THREE.Group();
    originalOrientation.rotation.y = -Math.PI / 2;
    poseGroup.add(originalOrientation);
    scene.add(poseGroup);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 20);
    camera.position.set(0, 0, 1.9);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 0.65);
    key.position.set(2, 3, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x83ebf0, 0.6);
    rim.position.set(-2, 1, -2);
    scene.add(rim);

    let cancelled = false;
    const loader = new GLTFLoader();
    fetch(staticFile(src))
      .then((response) => {
        if (!response.ok) throw new Error(`Cannot load ${src}`);
        return response.arrayBuffer();
      })
      .then((bytes) => loader.parseAsync(bytes, ""))
      .then(async (gltf) => {
        if (cancelled) return;
        originalOrientation.add(gltf.scene);
        // Wait until every texture image has decoded, so frame 0 is textured.
        const images: Promise<unknown>[] = [];
        gltf.scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          for (const material of materials) {
            for (const value of Object.values(material)) {
              const image = (value as THREE.Texture | undefined)?.isTexture ? (value as THREE.Texture).image : null;
              if (image instanceof HTMLImageElement && !image.complete) {
                images.push(new Promise((resolve) => image.addEventListener("load", resolve, { once: true })));
              }
            }
          }
        });
        await Promise.all(images);
        renderer.compile(scene, camera);
        stage.current = { renderer, scene, camera, poseGroup };
        setReady(true);
        continueRender(handle);
      })
      .catch((error: unknown) => cancelRender(error));
    return () => {
      cancelled = true;
      renderer.dispose();
    };
  }, [handle, size, src]);

  useLayoutEffect(() => {
    const current = stage.current;
    if (!ready || !current) return;
    const { yaw, pitch, roll, lift, scale } = pose(frame);
    current.poseGroup.rotation.set(radians(pitch), radians(yaw), radians(roll));
    current.poseGroup.position.y = lift;
    current.poseGroup.scale.setScalar(scale);
    current.renderer.render(current.scene, current.camera);
  }, [frame, pose, ready]);

  return <canvas ref={canvas} width={size} height={size} style={{ width: size, height: size, display: "block" }} />;
}
