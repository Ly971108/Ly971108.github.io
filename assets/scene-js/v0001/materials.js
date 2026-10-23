/* 夏夜老屋 M2 — materials.js
 * 白模材质预设 + M5 烘焙光照 shader 骨架。
 * M5 接入：bakedLightShader(textures) 挂真图集（mapColor/mapIrrA/mapIrrB/mapIrrC）。
 */
import * as THREE from "three";

/* 无材质 mesh 的默认白模 */
export function makeWhite() {
  return new THREE.MeshStandardMaterial({
    color: 0xf2f0ea,
    roughness: 0.92,
    metalness: 0.0
  });
}

/* 命名含 stub 的占位 mesh：半透明蓝 */
export function makeStub() {
  return new THREE.MeshStandardMaterial({
    color: 0x4f8ff7,
    roughness: 0.5,
    metalness: 0.0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
  });
}

/* sky_plane：黑色 emissive 占位（M5 换星空） */
export function makeSky() {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0x000000,
    roughness: 1.0,
    metalness: 0.0
  });
}

/* ---------- M5 烘焙混合 shader ---------- */

/* 跨图集共享的运行时灯态：M6 拉线灯/电视改这里即全场景生效 */
export const bakedState = {
  lampState: { value: 1.0 },                       /* 0=黄昏 1=夜灯 */
  tvColor:   { value: new THREE.Vector3(0, 0, 0) } /* TV 白光强度 RGB */
};

/* 烘焙几何取 TEXCOORD_1（Blender UV2 打包层）；ShaderMaterial 需手动声明 uv1 */
const BAKED_VERT = /* glsl */`
attribute vec2 uv1;
varying vec2 vUv;
void main() {
  vUv = uv1;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* 方案：light = mix(irrC, irrA, lampState) + irrB * tvColor
 * irrA=拉线灯+月光  irrB=仅 TV 白光  irrC=黄昏窗光；pow(3.0) 压暗低光区。
 * 图集 PNG 经 Blender Standard(sRGB) 编码保存 -> 四图均按 sRGB 采样自动解码为线性；
 * ShaderMaterial 不带输出编码, 结尾手动 linear->sRGB。 */
const BAKED_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D mapColor;
uniform sampler2D mapIrrA;
uniform sampler2D mapIrrB;
uniform sampler2D mapIrrC;
uniform float lampState;
uniform vec3 tvColor;
void main() {
  vec3 base  = texture2D(mapColor, vUv).rgb;
  /* M11c: 对比度 3.0→1.8 —— 原曲线把中间调压成棕泥(用户实拍反馈看不清),
   * 1.8 保留夜灯反差同时暗部细节可读 */
  vec3 lamps = pow(texture2D(mapIrrA, vUv).rgb, vec3(1.8));
  vec3 tv    = pow(texture2D(mapIrrB, vUv).rgb, vec3(1.8));
  vec3 dusk  = pow(texture2D(mapIrrC, vUv).rgb, vec3(1.8));
  vec3 light = mix(dusk, lamps, clamp(lampState, 0.0, 1.0)) + tv * tvColor;
  /* M9-P2: 黄昏态环境光地板（随 lampState 淡出），避免 lampState=0 时背光面全黑死。
   * 地板只作用于黄昏——夜间保持纯烘焙，像素基线零扰动。 */
  float duskAmt = 1.0 - clamp(lampState, 0.0, 1.0);
  light = max(light, vec3(0.05) * duskAmt);
  /* M11: 整幅烘焙曝光 ×1.35(线性域), 暗部可读且保住夜灯氛围 */
  gl_FragColor = vec4(pow(base * light * 1.35, vec3(0.4545)), 1.0);
}
`;

function blankTex() {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/* textures = {mapColor, mapIrrA, mapIrrB, mapIrrC}（同组图集纹理）；
 * lampState/tvColor 引用共享 bakedState，全图集同步切换 */
export function bakedLightShader(textures = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      mapColor:  { value: textures.mapColor || blankTex() },
      mapIrrA:   { value: textures.mapIrrA  || blankTex() },
      mapIrrB:   { value: textures.mapIrrB  || blankTex() },
      mapIrrC:   { value: textures.mapIrrC  || blankTex() },
      lampState: bakedState.lampState,
      tvColor:   bakedState.tvColor
    },
    vertexShader: BAKED_VERT,
    fragmentShader: BAKED_FRAG
  });
}
