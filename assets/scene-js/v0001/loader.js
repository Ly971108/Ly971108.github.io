/* 夏夜老屋 M2 — loader.js
 * manifest 获取 + GLB 加载 + __RM_PROGRESS 进度事件。
 * M5：loadBaked(base, manifest) 载烘焙图集 + scene_static.glb 并按图集组合并（4 draw calls）。
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bakedLightShader, bakedState } from "./materials.js";

function report(loaded, total) {
  window.dispatchEvent(new CustomEvent("__RM_PROGRESS", {
    detail: { loaded: loaded | 0, total: total | 0 }
  }));
}

function resolve(base, name) {
  return new URL(name, new URL(base, document.baseURI)).href;
}

export async function fetchManifest(base) {
  const url = resolve(base, "manifest.json");
  const r = await fetch(url);
  if (!r.ok) throw new Error("manifest.json HTTP " + r.status);
  return r.json();
}

/* 返回 { gltf, manifest }。manifest 契约见 tools/blender/export.py（Blender 侧）：
 * { version, glb, units:"m", camera:{fov,position,target}, budget:{drawCalls,tris}, baked:null } */
export async function loadRoom(base) {
  const manifest = await fetchManifest(base);
  const glb = manifest.glb || "room.glb";
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(resolve(base, glb), (ev) => {
    if (ev && ev.lengthComputable) report(ev.loaded, ev.total);
    else report(ev ? ev.loaded : 0, 0);
  });
  report(1, 1);
  console.log("[RM] manifest:", manifest.version || "?", "· glb:", glb,
    "· generator:", manifest.generator || "?");
  return { gltf, manifest };
}

/* M5：加载烘焙资产包。
 * 返回 { group, hideNames, bakedState, groups }：
 *  - group：按图集组合并后的 4 个 mesh（baked_<group>）
 *  - hideNames：静态 mesh 名集合（原 room.glb / props/*.glb 里的同名 mesh 要隐藏）
 *  - bakedState：共享灯态 {lampState, tvColor}（M6 交互直接改 value）
 * manifest.baked = { static, uv2map, groups: {shell|furniture|walldeco|bedding: {color,irrA,irrB,irrC} } }
 */
export async function loadBaked(base, manifest) {
  const b = manifest.baked;
  if (!b || !b.static || !b.groups) return null;

  const uv2 = await (await fetch(resolve(base, b.uv2map))).json();

  /* 16 张图集纹理：PNG 均经 Blender Standard(sRGB) 编码 -> 全部按 sRGB 采样解码回线性。
   * GLB 几何 flipY=false 与图集方向配对。 */
  const texLoader = new THREE.TextureLoader();
  const groups = {};
  for (const [g, files] of Object.entries(b.groups)) {
    const t = {};
    for (const k of ["color", "irrA", "irrB", "irrC"]) {
      const tex = await texLoader.loadAsync(resolve(base, files[k]));
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 16;                          /* M11d: 各向异性拉满(1650 支持) */
      t["map" + k.charAt(0).toUpperCase() + k.slice(1)] = tex;
    }
    groups[g] = { material: bakedLightShader(t), meshes: (uv2.atlases[g] || {}).meshes || [] };
  }

  const gltf = await new GLTFLoader().loadAsync(resolve(base, b.static));

  /* mesh 名 -> 图集组；缺组的静态 mesh 保留原样并告警（不合并） */
  const name2group = {};
  for (const [g, info] of Object.entries(groups))
    for (const n of uv2.atlases[g].meshes) name2group[n] = g;

  const hideNames = new Set();
  const toMerge = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    hideNames.add(o.name);
    const g = name2group[o.name];
    if (!g) { console.warn("[RM] baked 静态 mesh 无图集组:", o.name); return; }
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    /* 属性一致性归一：合并只保留 position/normal/uv/uv1 */
    for (const name of Object.keys(geo.attributes))
      if (!["position", "normal", "uv", "uv1"].includes(name)) geo.deleteAttribute(name);
    (toMerge[g] = toMerge[g] || []).push(geo);
  });

  const group = new THREE.Group();
  group.name = "baked_static";
  for (const [g, geos] of Object.entries(toMerge)) {
    const merged = mergeGeometries(geos, false);
    if (!merged) { console.warn("[RM] 图集组合并失败:", g, "（保留未合并）"); continue; }
    const mesh = new THREE.Mesh(merged, groups[g].material);
    mesh.name = "baked_" + g;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  console.log("[RM] baked merged meshes:", group.children.map((m) => m.name).join(", ") || "NONE");
  return { group, hideNames, bakedState, groups };
}

/* M3：按 manifest.props 名列表加载道具 GLB（props/<name>.glb），返回 [{name, scene}] */
export async function loadProps(base, names) {
  const loader = new GLTFLoader();
  const out = [];
  for (const name of names || []) {
    try {
      const gltf = await loader.loadAsync(resolve(base, "props/" + name + ".glb"));
      out.push({ name, scene: gltf.scene });
      report(out.length, (names || []).length);
    } catch (e) {
      console.warn("[RM] prop 加载失败（忽略）:", name, e && e.message);
    }
  }
  return out;
}
