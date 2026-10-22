/* 夏夜老屋 M2 — loader.js
 * manifest 获取 + GLB 加载 + __RM_PROGRESS 进度事件。
 * M5 接烘焙图集：applyBaked(mesh, atlas) 已留接口（当前空实现）。
 */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function report(loaded, total) {
  window.dispatchEvent(new CustomEvent("__RM_PROGRESS", {
    detail: { loaded: loaded | 0, total: total | 0 }
  }));
}

export async function fetchManifest(base) {
  const url = new URL("manifest.json", base).href;
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
  const gltf = await loader.loadAsync(new URL(glb, base).href, (ev) => {
    if (ev && ev.lengthComputable) report(ev.loaded, ev.total);
    else report(ev ? ev.loaded : 0, 0);
  });
  report(1, 1);
  console.log("[RM] manifest:", manifest.version || "?", "· glb:", glb,
    "· generator:", manifest.generator || "?");
  return { gltf, manifest };
}

/* M5 接口：mesh 换烘焙 shader 材质 + 挂图集。M2 不动 mesh。 */
export function applyBaked(mesh, atlas) {
  return mesh;
}
