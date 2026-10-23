/* 夏夜老屋 M2 — main.js（ES module 入口）
 * renderer(antialias, ACESFilmic, SRGB) + Scene + 固定机位(35°)
 * GLB 白模加载遍历 → rAF 主循环（enter 后启动）→ resize → __RM_SCENE 调试暴露。
 */
import * as THREE from "three";
import { loadRoom, loadProps, loadBaked } from "./loader.js";
import { makeWhite, makeStub, makeSky } from "./materials.js";
import { initRouter } from "./router.js";
import { initPerf } from "./perf.js";
import { initScreen } from "./screen.js";
import { initPanel } from "./panel.js";
import { initInteract } from "./interact.js";
import { initAnim } from "./anim.js";
import { initAudio } from "./audio.js";

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
renderer.toneMappingExposure = 1.18;             /* M11: 提亮ACES压暗, 暗部细节可读 */
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080d);

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
/* M11 清晰度: 默认机位收紧(原 4.7m 全景 → 3.5m), 道具细节更可读
 * 球坐标环绕: 中键拖拽转方向, 滚轮推拉(见下方监听) */
const CAM_TARGET = new THREE.Vector3(-0.35, 1.0, -0.25);
let camTheta = Math.atan2(0.62, 0.69);                       /* 水平方位角 */
let camPolar = Math.acos(0.11 / Math.hypot(0.62, 0.11, 0.69)); /* 极角(自 +Y) */
let camDist = 3.5;
function applyCam() {
  const sp = Math.sin(camPolar);
  camera.position.set(
    CAM_TARGET.x + camDist * sp * Math.sin(camTheta),
    CAM_TARGET.y + camDist * Math.cos(camPolar),
    CAM_TARGET.z + camDist * sp * Math.cos(camTheta)
  );
  camera.lookAt(CAM_TARGET);
}
applyCam();

/* 滚轮推拉(2.0–5.0m), 面板打开时不响应 */
addEventListener("wheel", (ev) => {
  if (document.querySelector(".rm-panel-overlay:not([hidden])")) return;
  if (!started) return;
  camDist = Math.min(5.0, Math.max(2.0, camDist * (1 + ev.deltaY * 0.0012)));
  applyCam();
}, { passive: true });

/* M11b: 鼠标中键按住环绕查看房间布局(极角钳制防穿地/翻天) */
let orbiting = false, orbitX = 0, orbitY = 0;
renderer.domElement.addEventListener("mousedown", (ev) => {
  if (ev.button !== 1) return;
  ev.preventDefault();                           /* 阻止自动滚动 */
  orbiting = true; orbitX = ev.clientX; orbitY = ev.clientY;
});
addEventListener("mousemove", (ev) => {
  if (!orbiting) return;
  camTheta -= (ev.clientX - orbitX) * 0.005;
  camPolar = Math.min(1.70, Math.max(0.5, camPolar - (ev.clientY - orbitY) * 0.005));
  orbitX = ev.clientX; orbitY = ev.clientY;
  applyCam();
});
addEventListener("mouseup", (ev) => { if (ev.button === 1) orbiting = false; });

/* M2 临时灯光（M5 烘焙接入后降为微光仅供可动道具，M6 再定稿动态道具照明） */
const hemiLight = new THREE.HemisphereLight(0xbfd0e0, 0x30281f, 0.9);
scene.add(hemiLight);
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
let interact = null, animApi = null, audioApi = null;
let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = lastT ? Math.min(t - lastT, 100) : 16;
  lastT = t;
  if (interact) interact.tick(dt);
  if (animApi) animApi.tick(dt, t);
  if (audioApi) audioApi.tick(dt);
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
      const hasOutside = props.some(p => p.name === "outside");
      room.traverse(function (o) {
        if (!o.isMesh) return;
        const n = (o.name || "").toLowerCase();
        if (/_stub$/i.test(n)) o.visible = false;
        if (hasOutside && n.indexOf("sky_plane") >= 0) o.visible = false; /* outside 模块自带天空 */
      });
      for (const p of props) {
        p.scene.traverse(function (o) {
          if (o.isMesh && !o.material) o.material = makeWhite();
        });
        scene.add(p.scene);
      }
    }

    /* M5：烘焙静态包。就位后隐藏 room/props 里的同名静态 mesh（防双重渲染）。
     * 临时灯降为微光：烘焙几何自发光无需照明，仅可动道具（旋钮/屏幕/灯泡）需要。 */
    const baked = await loadBaked(GLB_BASE, manifest);
    if (baked) {
      scene.add(baked.group);
      const hide = baked.hideNames;
      const hideStatic = (r) => r.traverse(function (o) {
        if (o.isMesh && hide.has(o.name)) o.visible = false;
      });
      hideStatic(room);
      for (const p of props) hideStatic(p.scene);
      keyLight.intensity = 0.18;
      hemiLight.intensity = 0.32;
      window.__RM_BAKED = baked;
    }

    /* M6：CRT 屏幕 + 阅读面板 + 交互（缺模块时降级不阻断） */
    let screenApi = null, panelApi = null;
    try { screenApi = initScreen(scene); } catch (e) { console.warn("[RM] screen 初始化失败:", e && e.message); }
    try { panelApi = initPanel(); } catch (e) { console.warn("[RM] panel 初始化失败:", e && e.message); }
    interact = initInteract({ scene, camera, renderer, baked, screen: screenApi, panel: panelApi });
    window.__RM_SCREEN = screenApi;
    window.__RM_PANEL_API = panelApi;
    if (panelApi) window.__RM_OPEN_POST = (url) => panelApi.openPost(url);

    /* M7/M8：氛围动画 + 声音（缺模块/无声卡静默降级） */
    try { animApi = initAnim({ scene: scene, bakedState: baked ? baked.bakedState : null }); }
    catch (e) { console.warn("[RM] anim 初始化失败:", e && e.message); }
    try { audioApi = initAudio(); } catch (e) { console.warn("[RM] audio 初始化失败:", e && e.message); }
    window.__RM_ANIM = animApi;
    window.__RM_AUDIO = audioApi;

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
