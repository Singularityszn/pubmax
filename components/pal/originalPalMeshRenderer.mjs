import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const REST = { yaw: 0, pitch: 0, roll: 0, lean: 0, lift: 0, scale: 1 };
const radians = (degrees) => degrees * Math.PI / 180;

function disposeModel(model) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  model.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const own = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of own) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    texture.source?.data?.close?.();
    texture.dispose();
  }
}

// The existing Pal pose loop owns time, voice reads and visibility. This surface
// only draws a supplied pose, so it cannot create a second animation loop.
export function mountOriginalPalMesh(host, { modelUrl, onStatus }) {
  const controller = new AbortController();
  let disposed = false;
  let contextLost = false;
  let model = null;
  let lastPose = REST;
  let yaw = 0;
  let drag = null;
  let lastDraw = -Infinity;
  let visible = true;
  let renderer;
  let loadTimer = 0;
  let resourceFailed = false;
  const manager = new THREE.LoadingManager();
  manager.onError = () => { resourceFailed = true; };
  const loader = new GLTFLoader(manager);
  // Embedded GLB images use img-src blob:, already allowed by the product CSP.
  // ImageBitmapLoader would fetch the blob under the stricter connect-src.
  loader.register((parser) => ({
    name: "PUBMAX_original_textures",
    loadTexture(index) {
      const texture = parser.json.textures[index];
      return parser.loadTextureImage(index, texture.source, new THREE.TextureLoader(manager));
    },
  }));
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

  function status(value) {
    if (!disposed) onStatus(value);
  }

  function draw(now = performance.now(), force = false) {
    if (disposed || contextLost || !model || !visible || document.hidden) return false;
    if (!force && now - lastDraw < 1000 / 30) return false;
    poseGroup.rotation.set(radians(lastPose.pitch), yaw + radians(lastPose.yaw), radians(lastPose.roll));
    poseGroup.position.y = lastPose.lift / 500;
    poseGroup.position.z = lastPose.lean / 500;
    poseGroup.scale.setScalar(lastPose.scale);
    renderer.render(scene, camera);
    lastDraw = now;
    return true;
  }

  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    status("graphics-unavailable");
    return { renderPose() { return false; }, setYaw() {}, turnYaw() {}, endDrag() {}, setVisible() {}, dispose() { disposed = true; controller.abort(); } };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;width:100%;height:100%;visibility:hidden;touch-action:pan-y";
  host.prepend(canvas);
  status("loading");

  function resize() {
    if (disposed) return;
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    renderer.setSize(box.width, box.height, false);
    camera.aspect = box.width / box.height;
    camera.updateProjectionMatrix();
    draw(performance.now(), true);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  function lost(event) {
    event.preventDefault();
    contextLost = true;
    canvas.style.visibility = "hidden";
    status("graphics-lost");
  }
  function restored() {
    if (disposed) return;
    contextLost = false;
    resize();
    if (draw(performance.now(), true)) {
      canvas.style.visibility = "visible";
      status("ready");
    }
  }
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);

  function pointerDown(event) {
    if (!model || contextLost) return;
    drag = { id: event.pointerId, x: event.clientX, yaw };
    canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    yaw = drag.yaw + (event.clientX - drag.x) * 0.012;
    draw(performance.now());
  }
  function pointerEnd() { drag = null; }
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerEnd);
  canvas.addEventListener("pointercancel", pointerEnd);

  loadTimer = setTimeout(() => {
    status("model-unavailable");
    dispose();
  }, 10_000);

  void fetch(modelUrl, { signal: controller.signal, credentials: "omit" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Model read unavailable");
      const bytes = await response.arrayBuffer();
      if (disposed) return null;
      return loader.parseAsync(bytes, new URL(".", new URL(modelUrl, location.href)).href);
    })
    .then((gltf) => {
      clearTimeout(loadTimer);
      if (!gltf) return;
      if (disposed) { disposeModel(gltf.scene); return; }
      // GLTFLoader can resolve with a null map after an image failure.
      // A partial, untextured model must never replace the original artwork.
      if (resourceFailed) { disposeModel(gltf.scene); throw new Error("Model texture unavailable"); }
      model = gltf.scene;
      originalOrientation.add(model);
      resize();
      if (draw(performance.now(), true)) {
        canvas.style.visibility = "visible";
        status("ready");
      }
    })
    .catch(() => {
      clearTimeout(loadTimer);
      if (!disposed) {
        status("model-unavailable");
        dispose();
      }
    });

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(loadTimer);
    controller.abort();
    resizeObserver.disconnect();
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeEventListener("webglcontextrestored", restored);
    canvas.removeEventListener("pointerdown", pointerDown);
    canvas.removeEventListener("pointermove", pointerMove);
    canvas.removeEventListener("pointerup", pointerEnd);
    canvas.removeEventListener("pointercancel", pointerEnd);
    if (model) disposeModel(model);
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }

  return {
    renderPose(pose, now) {
      lastPose = pose;
      return draw(now);
    },
    setYaw(degrees) {
      yaw = radians(degrees);
      draw(performance.now(), true);
    },
    endDrag() {
      // A drag begun before the photograph took the frame keeps its pointer
      // capture, which pointer-events: none does not revoke, so end it here.
      if (!drag) return;
      if (canvas.hasPointerCapture?.(drag.id)) canvas.releasePointerCapture(drag.id);
      drag = null;
    },
    turnYaw(degrees) {
      yaw += radians(degrees);
      draw(performance.now(), true);
    },
    setVisible(next) {
      visible = next;
      if (next && model && !contextLost && draw(performance.now(), true)) {
        canvas.style.visibility = "visible";
        status("ready");
      }
    },
    dispose,
  };
}
