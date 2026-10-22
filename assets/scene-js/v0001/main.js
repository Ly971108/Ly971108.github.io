/* 夏夜老屋 M2 — main.js（ES module 入口）
 * renderer(antialias, ACESFilmic, SRGB) + Scene + 固定机位(35°)
 * GLB 白模加载遍历 → rAF 主循环（enter 后启动）→ resize → __RM_SCENE 调试暴露。
 */
import * as THREE from "three";
import { loadRoom, loadProps } from "./loader.js";
import { makeWhite, makeStub, makeSky } from "./materials.js";
import { initRouter } from "./router.js";
import { initPerf } from "./perf.js";

const root = document.getElementById("rm-root");
/* data-scene-glb（camel）或 data-sceneglb 均可；缺省 assets/scene/v0001/ */
const GLB_BASE = (root && (root.dataset.sceneGlb || root.dataset.sceneglb)) || "assets/scene/v0001/";

const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: true,
  powerPreference: "high-performance"
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080d);

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
camera.position.set(2.9, 1.55, 3.1);
camera.lookAt(-0.3, 1.05, -0.2);

/* M2 临时灯光（M5 由烘焙 shader 替换，届时删除） */
scene.add(new THREE.HemisphereLight(0xbfd0e0, 0x30281f, 0.9));
const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.1);
keyLight.position.set(2.5, 3.5, 2.0);
scene.add(keyLight);

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
addEventListener("resize", resize);
resize();

const perf = initPerf(renderer);
initRouter();

let started = false;
function frame() {
  requestAnimationFrame(frame);
  renderer.render(scene, camera);
  perf.tick();
}

function start() {
  if (started) return;
  started = true;
  frame();
}

(async function init() {
  try {
    const out = await loadRoom(GLB_BASE);
    const room = out.gltf.scene;
    const manifest = out.manifest || {};

    room.traverse(function (o) {
      if (!o.isMesh) return;
      const n = (o.name || "").toLowerCase();
      if (n.indexOf("sky_plane") >= 0) o.material = makeSky();
      else if (n.indexOf("stub") >= 0) o.material = makeStub();
      else if (!o.material) o.material = makeWhite();
    });
    scene.add(room);

    /* M3：道具 GLB 叠加加载；道具就位后隐藏对应占位盒 */
    const props = await loadProps(GLB_BASE, manifest.props);
    if (props.length) {
      room.traverse(function (o) {
        if (o.isMesh && /_stub$/i.test(o.name || "")) o.visible = false;
      });
      for (const p of props) {
        p.scene.traverse(function (o) {
          if (o.isMesh && !o.material) o.material = makeWhite();
        });
        scene.add(p.scene);
      }
    }

    /* manifest 可带固定机位（Blender 侧导出），缺省用上方 fallback */
    const c = manifest.camera;
    if (c) {
      if (Array.isArray(c.position) && c.position.length === 3) camera.position.fromArray(c.position);
      if (Array.isArray(c.target) && c.target.length === 3) camera.lookAt(c.target[0], c.target[1], c.target[2]);
      if (c.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
    }

    renderer.render(scene, camera);
    const info = renderer.info.render;
    console.log("[RM] draw calls:", info.calls, "· tris:", info.triangles);
    const b = manifest.budget;
    if (b) {
      if (b.drawCalls && info.calls > b.drawCalls) console.warn("[RM] draw calls 超预算:", info.calls, ">", b.drawCalls);
      if (b.tris && info.triangles > b.tris) console.warn("[RM] tris 超预算:", info.triangles, ">", b.tris);
    }

    window.__RM_SCENE = { scene: scene, camera: camera, renderer: renderer, manifest: manifest };

    addEventListener("__RM_ENTER", start);
    if (window.__RM_ENTERED) start(); /* 极端时序：enter 早于 READY */

    window.dispatchEvent(new CustomEvent("__RM_READY"));
  } catch (e) {
    console.error("[RM] init failed:", e);
    if (window.__RM_FAIL) window.__RM_FAIL(e && e.message ? e.message : String(e));
  }
})();
