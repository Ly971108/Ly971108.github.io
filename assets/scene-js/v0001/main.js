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

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 60);
/* M11 清晰度: 默认机位收紧(原 4.7m 全景 → 3.5m), 道具细节更可读
 * M11e: FOV 35→45 + 默认 4.0m, 视野更开阔
 * 球坐标环绕: 中键拖拽转方向, 滚轮推拉(见下方监听) */
const CAM_TARGET = new THREE.Vector3(-0.35, 1.0, -0.25);
let camTheta = Math.atan2(0.62, 0.69);                       /* 水平方位角 */
let camPolar = Math.acos(0.11 / Math.hypot(0.62, 0.11, 0.69)); /* 极角(自 +Y) */
let camDist = 4.0;
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
  camDist = Math.min(5.0, Math.max(1.2, camDist * (1 + ev.deltaY * 0.0012)));
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

      /* M11d: 窗外夜景可读性 —— GLTF 自发光弱+ACES 压暗, 剪影风格统一提亮
       * (GLB 根节点无名, 按 outside_ 前缀收集) */
      const outsideMeshes = [];
      scene.traverse(function (o) { if (o.isMesh && /^outside_/.test(o.name || "")) outsideMeshes.push(o); });
      outsideMeshes.forEach(function (o) {
        const m = o.material, n = (o.name || "").toLowerCase();
        if (m.color) m.emissive.copy(m.color);
        if (n.indexOf("halo") >= 0) {
          /* 光晕贴图 alpha 未随 GLB 生效 → 变灰板挡月亮; 改加色混合成辉光 */
          m.transparent = true; m.depthWrite = false;
          m.blending = THREE.AdditiveBlending;
          if (m.map) m.alphaMap = m.map;
          m.emissiveIntensity = 1.0;
          /* 悬到山前(原 x=14 被三层山脊全挡): 近窗天空挂月+辉光 */
          o.position.set(8.56, -0.2, 3.1);
          o.scale.setScalar(0.55);
          return;
        }
        if (n === "outside_sky") {
          /* Blender ColorRamp 未随 GLTF 导出 → 灰板; 运行时定深蓝夜色 */
          m.color.setHex(0x0a1226);
          m.emissive.setHex(0x0a1226);
          m.emissiveIntensity = 1.0;
          return;
        }
        if (n === "outside_moon") {
          m.emissiveIntensity = 2.4;
          o.position.set(8.5, -0.2, 3.1);
          o.scale.setScalar(0.9);
          return;
        }
        m.emissiveIntensity =
          n.indexOf("moon") >= 0 ? 2.4 :
          n.indexOf("stars") >= 0 ? 1.8 :
          n.indexOf("sky")  >= 0 ? 0.35 :
          n.indexOf("mtn_far")  >= 0 ? 0.70 :
          n.indexOf("mtn_mid")  >= 0 ? 0.55 :
          n.indexOf("mtn_near") >= 0 ? 0.45 :
          n.indexOf("tree") >= 0 ? 0.5 :
          n.indexOf("path") >= 0 ? 0.6 :
          n.indexOf("ground") >= 0 ? 0.35 :
          n.indexOf("insu") >= 0 ? 0.8 :
          n.indexOf("pole") >= 0 ? 0.5 : 0.5;
      });

      /* M11e: 窗外加料 —— 补星 ×260、山脚村灯火、夜云两片(无光照材质, 2 draw calls)
       * 坐标注意: three 里 y=上, z=横(= -Blender_y); 窗外纵深是 +x */
      const rng = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20261023);
      const starPos = new Float32Array(260 * 3), starCol = new Float32Array(260 * 3);
      for (let i = 0; i < 260; i++) {
        starPos[i * 3] = 11 + rng() * 6.5;          /* 纵深 x */
        starPos[i * 3 + 1] = 1.0 + rng() * 5.8;     /* 高 y(Blender z) */
        starPos[i * 3 + 2] = -7.5 + rng() * 15;     /* 横 z(= -Blender y) */
        const b = 0.35 + rng() * 0.65, blue = rng() < 0.3;
        starCol[i * 3] = b * (blue ? 0.62 : 1.0);
        starCol[i * 3 + 1] = b * (blue ? 0.76 : 1.0);
        starCol[i * 3 + 2] = b;
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
      starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
      scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
        size: 0.045, vertexColors: true, sizeAttenuation: false,
        transparent: true, opacity: 0.9, depthWrite: false
      })));

      /* 村灯火: 远山脚下可见 ground 条带上的暖黄小点(避开山脊遮挡: x<12.3, 低z) */
      const vilPos = [], vilCol = [];
      for (let i = 0; i < 20; i++) {
        const warm = 0.8 + rng() * 0.2;
        /* y=高 1.1–2.1(高于窗台投影线), z=横; x=纵深 8.6–9.9(远山脚前) */
        vilPos.push(8.6 + rng() * 1.3, 1.1 + rng() * 1.0, -5.0 + rng() * 10);
        vilCol.push(1.0 * warm, 0.62 * warm, 0.25 * warm);
      }
      const vilGeo = new THREE.BufferGeometry();
      vilGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vilPos), 3));
      vilGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(vilCol), 3));
      scene.add(new THREE.Points(vilGeo, new THREE.PointsMaterial({
        size: 3.5, vertexColors: true, sizeAttenuation: false,
        transparent: true, opacity: 1.0, depthWrite: false
      })));

      /* 夜云两片: 程序柔边云团(canvas 径向渐变簇), 挂在山脊上方 */
      const cloudTex = (function () {
        const c = document.createElement("canvas");
        c.width = 256; c.height = 64;
        const g = c.getContext("2d");
        for (let i = 0; i < 7; i++) {
          const x = 36 + i * 31, y = 34 + Math.sin(i * 1.7) * 8, r = 17 + (i % 3) * 8;
          const grad = g.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, "rgba(255,255,255,0.55)");
          grad.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        }
        return new THREE.CanvasTexture(c);
      })();
      const cloudMat = new THREE.MeshBasicMaterial({
        color: 0x2a3a5f, map: cloudTex, transparent: true, opacity: 0.5, depthWrite: false
      });
      [[13.2, 4.4, 5.0, 5.0, 0.05], [14.8, -4.2, 5.4, 6.0, -0.04]].forEach(function (c) {
        const cloud = new THREE.Mesh(new THREE.PlaneGeometry(c[3], c[3] * 0.25), cloudMat);
        cloud.position.set(c[0], c[2], -c[1]);       /* (纵深x, 高, 横z) */
        cloud.position.set(c[0], c[1], c[2]);
        cloud.rotation.y = -Math.PI / 2;
        cloud.rotation.z = c[4] * 0.15;
        scene.add(cloud);
      });
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
