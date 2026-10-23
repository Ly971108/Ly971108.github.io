/* 夏夜老屋 M7 — anim.js（氛围动画模块）
 * 契约见 docs/m7-contracts.md。
 * 入口 initAnim({ scene, bakedState }) → { tick(dtMs, tMs) }。
 * 全部由现有 mesh/材质驱动：风扇自转+摇头、蚊香燃点呼吸+烟、窗外萤火虫、
 * 星星闪烁、蚊帐微动。无实时灯光、无阴影、无 per-frame 分配、新增 draw calls = 2（烟+萤火虫）。
 */
import * as THREE from "three";

/* ---------- 程序软圆点贴图（烟/萤火虫共用） ---------- */
function makeSoftDot() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.42)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.08)");
  grad.addColorStop(1.0, "rgba(255,255,255,0.0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* 点精灵共用 vertex shader：世界尺寸 → 像素尺寸，逐点透明度 */
const POINT_VERT = `
attribute float aAlpha;
attribute float aSize;
uniform float uPixelScale;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const SMOKE_FRAG = `
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const FIREFLY_FRAG = `
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * (0.55 + 0.45 * a), a);
}`;

export function initAnim({ scene, bakedState }) {
  if (!scene) throw new Error("initAnim: 缺少 scene");

  /* ---------- 目标网格发现（逐项缺失 warn + 跳过） ---------- */
  const findByName = (name) => scene.getObjectByName(name) || null;
  const findByRe = (re) => {
    let hit = null;
    scene.traverse((o) => { if (!hit && re.test(o.name || "")) hit = o; });
    return hit;
  };

  const blades = findByName("prop_fan_blades");
  if (!blades) console.warn("[RM] anim: 未找到 prop_fan_blades，风扇自转跳过");
  const head = findByName("prop_fan_head");
  if (!head) console.warn("[RM] anim: 未找到 prop_fan_head，风扇摇头跳过");
  const ember = findByName("prop_mosq_ember");
  if (!ember) console.warn("[RM] anim: 未找到 prop_mosq_ember，蚊香烟跳过");
  const bedNet = findByName("prop_bed_net");
  if (!bedNet) console.warn("[RM] anim: 未找到 prop_bed_net，蚊帐微动跳过");
  const stars = findByName("outside_stars") || findByRe(/stars/i);
  if (!stars) console.warn("[RM] anim: 未找到 outside_stars，星星闪烁跳过");

  /* 运行时状态（全部模块级，避免 per-frame 分配） */
  let fanOmega = 0;                                  /* 叶片角速度 rad/s（趋近目标） */
  let headAngle = 0;                                 /* 摇头当前角（缓动到目标） */
  let tickWarned = false;

  const scratchV = new THREE.Vector3();              /* 复用临时向量 */
  const lampRef = bakedState && bakedState.lampState ? bakedState.lampState : null;

  /* ---------- 蚊香烟：THREE.Points × 12 ---------- */
  const SMOKE_N = 12;
  const SMOKE_PERIOD = 6.0;                          /* 单粒烟完整上升周期 s */
  let smokePoints = null, smokePos = null, smokeAlpha = null, smokeSize = null;
  const emberBase = new THREE.Vector3();
  if (ember) {
    ember.updateWorldMatrix(true, false);
    ember.getWorldPosition(emberBase);
    const geo = new THREE.BufferGeometry();
    smokePos = new Float32Array(SMOKE_N * 3);
    smokeAlpha = new Float32Array(SMOKE_N);
    smokeSize = new Float32Array(SMOKE_N);
    geo.setAttribute("position", new THREE.BufferAttribute(smokePos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(smokeAlpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(smokeSize, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeSoftDot() },
        uColor: { value: new THREE.Color(0x8b95a4) },   /* 蚊香烟冷灰 */
        uPixelScale: { value: 620 },
      },
      vertexShader: POINT_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    smokePoints = new THREE.Points(geo, mat);
    smokePoints.name = "anim_mosq_smoke";
    smokePoints.frustumCulled = false;               /* 12 顶点，不值得算包围球 */
    smokePoints.renderOrder = 5;
    scene.add(smokePoints);
  }

  /* ---------- 窗外萤火虫：THREE.Points × 6 ---------- */
  /* 实际外景坐标（tools/blender/outside.py）：窗洞 x=2.0、y∈[-0.6,0.6]、z∈[0.9,2.3]，
   * 槐树 x≈6.0/y≈1.5/z≈2.2。萤火虫取窗与树之间庭院上空。 */
  const FLY_N = 6;
  let flyPoints = null, flyPos = null, flyAlpha = null, flySize = null;
  const flyBase = new Float32Array(FLY_N * 3);       /* 基准位置 */
  const flyPhase = new Float32Array(FLY_N);          /* 漂移/闪烁相位 */
  if (true) {
    const geo = new THREE.BufferGeometry();
    flyPos = new Float32Array(FLY_N * 3);
    flyAlpha = new Float32Array(FLY_N);
    flySize = new Float32Array(FLY_N);
    for (let i = 0; i < FLY_N; i++) {
      /* 预生成基准点：x∈[2.6,5.4] y∈[-1.2,1.6] z∈[0.8,2.6]，确定性伪随机 */
      const r = (k) => {
        const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      flyBase[i * 3 + 0] = 2.6 + r(1) * 2.8;
      flyBase[i * 3 + 1] = -1.2 + r(2) * 2.8;
      flyBase[i * 3 + 2] = 0.8 + r(3) * 1.8;
      flyPhase[i] = r(4) * Math.PI * 2;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(flyPos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(flyAlpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(flySize, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeSoftDot() },
        uColor: { value: new THREE.Color(0xa9d85c) },   /* 夏夜萤火虫暖绿 */
        uPixelScale: { value: 620 },
      },
      vertexShader: POINT_VERT,
      fragmentShader: FIREFLY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    flyPoints = new THREE.Points(geo, mat);
    flyPoints.name = "anim_fireflies";
    flyPoints.frustumCulled = false;
    flyPoints.renderOrder = 6;
    flyPoints.visible = true;
    scene.add(flyPoints);
  }

  /* ---------- 星星闪烁：material.opacity 多层正弦微闪 ---------- */
  let starMat = null;
  if (stars && stars.material) {
    starMat = stars.material;
    starMat.transparent = true;                      /* 需要 opacity 生效 */
    starMat.depthWrite = true;                       /* 单 mesh 无排序问题 */
    starMat.opacity = 0.92;
  }

  /* ---------- 蚊帐：有 morph 用 morphTargetInfluences[0]，否则绕顶边轻旋 ---------- */
  const netHasMorph = !!(bedNet && bedNet.morphTargetInfluences && bedNet.morphTargetInfluences.length);
  let netPivot = null;                               /* { c0:Vector3 中心, topZ } */
  if (bedNet && !netHasMorph) {
    const box = new THREE.Box3().setFromObject(bedNet);
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3());
      netPivot = { c0: c, topZ: box.max.z };
    }
  }

  /* ---------- 每帧步进 ---------- */
  function step(dtMs, tMs) {
    const dt = Math.min(0.5, Math.max(0, dtMs * 0.001));   /* s；上限放宽以兼容大步长手动 tick */
    const t = tMs * 0.001;                                 /* s */
    const st = window.__RM_STATE;
    const fan = st ? (st.fan | 0) : 0;

    /* 1) 风扇自转：目标角速度 fan×5 rad/s，角速度趋近（0 档缓停不瞬停） */
    if (blades) {
      const target = fan * 5;
      fanOmega += (target - fanOmega) * Math.min(1, dt * 2.5);
      blades.rotation.y += fanOmega * dt;
    }

    /* 1b) 风扇摇头：fan>0 绕关节 ±0.45 rad 慢扫，周期 ~6s（高档略快），0 档回中 */
    if (head) {
      let target = 0;
      if (fan > 0) {
        const period = 6.0 - fan * 0.4;                      /* 6s → 4.8s */
        target = 0.45 * Math.sin((2 * Math.PI * t) / period);
      }
      headAngle += (target - headAngle) * Math.min(1, dt * (fan > 0 ? 8 : 2.5));
      if (fan === 0 && Math.abs(headAngle) < 0.0005) headAngle = 0;
      head.rotation.y = headAngle;
    }

    /* 2) 蚊香燃点呼吸：emissiveIntensity 0.6~1.4 */
    if (ember && ember.material && "emissiveIntensity" in ember.material) {
      ember.material.emissiveIntensity = 1.0 + 0.4 * Math.sin((2 * Math.PI * t) / 3.1);
    }

    /* 2b) 蚊香烟：12 粒缓升循环，尺寸渐大、透明度衰减，风致 x 微漂（风扇加成） */
    if (smokePoints) {
      const wind = 0.012 + fan * 0.022;                    /* m 级微漂系数 */
      for (let i = 0; i < SMOKE_N; i++) {
        const life = (t / SMOKE_PERIOD + i / SMOKE_N) % 1; /* 0 燃点 → 1 消散 */
        const wob = Math.sin(t * 1.7 + i * 2.4) * 0.008 * life;
        smokePos[i * 3 + 0] = emberBase.x + wind * life * life + wob;
        smokePos[i * 3 + 1] = emberBase.y + 0.01 + life * 0.38;
        smokePos[i * 3 + 2] = emberBase.z + Math.cos(t * 1.3 + i * 1.9) * 0.006 * life;
        smokeAlpha[i] = 0.26 * (1 - life) * (0.35 + 0.65 * Math.min(1, life * 6));
        smokeSize[i] = 0.012 + life * 0.05;
      }
      smokePoints.geometry.attributes.position.needsUpdate = true;
      smokePoints.geometry.attributes.aAlpha.needsUpdate = true;
      smokePoints.geometry.attributes.aSize.needsUpdate = true;
    }

    /* 3) 萤火虫：正弦漂移 + 亮度闪烁；仅 lampState<0.7（夜/深夜）可见 */
    if (flyPoints) {
      const night = lampRef ? lampRef.value < 0.7 : true;
      flyPoints.visible = night;
      if (night) {
        for (let i = 0; i < FLY_N; i++) {
          const ph = flyPhase[i];
          flyPos[i * 3 + 0] = flyBase[i * 3 + 0] + Math.sin(t * 0.5 + ph) * 0.25;
          flyPos[i * 3 + 1] = flyBase[i * 3 + 1] + Math.sin(t * 0.37 + ph * 2.1) * 0.3;
          flyPos[i * 3 + 2] = flyBase[i * 3 + 2] + Math.sin(t * 0.43 + ph * 1.3) * 0.22;
          const tw = 0.5 + 0.5 * Math.sin(t * 2.6 + ph * 3.7);
          flyAlpha[i] = 0.25 + 0.75 * tw * tw;
          flySize[i] = 0.012 + 0.01 * tw;
        }
        flyPoints.geometry.attributes.position.needsUpdate = true;
        flyPoints.geometry.attributes.aAlpha.needsUpdate = true;
        flyPoints.geometry.attributes.aSize.needsUpdate = true;
      }
    }

    /* 4) 星星闪烁：多层正弦微闪，幅度 ≤0.15，白天不突兀 */
    if (starMat) {
      starMat.opacity = 0.92
        + 0.08 * Math.sin(t * 1.9)
        + 0.05 * Math.sin(t * 3.7 + 1.3)
        + 0.02 * Math.sin(t * 7.1 + 2.9);                  /* 峰值 ≤0.15 */
    }

    /* 5) 蚊帐微动：morph 优先（0~0.3），否则绕顶边轻旋 ≤0.015 rad、周期 ~5s */
    if (bedNet) {
      if (netHasMorph) {
        bedNet.morphTargetInfluences[0] = 0.15 + 0.15 * Math.sin((2 * Math.PI * t) / 5.0);
      } else if (netPivot) {
        /* 绕顶边（过顶中心、平行 X 轴的直线）小角旋转，顶边固定 */
        const a = 0.012 * Math.sin((2 * Math.PI * t) / 5.0);
        bedNet.rotation.x = a;
        scratchV.set(netPivot.c0.x, netPivot.c0.y, netPivot.topZ);
        /* 位置补偿：使顶边参考点旋转后回到原处 */
        bedNet.position.y = netPivot.c0.y - (netPivot.topZ - netPivot.c0.z) * a;
        bedNet.position.z = netPivot.c0.z;
      }
    }
  }

  /* tick 绝不抛错：首次异常 warn 后静默 */
  function tick(dtMs, tMs) {
    try {
      step(dtMs, tMs);
    } catch (e) {
      if (!tickWarned) {
        tickWarned = true;
        console.warn("[RM] anim: tick 异常（已降级跳过）:", e && e.message);
      }
    }
  }

  return { tick };
}
