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

/* ---------- M5 烘焙混合 shader 骨架 ---------- */

const BAKED_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* 方案：light = mix(irrC, irrA, lampState) + irrB * tvColor
 * irrA=拉线灯+月光  irrB=仅 TV 白光  irrC=黄昏窗光；pow(3.0) 压暗低光区 */
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
  vec3 lamps = pow(texture2D(mapIrrA, vUv).rgb, vec3(3.0));
  vec3 tv    = pow(texture2D(mapIrrB, vUv).rgb, vec3(3.0));
  vec3 dusk  = pow(texture2D(mapIrrC, vUv).rgb, vec3(3.0));
  vec3 light = mix(dusk, lamps, clamp(lampState, 0.0, 1.0)) + tv * tvColor;
  gl_FragColor = vec4(base * light, 1.0);
}
`;

function blankTex() {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/* M5：textures = {mapColor, mapIrrA, mapIrrB, mapIrrC}（均为图集纹理） */
export function bakedLightShader(textures = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      mapColor:  { value: textures.mapColor || blankTex() },
      mapIrrA:   { value: textures.mapIrrA  || blankTex() },
      mapIrrB:   { value: textures.mapIrrB  || blankTex() },
      mapIrrC:   { value: textures.mapIrrC  || blankTex() },
      lampState: { value: 1.0 },
      tvColor:   { value: new THREE.Vector3(0, 0, 0) }
    },
    vertexShader: BAKED_VERT,
    fragmentShader: BAKED_FRAG
  });
}
