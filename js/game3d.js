/* =====================================================================
   Coulair Run 3D — объёмная графика мини-игры на Three.js.
   Правила и физика остаются в js/game.js, здесь только отрисовка того же мира.
   Модуль грузится при первом включении «3D» в игре.
   Все модули — из одной сборки three@0.169.0 на jsDelivr (+esm), чтобы THREE был один.
   ===================================================================== */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/postprocessing/EffectComposer.js/+esm';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/postprocessing/RenderPass.js/+esm';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/postprocessing/UnrealBloomPass.js/+esm';
import { OutputPass } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/postprocessing/OutputPass.js/+esm';
import { ShaderPass } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/postprocessing/ShaderPass.js/+esm';
import { Sky } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/objects/Sky.js/+esm';
import { mergeGeometries, mergeVertices } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/loaders/GLTFLoader.js/+esm';

/* ---------------- модель человека (Blender: tools/blender/build_rider.py, CC0 Quaternius) ----------------
   Скелет повторяет позу процедурного райдера (IK: присед, наклон, палки, грэб),
   падение и «барахтанье» — настоящие анимации из библиотеки. Пока модель грузится — процедурный райдер. */
const MODEL_V = new URL(import.meta.url).searchParams.get('v') || '';
const modelCache = {};
function loadRiderModel(kind) {
  if (!modelCache[kind]) {
    const url = new URL(`../assets/models/rider-${kind}.glb${MODEL_V ? '?v=' + MODEL_V : ''}`, import.meta.url).href;
    modelCache[kind] = new GLTFLoader().loadAsync(url).catch(err => { console.warn('Coulair Run: модель райдера не загрузилась', err); return null; });
  }
  return modelCache[kind];
}
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
// повернуть кость так, чтобы её дочерняя точка (childW) смотрела на targetW; всё в мировых координатах
function aimBone(bone, childW, targetW) {
  bone.updateWorldMatrix(true, false);
  const bw = _v1.setFromMatrixPosition(bone.matrixWorld);
  const cur = _v2.subVectors(childW, bw).normalize(), want = _v3.subVectors(targetW, bw).normalize();
  if (cur.lengthSq() < 1e-8 || want.lengthSq() < 1e-8) return;
  const wq = bone.getWorldQuaternion(_q1);
  const delta = _q2.setFromUnitVectors(cur, want);
  const pq = bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(pq.multiply(delta.multiply(wq)));
  bone.updateWorldMatrix(false, true);
}
const wpos = (o, out = new THREE.Vector3()) => { o.updateWorldMatrix(true, false); return out.setFromMatrixPosition(o.matrixWorld); };

const S = 0.08;              // игровая единица → метры
const HZ = 0.035;            // высота прыжка (игровая z) → метры
const SLOPE = 0.27;          // уклон трассы, рад (~15°)
const GROUND_TILE = 24;      // размер тайла снега, м
const GROOVE_TILE = 3;       // тайл вельвета от ратрака, м
const SUN = new THREE.Vector3(0.62, 0.45, 0.64).normalize();   // солнце слева-спереди, ~27° над горизонтом
const QUALITY_KEY = 'coulair-run-q';                           // 'high' | 'medium' | 'low' — зафиксировать качество

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const rng = seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const col = hex => new THREE.Color(hex);
const glslVec = v => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

/* ---------------- туман: гуще в долине, тёплый ореол со стороны солнца ---------------- */
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth; varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = (inverse(viewMatrix) * mvPosition).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length(fogRay);
    float fogH = clamp(exp(-(vFogWorld.y - cameraPosition.y + 20.0) * 0.012), 0.4, 2.5);
    float fogFactor = 1.0 - exp(-fogDensity * fogDist * fogH);
    float fogSun = pow(max(dot(fogRay / max(fogDist, 1e-3), ${glslVec(SUN)}), 0.0), 6.0);
    vec3 fogCol = mix(fogColor, vec3(1.0, 0.93, 0.82) * 1.25, fogSun * 0.55);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogFactor, 0.0, 1.0));
  #else
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, vFogDepth));
  #endif
#endif`;

/* ---------------- шум Перлина для скал и гор ---------------- */
function perlin(seed) {
  const r = rng(seed), perm = [...Array(256).keys()], p = new Uint8Array(512);
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => { const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  return (x, y, z) => {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(p[AA] & 15, x, y, z), grad(p[BA] & 15, x - 1, y, z), u), lerp(grad(p[AB] & 15, x, y - 1, z), grad(p[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(lerp(grad(p[AA + 1] & 15, x, y, z - 1), grad(p[BA + 1] & 15, x - 1, y, z - 1), u), lerp(grad(p[AB + 1] & 15, x, y - 1, z - 1), grad(p[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
      w);
  };
}
const fbm = (n, x, y, z, oct = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; };
const ridged = (n, x, z, oct = 6) => {
  let s = 0, a = 0.5, f = 1, prev = 1;
  for (let i = 0; i < oct; i++) { let v = 1 - Math.abs(n(x * f, 0.37 * i, z * f)); v *= v; s += v * a * prev; prev = v; f *= 2.1; a *= 0.5; }
  return s;
};

/* ---------------- текстуры, нарисованные на canvas ---------------- */
function canvasTex(w, h, paint, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// снег: мягкие перепады тона, наддувы, крупинки
function snowTexture() {
  return canvasTex(512, 512, (g, S0) => {
    g.fillStyle = '#eef3fa'; g.fillRect(0, 0, S0, S0);
    const r = rng(11);
    for (let i = 0; i < 40; i++) {
      const x = r() * S0, y = r() * S0, rad = 30 + r() * 140, dark = r() < 0.55;
      for (const ox of [-S0, 0, S0]) for (const oy of [-S0, 0, S0]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        gr.addColorStop(0, dark ? 'rgba(150,172,210,.16)' : 'rgba(255,255,255,.75)');
        gr.addColorStop(1, dark ? 'rgba(150,172,210,0)' : 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() < 0.75 ? `rgba(255,255,255,${0.5 + r() * 0.5})` : 'rgba(130,155,200,.22)';
      g.fillRect(r() * S0, r() * S0, 1 + r(), 1 + r());
    }
  }, { repeat: true });
}

// карта нормалей: борозды вельвета вдоль склона + мелкая зернистость
function grooveNormalTexture() {
  return canvasTex(256, 256, (g, S0) => {
    const img = g.createImageData(S0, S0), d = img.data, r = rng(5);
    const grooves = 16;
    for (let y = 0; y < S0; y++) for (let x = 0; x < S0; x++) {
      const ph = (x / S0) * grooves * Math.PI * 2;
      let nx = Math.cos(ph) * 0.35 + (r() - 0.5) * 0.18;
      let ny = (r() - 0.5) * 0.18;
      const i = (y * S0 + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true, srgb: false });
}

function softDot(color = '255,255,255') {
  return canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${color},1)`); gr.addColorStop(0.45, `rgba(${color},.6)`); gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
}

function lensTexture() {
  return canvasTex(128, 32, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#ffb13b'); gr.addColorStop(0.4, '#ff4f7b'); gr.addColorStop(0.75, '#7a5cff'); gr.addColorStop(1, '#2cc9ff');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath(); g.moveTo(w * 0.1, 3); g.lineTo(w * 0.35, 3); g.lineTo(w * 0.25, h - 4); g.lineTo(w * 0.02, h - 4); g.closePath(); g.fill();
  });
}

function stripeTexture(a, b, n = 8) {
  const t = canvasTex(4, 64, (g, w, h) => {
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, (i * h) / n, w, h / n + 1); }
  });
  t.magFilter = THREE.NearestFilter;
  return t;
}

function flagTexture(c1, c2) {
  return canvasTex(256, 176, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#fff'; g.font = '900 86px Manrope, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CC', w / 2, h / 2 + 4);
  });
}

function textTexture(text, color) {
  const t = canvasTex(512, 96, (g, w, h) => {
    g.font = '800 58px Manrope, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = 'rgba(255,255,255,.95)';
    g.strokeText(text, w / 2, h / 2); g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  });
  return t;
}

function logoTexture(text, color, bg) {
  return canvasTex(256, 64, (g, w, h) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.font = '900 40px Manrope, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 2);
  });
}

function skiTopTexture(base, accent) {
  return canvasTex(64, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#0c0c10'); gr.addColorStop(0.2, base); gr.addColorStop(0.8, base); gr.addColorStop(1, '#0c0c10');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = accent; g.fillRect(28, 20, 8, 150); g.fillRect(28, 340, 8, 150);
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 2);
    g.font = '900 30px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText('COULAIR', 0, 2); g.restore();
  });
}

function boardTopTexture(accent) {
  return canvasTex(128, 640, (g, w, h) => {
    g.fillStyle = '#141418'; g.fillRect(0, 0, w, h);
    g.fillStyle = accent;
    for (const y0 of [70, 520]) { g.beginPath(); g.moveTo(0, y0); g.lineTo(w, y0 - 60); g.lineTo(w, y0 - 30); g.lineTo(0, y0 + 30); g.closePath(); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,.08)';
    for (let y = 0; y < h; y += 14) g.fillRect(0, y, w, 1);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2);
    g.font = '900 64px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText('COULAIR', 0, 3); g.restore();
  });
}

function stumpTopTexture() {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#d8b78c'; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,80,40,.55)'; g.lineWidth = 2;
    for (let k = 8; k < 64; k += 7 + Math.random() * 3) { g.beginPath(); g.arc(64 + Math.random() * 2, 64, k, 0, Math.PI * 2); g.stroke(); }
    g.strokeStyle = 'rgba(80,50,20,.5)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(64, 64); g.lineTo(110, 40); g.stroke();
  });
}

function cloudTexture() {
  return canvasTex(256, 128, (g) => {
    const r = rng(3);
    for (let i = 0; i < 26; i++) {
      const x = 40 + r() * 176, y = 50 + r() * 40, rad = 18 + r() * 34;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });
}

/* ---------------- утилиты геометрии ---------------- */
// раскрасить геометрию вершинными цветами (для слияния в один меш)
function paint(geo, color, fn) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const pos = geo.attributes.position, n = pos.count;
  const out = new Float32Array(n * 3), base = col(color), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.copy(base);
    if (fn) fn(c, pos.getX(i), pos.getY(i), pos.getZ(i), i);
    out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}

function merge(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), c = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    c.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  out.computeVertexNormals();
  return out;
}

// смещение вершин с учётом совпадающих точек (шов не расходится)
function jitter(geo, fn) {
  const pos = geo.attributes.position, cache = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${x.toFixed(3)}|${y.toFixed(3)}|${z.toFixed(3)}`;
    let d = cache.get(key);
    if (!d) { d = fn(x, y, z); cache.set(key, d); }
    pos.setXYZ(i, d[0], d[1], d[2]);
  }
  pos.needsUpdate = true;
  return geo;
}

// кость: цилиндр от точки a вверх по +Y длиной len
function boneGeo(r0, r1, len, seg = 10) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  return g;
}

const _m = new THREE.Matrix4(), _x = V(), _y = V(), _z = V();
// поворачивает объект так, что +Y смотрит из a в b, а +Z — по возможности в сторону fwd
function orient(obj, a, b, fwd) {
  _y.subVectors(b, a).normalize();
  _z.copy(fwd).addScaledVector(_y, -fwd.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(a);
}

// двухзвенная IK: колено/локоть между началом и концом, сгибается в сторону hint
function ik(a, end, l1, l2, hint, outMid) {
  const d = V().subVectors(end, a);
  let len = d.length();
  const max = (l1 + l2) * 0.999;
  if (len > max) { d.multiplyScalar(max / len); end.copy(a).add(d); len = max; }
  const dir = d.clone().divideScalar(len || 1);
  const x = (l1 * l1 - l2 * l2 + len * len) / (2 * len || 1);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const perp = hint.clone().addScaledVector(dir, -hint.dot(dir)).normalize();
  outMid.copy(a).addScaledVector(dir, x).addScaledVector(perp, h);
  return outMid;
}

/* ---------------- модели окружения ---------------- */
// ветка ели сверху: стебель от ствола (слева) к кончику, веточки с хвоей, снег по центру
function branchTexture(seed, snowAmount) {
  return canvasTex(512, 256, (g, w, h) => {
    const r = rng(seed * 71 + 5);
    const cy = h / 2;
    const stemY = t => cy + t * t * 8;
    g.lineCap = 'round';
    const twigs = [];
    for (let i = 0; i < 18; i++) {
      const t = 0.03 + (i / 18) * 0.92;
      for (const s of [-1, 1]) twigs.push({ t, s, len: (1 - t * 0.5) * h * 0.44 * (0.75 + r() * 0.35), a: s * (0.75 + r() * 0.35) });
    }
    const needles = (x0, y0, ang, len, shade, width, density) => {
      g.lineWidth = width;
      const steps = Math.max(4, (len / 3) | 0);
      for (let k = 0; k < steps; k++) {
        const u = k / steps, px = x0 + Math.cos(ang) * len * u, py = y0 + Math.sin(ang) * len * u;
        const nl = (10 + r() * 8) * (1 - u * 0.35);
        for (const side of [-1, 1]) {
          if (r() > density) continue;
          const a2 = ang + side * (0.8 + r() * 0.5);
          const c = shade[(r() * shade.length) | 0];
          g.strokeStyle = c;
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a2) * nl, py + Math.sin(a2) * nl); g.stroke();
        }
      }
    };
    const dark = ['#0c2616', '#11301c', '#173a22', '#1c4228'];
    const light = ['#2a6238', '#347244', '#3f7f4c', '#4e8c56', '#2f5f3a'];
    // стебель
    g.strokeStyle = '#4a3322'; g.lineWidth = 4;
    g.beginPath(); for (let t = 0; t <= 1; t += 0.05) { const x = 6 + t * (w - 24); t ? g.lineTo(x, stemY(t)) : g.moveTo(x, stemY(t)); } g.stroke();
    for (const pass of [0, 1]) {
      for (const tw of twigs) {
        const x0 = 6 + tw.t * (w - 24), y0 = stemY(tw.t);
        if (!pass) { g.strokeStyle = '#3a2a1c'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(tw.a) * tw.len, y0 + Math.sin(tw.a) * tw.len); g.stroke(); }
        needles(x0, y0, tw.a, tw.len, pass ? light : dark, pass ? 1.6 : 3.2, pass ? 0.6 : 1);
      }
      needles(6, cy, 0, w - 24, pass ? light : dark, pass ? 1.3 : 2.4, pass ? 0.5 : 0.9);
    }
    // снег лежит по центру ветки, у ствола толще; синеватые края, светлые вершины комьев
    for (let i = 0; i < 90 * snowAmount; i++) {
      const t = Math.pow(r(), 1.35) * 0.95;
      const x = 6 + t * (w - 24), y = stemY(t) + (r() - 0.5) * h * 0.42 * (1 - t * 0.5);
      const rad = (1 - t) * 15 + 4 + r() * 6;
      const gr = g.createRadialGradient(x - rad * 0.2, y - rad * 0.25, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(240,246,255,.95)'); gr.addColorStop(0.85, 'rgba(196,214,238,.9)'); gr.addColorStop(1, 'rgba(196,214,238,0)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(x, y, rad * (1.2 + r() * 0.6), rad, (r() - 0.5) * 0.6, 0, Math.PI * 2); g.fill();
    }
  });
}

function barkTexture() {
  const t = canvasTex(128, 256, (g, w, h) => {
    const r = rng(9);
    g.fillStyle = '#4a3122'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 180; i++) {
      const x = r() * w, y = r() * h, len = 20 + r() * 60;
      g.strokeStyle = r() < 0.5 ? 'rgba(20,12,6,.55)' : 'rgba(120,90,64,.35)'; g.lineWidth = 1 + r() * 3;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (r() - 0.5) * 8, y + len * 0.3, x + (r() - 0.5) * 8, y + len * 0.6, x + (r() - 0.5) * 6, y + len); g.stroke();
    }
  }, { repeat: true });
  t.repeat.set(2, 3);
  return t;
}

// ткань куртки: плетение как карта нормалей
let FABRIC = null;
function fabricNormal() {
  if (FABRIC) return FABRIC;
  FABRIC = canvasTex(128, 128, (g, S0) => {
    const img = g.createImageData(S0, S0), d = img.data, r = rng(4);
    for (let y = 0; y < S0; y++) for (let x = 0; x < S0; x++) {
      const cx = Math.floor(x / 4), cy = Math.floor(y / 4), odd = (cx + cy) & 1;
      const nx = odd ? Math.sin(((x % 4) / 4) * Math.PI * 2) * 0.5 : 0;
      const ny = odd ? 0 : Math.sin(((y % 4) / 4) * Math.PI * 2) * 0.5;
      const i = (y * S0 + x) * 4;
      d[i] = (nx + (r() - 0.5) * 0.1) * 127 + 128; d[i + 1] = (ny + (r() - 0.5) * 0.1) * 127 + 128; d[i + 2] = 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true, srgb: false });
  FABRIC.repeat.set(6, 6);
  return FABRIC;
}

// мягкая контактная тень под объектами
function aoTexture() {
  return canvasTex(128, 128, g => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.35, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

const flat = g => (g.index ? g.toNonIndexed() : g);

/* ---------------- ель из «карточек»-веток: ствол, тёмная сердцевина, лапы с хвоей и снегом ---------------- */
function treeGeometry(seed) {
  const r = rng(seed * 131 + 7);
  const H = 8.2 + r() * 1.2;
  const maxR = 2.4 + r() * 0.5;
  const trunk = new THREE.CylinderGeometry(0.09, 0.26, H * 0.97, 9, 1).translate(0, (H * 0.97) / 2, 0);
  const fill = new THREE.ConeGeometry(maxR * 0.48, H * 0.84, 10, 1).translate(0, 1.0 + (H * 0.84) / 2, 0);
  const cards = [];
  const whorls = 14 + ((r() * 4) | 0);
  for (let i = 0; i < whorls; i++) {
    const t = i / (whorls - 1);
    const y = 1.0 + t * (H - 1.1);
    const L = Math.max(0.3, maxR * Math.pow(1 - t, 0.85) * (0.85 + r() * 0.3));
    const n = t > 0.88 ? 4 : 6 + ((r() * 3) | 0);
    const off = r() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const az = off + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const droop = t > 0.9 ? -0.7 : 0.16 + (1 - t) * 0.22 + (r() - 0.5) * 0.12;
      const wd = L * (0.55 + r() * 0.15);
      const p = new THREE.PlaneGeometry(L, wd, 4, 1).rotateX(-Math.PI / 2).translate(L / 2, 0, 0);
      const pa = p.attributes.position;
      for (let j = 0; j < pa.count; j++) { const x = pa.getX(j); pa.setY(j, pa.getY(j) - Math.pow(x / L, 2) * L * 0.2); }
      p.rotateZ(-droop).rotateY(az).translate(0, y, 0);
      cards.push(p);
    }
  }
  const cardsGeo = mergeGeometries(cards);
  // нормали «облаком» — крона освещается объёмно, а не плоскими листами
  const cp = cardsGeo.attributes.position, cn = cardsGeo.attributes.normal, nv = V();
  for (let j = 0; j < cp.count; j++) {
    nv.set(cp.getX(j) * 0.9, 1.0, cp.getZ(j) * 0.9).normalize();
    cn.setXYZ(j, nv.x, nv.y, nv.z);
  }
  const mound = new THREE.SphereGeometry(1.3, 14, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.18, 1);
  return mergeGeometries([trunk, fill, cardsGeo, mound].map(flat), true);
}

/* ---------------- скала: шумовой рельеф, трещины темнее, снег на пологих гранях ---------------- */
function rockGeometry(seed) {
  const n = perlin(seed * 13 + 1), r = rng(seed * 31 + 7);
  let g = new THREE.IcosahedronGeometry(1, 9);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.attributes.position, disp = new Float32Array(pos.count);
  const fl = 0.65 + r() * 0.2, sx = 0.95 + r() * 0.3, sz = 0.8 + r() * 0.3, o = r() * 10;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let d = 0.82 + fbm(n, x * 1.2 + o, y * 1.2, z * 1.2, 3) * 0.55;
    d -= Math.abs(n(x * 4 + o, y * 4, z * 4)) * 0.09;                 // трещины и сколы
    d += Math.max(0, n(x * 2.2, y * 2.2 + o, z * 2.2)) * 0.12;         // выступающие грани
    disp[i] = d;
    pos.setXYZ(i, x * d * sx, Math.max(-0.28, y * d * fl), z * d * sz);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal, colors = new Float32Array(pos.count * 3);
  const dark = col('#3d4148'), light = col('#8f949a'), warm = col('#7d7264'), snow = col('#f5f8fd'), snowB = col('#d4e0f1'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const v = clamp(0.5 + fbm(n, x * 3, y * 3 + 5, z * 3, 3) * 0.9, 0, 1);
    c.copy(dark).lerp(light, v).lerp(warm, clamp(n(x * 1.5 + 9, y, z) * 1.5, 0, 0.5));
    c.multiplyScalar(0.55 + clamp((disp[i] - 0.7) * 1.5, 0, 0.45));           // впадины темнее
    const sk = smooth(0.72, 0.9, nrm.getY(i) + n(x * 5, y * 5, z * 5 + 3) * 0.3) * (y > 0.05 ? 1 : 0);
    c.lerp(c.clone().copy(snowB).lerp(snow, nrm.getY(i)), sk);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/* ---------------- горы: кольцо рельефа из «гребневого» шума вокруг камеры ---------------- */
function mountainGeometry({ inner, outer, height, base, seed, scale, rock, forest, snowLine, haze, hazeK }) {
  const n = perlin(seed);
  const NA = 440, NR = 46;
  const pos = new Float32Array(NA * (NR + 1) * 3);
  let k = 0;
  for (let ir = 0; ir <= NR; ir++) {
    const t = ir / NR, rad = lerp(inner, outer, Math.pow(t, 0.85));
    for (let ia = 0; ia < NA; ia++) {
      const a = (ia / NA) * Math.PI * 2, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const mask = smooth(0, 0.3, t) * (1 - 0.2 * t);
      const h = ridged(n, x / scale, z / scale, 7);
      pos[k++] = x; pos[k++] = base + height * mask * (0.08 + h * 0.95); pos[k++] = z;
    }
  }
  const idx = [];
  for (let ir = 0; ir < NR; ir++) for (let ia = 0; ia < NA; ia++) {
    const i0 = ir * NA + ia, i1 = ir * NA + ((ia + 1) % NA), i2 = i0 + NA, i3 = i1 + NA;
    idx.push(i0, i1, i2, i1, i3, i2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.attributes.normal, colors = new Float32Array(pos.length), c = new THREE.Color();
  const cRock = col(rock), cForest = col(forest || rock), cSnow = col('#f3f7ff'), cSnowB = col('#c9d8ee'), cHaze = col(haze);
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const hn = clamp((y - base) / height, 0, 1), ny = nrm.getY(i);
    const v = 0.5 + n(x * 0.02, 3.3, z * 0.02) * 0.6;
    c.copy(cForest).lerp(cRock, smooth(0.15, 0.45, hn + (0.8 - ny))).multiplyScalar(0.75 + v * 0.4);
    const sk = smooth(snowLine - 0.06, snowLine + 0.06, hn + (ny - 0.72) * 0.9 + n(x * 0.05, 7.1, z * 0.05) * 0.12);
    c.lerp(c.clone().copy(cSnowB).lerp(cSnow, ny), sk);
    c.lerp(cHaze, hazeK * (1 - hn * 0.45));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function flakeGeometry() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const arm = new THREE.BoxGeometry(0.07, 0.56, 0.035).translate(0, 0.28, 0);
    for (const [y, len] of [[0.2, 0.2], [0.36, 0.14]]) {
      for (const s of [-1, 1]) {
        const br = new THREE.BoxGeometry(0.05, len, 0.03).translate(0, len / 2, 0).rotateZ(s * 0.8).translate(0, y, 0);
        parts.push(paint(br.rotateZ(a), '#ffffff'));
      }
    }
    parts.push(paint(arm.rotateZ(a), '#ffffff'));
  }
  parts.push(paint(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 6).rotateX(Math.PI / 2), '#ffffff'));
  return merge(parts);
}

/* ---------------- рельеф склона: перекаты, бугры и крутые уступы ----------------
   Высота над плоскостью склона (м) по мировым координатам в метрах: gx — поперёк, gz — вниз по склону.
   Одна и та же формула в JS (объекты, райдер, камера) и в шейдере земли. */
const TAN_SLOPE = Math.tan(SLOPE);
const PITCH_LEN = 240, PITCH_DROP = 26;                  // каждые 240 м — «чёрная трасса»: стенка с перепадом 26 м (как PITCH в game.js)
const ROAD_FLAT = 9;                                      // плавный переход от склона к полотну трассы, м
const pitchH = gz => { const t = gz / PITCH_LEN, f = t - Math.floor(t); return -PITCH_DROP * (Math.floor(t) + smooth(0.58, 0.78, f)); };
const rollsH = (gx, gz) =>
  2.6 * Math.sin(gz * 0.042 + 0.7) * (0.65 + 0.35 * Math.sin(gx * 0.021 + 1.1)) +
  1.25 * Math.sin(gz * 0.105 + gx * 0.047 + 1.3) +
  0.8 * Math.sin(gx * 0.071 - gz * 0.033 + 2.1);
const TERRAIN = { roadZ: -1e9, roadHalf: 0 };            // ближайшая трасса: полотно горизонтально, склон к нему выполаживается
function terrH(gx, gz) {
  const dz = gz - TERRAIN.roadZ;
  // у трассы бугры сходят на нет: большой трамплин виден издалека
  let h = pitchH(gz) + rollsH(gx, gz) * smooth(30, 110, Math.abs(dz));
  const m = 1 - smooth(TERRAIN.roadHalf, TERRAIN.roadHalf + ROAD_FLAT, Math.abs(dz));
  if (m > 0) h = lerp(h, pitchH(TERRAIN.roadZ) + dz * TAN_SLOPE, m);
  return h;
}
const TERRAIN_GLSL = `
  uniform vec2 uOff; uniform vec2 uShift; uniform float uRef; uniform vec2 uRoad;
  float pitchH(float gz) { float t = gz / ${PITCH_LEN.toFixed(1)}; return -${PITCH_DROP.toFixed(1)} * (floor(t) + smoothstep(0.58, 0.78, fract(t))); }
  float rollsH(float gx, float gz) {
    return 2.6 * sin(gz * 0.042 + 0.7) * (0.65 + 0.35 * sin(gx * 0.021 + 1.1))
         + 1.25 * sin(gz * 0.105 + gx * 0.047 + 1.3)
         + 0.8 * sin(gx * 0.071 - gz * 0.033 + 2.1);
  }
  float terrH(float gx, float gz) {
    float dz = gz - uRoad.x;
    float h = pitchH(gz) + rollsH(gx, gz) * smoothstep(30.0, 110.0, abs(dz));
    float m = 1.0 - smoothstep(uRoad.y, uRoad.y + ${ROAD_FLAT.toFixed(1)}, abs(dz));
    return mix(h, pitchH(uRoad.x) + dz * ${TAN_SLOPE.toFixed(5)}, m);
  }`;

/* ---------------- естественный трамплин: снежная насыпь, кромка в начале координат ----------------
   Ширина полной высоты совпадает с зоной, где в игре срабатывает прыжок (32 и 62 ед. от центра). */
const KICKERS = { ramp: { len: 6, height: 1.45, width: 5.1 }, bigramp: { len: 15, height: 3.6, width: 9.9 } };
// высота поверхности трамплина (м) в точке dx поперёк / dz вдоль склона от кромки
function kickerProf(k, dx, dz) {
  const zr = -k.len * 0.85, zk = k.len * 0.2;
  let prof = 0;
  if (dz > zr && dz <= 0) prof = Math.pow((dz - zr) / -zr, 1.9);
  else if (dz > 0 && dz < zk) prof = 0.5 + 0.5 * Math.cos((dz / zk) * Math.PI);
  return k.height * prof * (1 - smooth(0.85, 1.3, Math.abs(dx) / (k.width / 2)));
}
function snowKickerGeometry(k, seed) {
  const n = perlin(seed);
  const zr = -k.len * 0.85, zk = k.len * 0.2;
  const g = new THREE.PlaneGeometry(k.width * 1.6, k.len * 1.4, 40, 56).rotateX(-Math.PI / 2).translate(0, 0, (zr * 1.15 + zk * 1.6) / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const edge = n(x * 0.25, z * 0.25, 0.5) * 0.35;                     // неровный край насыпи
    const h = kickerProf(k, Math.abs(x) + Math.max(0, Math.abs(x) - k.width * 0.4) * edge, z);
    p.setY(i, h + n(x * 0.9, z * 0.9, 2.5) * 0.05 * (h > 0.05 ? 1 : 0.3) - 0.06);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------------- машины: силуэт выдавлен по ширине, стёкла, колёса, фары ---------------- */
function roadTexture() {
  const t = canvasTex(1024, 256, (g, w, h) => {
    const r = rng(8);
    g.fillStyle = '#3a3d43'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.14)'; g.fillRect(r() * w, r() * h, 1.2, 1.2); }
    // накатанные колеи — темнее и глаже
    g.fillStyle = 'rgba(0,0,0,.2)';
    for (const y of [0.2, 0.33, 0.67, 0.8]) g.fillRect(0, y * h - 6, w, 12);
    // разметка: сплошные по краям, двойная жёлтая по центру
    g.fillStyle = '#ecece6'; g.fillRect(0, 0.08 * h, w, 5); g.fillRect(0, 0.92 * h - 5, w, 5);
    g.fillStyle = '#e2b126'; g.fillRect(0, h / 2 - 8, w, 5); g.fillRect(0, h / 2 + 3, w, 5);
    // трещины и заплатки
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.2;
    for (let i = 0; i < 18; i++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 20; g.lineTo(x, y); } g.stroke(); }
    // края в снегу
    const e = g.createLinearGradient(0, 0, 0, 0.07 * h);
    e.addColorStop(0, 'rgba(235,240,247,.95)'); e.addColorStop(1, 'rgba(235,240,247,0)');
    g.fillStyle = e; g.fillRect(0, 0, w, 0.07 * h);
    g.save(); g.translate(0, h); g.scale(1, -1); g.fillRect(0, 0, w, 0.07 * h); g.restore();
  }, { repeat: true });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function signTexture(dir) {
  return canvasTex(256, 320, (g, w) => {
    g.fillStyle = '#ffffff'; g.strokeStyle = '#d9352b'; g.lineWidth = 22; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(w / 2, 22); g.lineTo(w - 20, 210); g.lineTo(20, 210); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#16161a'; g.font = '900 120px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('!', w / 2, 140);
    g.fillStyle = '#2466d9'; g.fillRect(20, 232, w - 40, 80);
    g.fillStyle = '#fff';
    g.save(); g.translate(w / 2, 272); g.scale(dir, 1);
    g.beginPath(); g.moveTo(70, 0); g.lineTo(20, -28); g.lineTo(20, -10); g.lineTo(-70, -10); g.lineTo(-70, 10); g.lineTo(20, 10); g.lineTo(20, 28); g.closePath(); g.fill();
    g.restore();
  });
}

const VEH_DIM = { car: [4.5, 1.85, 1.45], suv: [4.9, 2.0, 1.85], truck: [16.4, 2.55, 3.9], bus: [12, 2.55, 3.3] };
function makeVehicle(kind, color, M) {
  const g = new THREE.Group();
  const [L, Wd, Ht] = VEH_DIM[kind];
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  // силуэт сбоку (z — длина, y — высота) выдавливается по ширине
  const body = (pts, w, mat, bevel = 0.06) => {
    const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: w - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
    geo.rotateY(-Math.PI / 2).translate((w - bevel * 2) / 2, 0, 0);
    return add(geo, mat);
  };
  const wheels = [];
  const wheel = (z, x, r = 0.34) => {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.26, 20).rotateZ(Math.PI / 2), M.tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.27, 12).rotateZ(Math.PI / 2), M.metal);
    tire.castShadow = true; w.add(tire, rim);
    w.position.set(x, r, z); g.add(w); wheels.push(w);
  };
  const lights = (zF, zR, y, w) => {
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.32, 0.12, 0.05), M.headlight, s * (w / 2 - 0.25), y, zF);
      add(new THREE.BoxGeometry(0.3, 0.14, 0.05), M.taillight, s * (w / 2 - 0.22), y, zR);
    }
  };
  if (kind === 'car' || kind === 'suv') {
    const k = kind === 'suv' ? 1.25 : 1;
    const z0 = -L / 2, z1 = L / 2;
    body([[z0, 0.3], [z0, 0.95 * k], [z0 + 0.5, 1.0 * k], [z0 + (kind === 'suv' ? 0.4 : 1.1), Ht], [z1 - 1.9, Ht], [z1 - 1.05, 1.02 * k], [z1 - 0.1, 0.88 * k], [z1, 0.35]], Wd, paint);
    // стёкла по бокам, лобовое и заднее
    const glassPts = [[z0 + (kind === 'suv' ? 0.55 : 1.2), 1.02 * k], [z0 + (kind === 'suv' ? 0.55 : 1.25), Ht - 0.07], [z1 - 1.95, Ht - 0.07], [z1 - 1.2, 1.04 * k]];
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape(glassPts.map(([z, y]) => new THREE.Vector2(z, y)));
      const geo = new THREE.ShapeGeometry(sh).rotateY(-Math.PI / 2);
      const m = add(geo, M.glass, s * (Wd / 2 + 0.005), 0, 0);
      m.castShadow = false;
    }
    // лобовое и заднее стекло — наклонные плоскости между капотом и крышей
    const slope = (za, ya, zb, yb) => {
      const dy = yb - ya, dz = zb - za;
      const m = add(new THREE.PlaneGeometry(Wd - 0.22, Math.hypot(dy, dz)), M.glass, 0, (ya + yb) / 2, (za + zb) / 2);
      m.rotation.x = Math.atan2(dz, dy); m.castShadow = false;
    };
    slope(z1 - 1.05, 1.02 * k, z1 - 1.9, Ht - 0.02);
    if (kind === 'car') slope(z0 + 0.5, 1.0 * k, z0 + 1.1, Ht - 0.02);
    add(new THREE.BoxGeometry(Wd + 0.04, 0.22, 0.25), M.bumper, 0, 0.42, z1 - 0.08);
    add(new THREE.BoxGeometry(Wd + 0.04, 0.22, 0.25), M.bumper, 0, 0.42, z0 + 0.08);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.2, 0.1, 0.12), paint, s * (Wd / 2 + 0.1), 1.05 * k, z1 - 1.25);
    lights(z1 + 0.01, z0 - 0.01, 0.78 * k, Wd);
    const r = kind === 'suv' ? 0.4 : 0.33;
    for (const s of [-1, 1]) { wheel(z1 - 0.95, s * (Wd / 2 - 0.12), r); wheel(z0 + 0.95, s * (Wd / 2 - 0.12), r); }
  } else if (kind === 'truck') {
    const cabL = 2.5, z1 = L / 2;
    body([[z1 - cabL, 0.55], [z1 - cabL, Ht - 0.1], [z1 - 0.35, Ht - 0.1], [z1, Ht - 1.2], [z1, 0.55]], Wd, paint, 0.1);
    add(new THREE.PlaneGeometry(Wd - 0.3, 0.9), M.glass, 0, Ht - 0.75, z1 + 0.02);
    for (const s of [-1, 1]) add(new THREE.PlaneGeometry(1.3, 0.85).rotateY(Math.PI / 2), M.glass, s * (Wd / 2 + 0.11), Ht - 0.85, z1 - 1.0).castShadow = false;
    add(new THREE.BoxGeometry(Wd - 0.5, 0.8, 0.06), M.metal, 0, 1.2, z1 + 0.03);   // решётка
    add(new THREE.BoxGeometry(Wd, 0.3, 0.3), M.bumper, 0, 0.6, z1 + 0.05);
    // прицеп с логотипом
    const tr = add(new THREE.BoxGeometry(Wd, Ht - 0.9, L - cabL - 0.4), [M.trailerSide, M.trailerSide, M.trailerTop, M.bumper, M.trailerEnd, M.trailerEnd], 0, (Ht - 0.9) / 2 + 0.9, -cabL / 2 - 0.2);
    tr.castShadow = true;
    add(new THREE.BoxGeometry(Wd - 0.3, 0.25, L - 0.6), M.bumper, 0, 0.75, 0);
    lights(z1 + 0.06, -L / 2 + 0.2, 0.8, Wd);
    for (const s of [-1, 1]) {
      for (const z of [z1 - 0.8, z1 - cabL - 0.6, z1 - cabL - 1.8, -L / 2 + 2.6, -L / 2 + 1.5, -L / 2 + 0.4]) wheel(z, s * (Wd / 2 - 0.2), 0.5);
    }
  } else {
    const z0 = -L / 2, z1 = L / 2;
    body([[z0, 0.35], [z0, Ht - 0.1], [z0 + 0.2, Ht], [z1 - 0.3, Ht], [z1, Ht - 0.4], [z1, 0.35]], Wd, paint, 0.12);
    for (const s of [-1, 1]) add(new THREE.PlaneGeometry(L - 1.4, 1.1).rotateY((s * Math.PI) / 2), M.glass, s * (Wd / 2 + 0.01), Ht - 1.1, -0.2);
    add(new THREE.PlaneGeometry(Wd - 0.3, 1.5), M.glass, 0, Ht - 1.05, z1 + 0.01);
    add(new THREE.BoxGeometry(Wd + 0.02, 0.35, L - 0.2), M.accentStripe, 0, 1.0, 0);
    lights(z1 + 0.02, z0 - 0.02, 0.8, Wd);
    for (const s of [-1, 1]) { wheel(z1 - 2.4, s * (Wd / 2 - 0.2), 0.5); wheel(z0 + 2.8, s * (Wd / 2 - 0.2), 0.5); }
  }
  g.userData.wheels = wheels;
  g.userData.paint = paint;
  return g;
}

/* ---------------- шлем (райдер и бонус) ---------------- */
function makeHelmet(M, shellMat, accentMat) {
  const g = new THREE.Group();
  const R = 0.135;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), shellMat);
  shell.scale.set(1, 1, 1.12);
  g.add(shell);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.985, 0.008, 6, 32), M.dark);
  rim.rotation.x = Math.PI / 2; rim.position.y = R * Math.cos(Math.PI * 0.56); rim.scale.set(1, 1.12, 1);
  g.add(rim);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(R * 1.01, 0.007, 6, 32, Math.PI), accentMat);
  stripe.rotation.y = 0.35; g.add(stripe);
  for (const [a, b] of [[-0.5, 0.2], [0, 0.1], [0.5, 0.2], [-0.25, -0.35], [0.25, -0.35]]) {
    const vent = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.04, 3, 6), M.dark);
    const dir = V(Math.sin(a) * Math.cos(b), Math.cos(a) * Math.cos(b), Math.sin(b)).normalize();
    vent.position.copy(dir).multiplyScalar(R * 1.0).multiply(V(1, 1, 1.12));
    vent.lookAt(vent.position.clone().multiplyScalar(2));
    vent.rotateX(Math.PI / 2);
    g.add(vent);
  }
  // маска: ремень, оправа, зеркальная линза
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.036, 28, 1, true), M.strap);
  strap.position.y = -0.012; strap.scale.z = 1.1; g.add(strap);
  const frame = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.1, R * 1.08, 0.068, 20, 1, true, -Math.PI * 0.33, Math.PI * 0.66), M.dark);
  frame.position.y = -0.018; frame.scale.z = 1.1; g.add(frame);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.13, R * 1.11, 0.054, 20, 1, true, -Math.PI * 0.3, Math.PI * 0.6), M.lens);
  lens.position.y = -0.018; lens.scale.z = 1.1; g.add(lens);
  g.traverse(o => { o.castShadow = true; });
  return g;
}

/* ---------------- райдер ---------------- */
class Rider {
  constructor(kind, R, M) {
    this.kind = kind;
    this.root = new THREE.Group();          // позиция на склоне, курс, крен
    this.pivot = new THREE.Group();         // центр вращения для трюков
    this.pivot.position.y = 0.95;
    this.inner = new THREE.Group();
    this.inner.position.y = -0.95;
    this.root.add(this.pivot); this.pivot.add(this.inner);

    // мембранная ткань: плетение в карте нормалей, мягкий отлив по краям (sheen)
    const cloth = (color, rough) => new THREE.MeshPhysicalMaterial({
      color, roughness: rough, sheen: 0.6, sheenRoughness: 0.5, sheenColor: col(color).lerp(col('#ffffff'), 0.5),
      normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.35, 0.35),
    });
    const jacket = cloth(R.jacket, 0.62);
    const jacketDark = cloth(R.jacketDark, 0.66);
    const pants = cloth(R.pants, 0.8);
    const accent = new THREE.MeshStandardMaterial({ color: R.accent, roughness: 0.4, emissive: R.accent, emissiveIntensity: 0.15 });
    this.shellMat = new THREE.MeshPhysicalMaterial({ color: '#1b1c21', roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.3 });
    this.shellAccent = new THREE.MeshStandardMaterial({ color: R.accent, roughness: 0.4 });
    this.mats = { jacket, jacketDark, pants, accent };
    const add = (geo, mat, parent = this.inner) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };

    // ноги
    this.thigh = [0, 1].map(() => add(boneGeo(0.085, 0.072, 0.44), pants));
    this.shin = [0, 1].map(() => add(boneGeo(0.07, 0.062, 0.44), pants));
    this.knee = [0, 1].map(() => add(new THREE.SphereGeometry(0.074, 12, 8), pants));
    // ботинки
    this.boot = [0, 1].map(() => {
      const b = new THREE.Group();
      const bootMat = kind === 'ski' ? M.skiBoot : M.boardBoot;
      const foot = add(new THREE.CapsuleGeometry(0.058, 0.2, 4, 10).rotateX(Math.PI / 2), bootMat, b);
      foot.position.set(0, -0.085, 0.03); foot.scale.set(1, 0.85, 1);
      const shaft = add(new THREE.CylinderGeometry(0.068, 0.072, 0.22, 12), bootMat, b);
      shaft.position.y = 0.0;
      const cuff = add(new THREE.TorusGeometry(0.066, 0.012, 6, 14).rotateX(Math.PI / 2), kind === 'ski' ? accent : M.dark, b);
      cuff.position.y = 0.105;
      if (kind === 'ski') {
        for (const y of [-0.06, 0.0, 0.06]) {
          const buckle = add(new THREE.BoxGeometry(0.03, 0.014, 0.02), M.metal, b);
          buckle.position.set(0.055, y, 0.04);
        }
        const sole = add(new THREE.BoxGeometry(0.1, 0.03, 0.3), M.dark, b);
        sole.position.set(0, -0.125, 0.03);
      } else {
        const lace = add(new THREE.BoxGeometry(0.03, 0.16, 0.012), M.metal, b);
        lace.position.set(0, -0.02, 0.07);
      }
      this.inner.add(b);
      return b;
    });
    // таз и корпус
    this.pelvis = add(new THREE.SphereGeometry(0.15, 16, 10), pants);
    this.pelvis.scale.set(1.15, 0.75, 0.85);
    this.torso = new THREE.Group();
    this.inner.add(this.torso);
    const body = add(new THREE.CapsuleGeometry(0.15, 0.3, 6, 16), jacket, this.torso);
    body.position.y = 0.24; body.scale.set(1.22, 1, 0.86);
    const hem = add(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 20, 1, true), jacketDark, this.torso);
    hem.position.y = 0.04; hem.scale.z = 0.72;
    const band = add(new THREE.CylinderGeometry(0.187, 0.186, 0.055, 24, 1, true), accent, this.torso);
    band.position.y = 0.33; band.scale.z = 0.72;
    const zip = add(new THREE.BoxGeometry(0.012, 0.4, 0.012), M.dark, this.torso);
    zip.position.set(0, 0.25, 0.132);
    for (const s of [-1, 1]) {
      const pocket = add(new THREE.BoxGeometry(0.1, 0.008, 0.01), M.dark, this.torso);
      pocket.position.set(s * 0.09, 0.14, 0.122); pocket.rotation.z = s * 0.35;
    }
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.065), new THREE.MeshStandardMaterial({ map: logoTexture('COULAIR', '#ffffff'), transparent: true, roughness: 0.7 }));
    logo.position.set(0, 0.36, -0.132); logo.rotation.y = Math.PI; this.torso.add(logo);
    const hood = add(new THREE.TorusGeometry(0.085, 0.035, 8, 18).rotateX(Math.PI / 2), jacketDark, this.torso);
    hood.position.y = 0.5;
    // руки
    this.upper = [0, 1].map(i => add(boneGeo(0.058, 0.05, 0.29), i ? jacketDark : jacket));
    this.fore = [0, 1].map(i => add(boneGeo(0.05, 0.046, 0.27), i ? jacketDark : jacket));
    this.elbow = [0, 1].map(i => add(new THREE.SphereGeometry(0.052, 10, 8), i ? jacketDark : jacket));
    this.glove = [0, 1].map(() => {
      const gl = new THREE.Group();
      const palm = add(new THREE.SphereGeometry(0.052, 12, 8), M.glove, gl); palm.scale.set(0.9, 1.15, 1.2);
      const cuffG = add(new THREE.CylinderGeometry(0.056, 0.052, 0.07, 12), M.glove, gl); cuffG.position.y = 0.06;
      this.inner.add(gl);
      return gl;
    });
    // голова
    this.head = new THREE.Group();
    this.inner.add(this.head);
    const face = add(new THREE.SphereGeometry(0.105, 18, 12), M.skin, this.head);
    face.scale.set(0.95, 1.05, 1);
    const buff = add(new THREE.CylinderGeometry(0.1, 0.092, 0.13, 18), M.buff, this.head);
    buff.position.y = -0.085;
    this.helmet = makeHelmet(M, this.shellMat, this.shellAccent);
    this.helmet.position.y = 0.028;
    this.head.add(this.helmet);

    // снаряжение
    this.gear = new THREE.Group();
    this.inner.add(this.gear);
    if (kind === 'ski') {
      this.skis = [0, 1].map(() => { const s = makeSki(M, R); this.gear.add(s); return s; });
      this.poles = [0, 1].map(() => { const p = makePole(M); this.inner.add(p); return p; });
    } else {
      this.board = makeBoard(M, R);
      this.gear.add(this.board);
    }
    this.tmp = { a: V(), b: V(), c: V(), d: V() };
    this.proc = [...this.thigh, ...this.shin, ...this.knee, ...this.boot, this.pelvis, this.torso, ...this.upper, ...this.fore, ...this.elbow, ...this.glove, this.head];
    loadRiderModel(kind).then(g => g && this.attachModel(g));
  }

  attachModel(gltf) {
    const scene = gltf.scene;                               // один райдер на вид — клон не нужен
    this.skin = new THREE.Group();
    this.skin.add(scene);
    this.inner.add(this.skin);
    this.bones = {};
    scene.traverse(o => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
        if (o.material && o.material.name === 'M_Helmet') this.helmetMat = o.material;
      }
    });
    const b = this.bones;
    const dist = (a, c) => wpos(b[a]).distanceTo(wpos(b[c]));
    this.len = {
      thigh: dist('thigh_l', 'calf_l'), calf: dist('calf_l', 'foot_l'),
      upper: dist('upperarm_l', 'lowerarm_l'), fore: dist('lowerarm_l', 'hand_l'),
    };
    this.mixer = new THREE.AnimationMixer(scene);
    this.clips = {};
    for (const c of gltf.animations) this.clips[c.name] = this.mixer.clipAction(c);
    for (const n of ['Death01', 'Hit_Head']) if (this.clips[n]) { this.clips[n].setLoop(THREE.LoopOnce, 1); this.clips[n].clampWhenFinished = true; }
    this.playing = null;
    this.play('Crouch_Idle_Loop');
    for (const o of this.proc) o.visible = false;
    this.helmet.visible = false;
    this.setShield(this._shield);
  }

  play(name, fade = 0.25) {
    const a = this.clips[name];
    if (!a || this.playing === name) return;
    const prev = this.playing && this.clips[this.playing];
    a.reset().setEffectiveWeight(1).play();
    if (prev) prev.crossFadeTo(a, fade, false);
    this.playing = name;
  }

  // скелет повторяет процедурную позу
  drive(pose) {
    const b = this.bones, T = this.tmp;
    const toW = p => this.inner.localToWorld(p.clone());
    // корпус смотрит туда же, куда процедурный (для доски — боком)
    this.skin.rotation.set(0, Math.atan2(this._fwd.x, this._fwd.z), 0);
    this.skin.position.set(0, 0, 0);
    this.skin.updateWorldMatrix(true, true);
    // таз — в точку процедурного таза
    const pelvisT = toW(this._pelvis);
    const cur = wpos(b.pelvis);
    const off = this.skin.parent.worldToLocal(pelvisT.clone()).sub(this.skin.parent.worldToLocal(cur.clone()));
    this.skin.position.add(off);
    this.skin.updateWorldMatrix(true, true);
    // спина: наклон к процедурной груди
    aimBone(b.spine_01, wpos(b.neck_01), toW(this._chest));
    // голова: чуть вниз по склону
    aimBone(b.neck_01, wpos(b.Head), wpos(b.neck_01).add(toW(this._headDir).sub(toW(V()))));
    // ноги: двухзвенный IK с длинами модели
    for (const [side, i] of [['l', 0], ['r', 1]]) {
      const thigh = b['thigh_' + side], calf = b['calf_' + side], foot = b['foot_' + side], ball = b['ball_' + side];
      const hipW = wpos(thigh), ankT = toW(this._ank[i]);
      const hint = toW(this._kneeHint[i]).sub(toW(V()));
      const knee = ik(hipW, ankT, this.len.thigh, this.len.calf, hint, T.a);
      aimBone(thigh, wpos(calf), knee);
      aimBone(calf, wpos(foot), ankT);
      // стопа вдоль ботинка/лыжи, подошвой вниз
      aimBone(foot, wpos(ball), wpos(foot).add(toW(this._footDir[i]).sub(toW(V())).multiplyScalar(0.12)).add(V(0, -0.06, 0)));
    }
    // руки
    for (const [side, i] of [['l', 0], ['r', 1]]) {
      const ua = b['upperarm_' + side], la = b['lowerarm_' + side], hand = b['hand_' + side];
      const shW = wpos(ua), handT = toW(this._hand[i]);
      const hint = toW(this._elbowHint[i]).sub(toW(V()));
      const el = ik(shW, handT, this.len.upper, this.len.fore, hint, T.b);
      aimBone(ua, wpos(la), el);
      aimBone(la, wpos(hand), handT);
      // палка — в настоящую руку модели
      if (this.poles) {
        const real = this.inner.worldToLocal(wpos(hand));
        this.poles[i].position.add(real.sub(this._hand[i]));
      }
    }
  }

  // особые состояния — чистая анимация из библиотеки
  animate(name, dt) {
    this.skin.rotation.set(0, 0, 0);
    this.skin.position.set(0, 0, 0);
    this.play(name, 0.15);
    this.mixer.update(dt);
  }

  setShield(on) {
    this._shield = on;
    if (this.helmetMat) {                                   // шлем-бонус: зелёное свечение
      this.helmetMat.emissive.set(on ? '#5dff3a' : '#000000');
      this.helmetMat.emissiveIntensity = on ? 0.45 : 0;
    }
    this.shellMat.color.set(on ? '#f4f5f7' : '#1b1c21');
    this.shellAccent.color.set(on ? '#5dff3a' : this.kind === 'ski' ? '#ffd23f' : '#5dff3a');
  }

  // pose: c — присед 0..1, grab, plant {side,t}, noGear, look — поворот корпуса к линии спуска, clock
  update(pose) {
    const c = pose.c;
    const f = V(0, 0, 1);
    if (this.kind === 'ski') {
      const ank = s => V(s * 0.12, 0.17, 0.0);
      const pelvis = V(0, 0.95 - c * 0.3, -0.07 - c * 0.14);
      const lean = 0.2 + c * 0.5;
      const chest = pelvis.clone().add(V(0, Math.cos(lean) * 0.46, Math.sin(lean) * 0.46));
      const fwd = V(Math.sin(pose.look), 0, Math.cos(pose.look));
      this.legs(pelvis, ank, V(0, 0, 1), fwd);
      this.body(pelvis, chest, fwd, pose.look * 0.6);
      this._ank = [ank(1).setY(0.1), ank(-1).setY(0.1)];
      this._kneeHint = [V(0.15, 0, 1), V(-0.15, 0, 1)];
      this._footDir = [V(0, 0, 1), V(0, 0, 1)];
      this._elbowHint = [V(1, -0.4, -0.6), V(-1, -0.4, -0.6)];
      this._hand = [];
      for (const [i, s] of [[0, 1], [1, -1]]) {
        const plant = pose.plant && pose.plant.side === -s ? Math.sin((pose.plant.t / 0.3) * Math.PI) : 0;
        const sh = this.shoulder(chest, fwd, s);
        let hand;
        if (pose.grab) hand = V(s * 0.1, 0.3, 0.28);
        else hand = V(s * 0.3, pelvis.y + 0.1 + plant * 0.08, pelvis.z + 0.42 + plant * 0.12);
        this.arm(i, sh, hand, V(s, -0.4, -0.6));
        this._hand[i] = hand.clone();
        const tipT = pose.grab ? V(s * 0.25, hand.y - 0.2, hand.z - 1.1)
          : V(s * (0.42 - plant * 0.08), 0, lerp(hand.z - 0.6, hand.z + 0.3, plant));
        const pole = this.poles[i];
        pole.visible = !pose.noGear;
        orient(pole, hand, hand.clone().add(tipT.sub(hand).normalize()), V(0, 0, 1));
      }
      this.skis.forEach((sk, i) => { sk.position.set(i ? -0.12 : 0.12, 0.02, 0.02); sk.visible = !pose.noGear; });
    } else {
      // сноубордист стоит боком: носки к +X, передняя нога к +Z
      const ank = s => V(0, 0.16, s * 0.25);
      const pelvis = V(0.04 + c * 0.1, 0.92 - c * 0.3, 0);
      const lean = 0.12 + c * 0.35;
      const chest = pelvis.clone().add(V(Math.sin(lean) * 0.46, Math.cos(lean) * 0.46, 0.02));
      const fwd = V(1, 0, 0.5).normalize();
      this.legs(pelvis, ank, V(1, 0, 0), V(1, 0, 0), true);
      this.body(pelvis, chest, fwd, 0);
      this._ank = [ank(1).setY(0.1), ank(-1).setY(0.1)];
      this._kneeHint = [V(1, 0, 0.35), V(1, 0, -0.35)];
      this._footDir = [V(1, 0, 0.25).normalize(), V(1, 0, -0.25).normalize()];
      this._elbowHint = [V(-0.3, -0.5, 0.4), V(-0.3, -0.5, -0.4)];
      this._hand = [];
      const sway = Math.sin(pose.clock * 3.2) * 0.06;
      for (const [i, s] of [[0, 1], [1, -1]]) {
        const sh = this.shoulder(chest, fwd, -s);
        let hand;
        if (pose.grab && s === 1) hand = V(0.16, 0.2, 0.02);
        else if (pose.grab) hand = V(0.1, chest.y - 0.25, -0.45);
        else hand = V(0.14, chest.y - 0.3 + s * sway + pose.turn * s * 0.08, s * (0.6 - c * 0.08));
        this.arm(i, sh, hand, V(-0.3, -0.5, s * 0.4));
        this._hand[i] = hand.clone();
      }
      this.board.position.set(0, 0.03, 0);
    }
    // голова смотрит вниз по склону, чуть вперёд
    const headFwd = this.kind === 'ski' ? V(Math.sin(pose.look * 0.4), -0.25, 1) : V(0.35, -0.2, 1);
    const hp = this.head.position.clone();
    orient(this.head, hp, hp.clone().add(V(0, 1, 0)), headFwd.normalize());
    if (this.skin) {
      this._headDir = V(0, 1, 0).addScaledVector(headFwd, 0.35).normalize();
      if (pose.anim) this.animate(pose.anim, pose.dt || 0.016);
      else { this.mixer.update(pose.dt || 0.016); this.play('Crouch_Idle_Loop'); this.drive(pose); }
    }
  }

  legs(pelvis, ank, kneeHint, fwd, board) {
    for (const [i, s] of [[0, 1], [1, -1]]) {
      const hip = pelvis.clone().add(board ? V(0, -0.03, s * 0.1) : V(s * 0.1, -0.03, 0));
      const a = ank(s);
      const knee = ik(hip, a, 0.44, 0.44, kneeHint.clone().add(board ? V(0, 0, s * 0.35) : V(s * 0.15, 0, 0)), V());
      orient(this.thigh[i], hip, knee, fwd);
      orient(this.shin[i], knee, a, fwd);
      this.knee[i].position.copy(knee);
      const boot = this.boot[i];
      boot.position.copy(a);
      boot.rotation.set(0, board ? Math.PI / 2 + s * 0.25 : 0, 0);
    }
  }

  body(pelvis, chest, fwd) {
    this._pelvis = pelvis.clone();
    orient(this.pelvis, pelvis, pelvis.clone().add(V(0, 1, 0)), fwd);
    orient(this.torso, pelvis, chest, fwd);
    this._chest = chest; this._fwd = fwd;
    const up = V().subVectors(chest, pelvis).normalize();
    this.head.position.copy(chest).addScaledVector(up, 0.17).addScaledVector(fwd, 0.03);
  }

  shoulder(chest, fwd, s) {
    const side = V().crossVectors(V(0, 1, 0), fwd).normalize();   // +side = влево от взгляда
    return chest.clone().addScaledVector(side, s * 0.2).add(V(0, -0.04, 0));
  }

  arm(i, sh, hand, hint) {
    const el = ik(sh, hand, 0.29, 0.27, hint.normalize(), V());
    orient(this.upper[i], sh, el, V(0, 0, 1));
    orient(this.fore[i], el, hand, V(0, 0, 1));
    this.elbow[i].position.copy(el);
    const gl = this.glove[i];
    orient(gl, hand, hand.clone().sub(el).add(hand), V(0, 1, 0));
    gl.position.copy(hand);
    gl.rotateX(Math.PI);
  }
}

const SKI_TOPS = {};
function makeSki(M, R) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.085, 0.022, 1.7, 1, 1, 24);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (z > 0.55) { const t = (z - 0.55) / 0.3; y += t * t * 0.11; z -= t * t * 0.03; x *= 1 + t * 0.12 - Math.max(0, t - 0.8) * 1.2; }
    if (z < -0.75) { const t = (-z - 0.75) / 0.1; y += t * t * 0.025; }
    x *= 1 - 0.1 * Math.cos((z / 0.85) * Math.PI * 0.5);            // талия
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const key = R.ski + R.accent;
  const top = SKI_TOPS[key] || (SKI_TOPS[key] = new THREE.MeshStandardMaterial({ map: skiTopTexture(R.ski, R.accent), roughness: 0.35, metalness: 0.1 }));
  const ski = new THREE.Mesh(geo, [M.dark, M.dark, top, M.base, M.dark, M.dark]);
  ski.castShadow = true;
  g.add(ski);
  const binding = (z, len, h) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.075, h, len), M.binding); b.position.set(0, 0.011 + h / 2, z); b.castShadow = true; g.add(b); };
  binding(0.2, 0.08, 0.045); binding(-0.15, 0.1, 0.055);
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.015, 0.04), M.red);
  brake.position.set(0, 0.03, -0.2); g.add(brake);
  return g;
}

function makePole(M) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(boneGeo(0.009, 0.007, 1.15, 6), M.poleShaft);
  shaft.castShadow = true; g.add(shaft);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.015, 0.15, 10), M.dark);
  grip.position.y = 0.04; g.add(grip);
  const basket = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 5, 14).rotateX(Math.PI / 2), M.dark);
  basket.position.y = 1.05; g.add(basket);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.05, 6), M.metal);
  tip.position.y = 1.17; g.add(tip);
  return g;                                 // +Y — от рукояти к наконечнику
}

function makeBoard(M, R) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.29, 1.56, 6, 40).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const az = Math.abs(z);
    let half = 0.145 - 0.012 * Math.cos((z / 0.62) * Math.PI * 0.5);
    if (az > 0.62) half *= Math.sqrt(Math.max(0.05, 1 - Math.pow((az - 0.62) / 0.16, 2)));
    x = (x / 0.145) * half;
    if (az > 0.56) y += Math.pow((az - 0.56) / 0.22, 2) * 0.08;
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const top = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: boardTopTexture(R.accent), roughness: 0.4, metalness: 0.1 }));
  top.position.y = 0.008; top.castShadow = true; g.add(top);
  const bottom = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#0c0c0e', roughness: 0.3, side: THREE.BackSide }));
  bottom.position.y = -0.006; g.add(bottom);
  const edge = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#9aa1ab', metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
  edge.scale.set(1.02, 1, 1.01); g.add(edge);
  for (const z of [-0.25, 0.25]) {
    const b = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.14), M.binding); plate.position.y = 0.022; b.add(plate);
    const high = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 12, 1, true, Math.PI * 1.25, Math.PI * 0.5), M.dark);
    high.material = M.darkDouble; high.position.set(0.02, 0.13, 0); high.rotation.z = 0.25; b.add(high);
    for (const x of [0.05, -0.04]) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 5, 12, Math.PI), M.accentBoard(R.accent));
      strap.position.set(x, 0.07, 0); strap.rotation.y = Math.PI / 2; b.add(strap);
    }
    b.position.z = z; b.rotation.y = z > 0 ? 0.25 : -0.25;
    b.traverse(o => { o.castShadow = true; });
    g.add(b);
  }
  return g;
}

/* ---------------- частицы (снежная пыль, падающий снег) ---------------- */
function pointsMaterial(tex, color, opacity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, color: { value: col(color) }, scale: { value: 500 }, opacity: { value: opacity } },
    vertexShader: `
      attribute float size; attribute float alpha; varying float vA; uniform float scale;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv; vA = alpha;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 color; uniform float opacity; varying float vA;
      void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(color, t.a * vA * opacity);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
}

function pointsGeo(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  return g;
}

/* =====================================================================
   Сцена
   ===================================================================== */
export function create(root, canvas2d) {
  const canvas = document.createElement('canvas');
  canvas.className = 'game__canvas game__canvas--3d';
  canvas.hidden = true;
  canvas2d.after(canvas);

  const coarse = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const FOG = col('#bccde2');
  scene.fog = new THREE.FogExp2(FOG, 0.0036);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);

  // небо: физическая модель рассеяния (Preetham)
  const makeSky = size => {
    const s = new Sky();
    s.scale.setScalar(size);
    const u = s.material.uniforms;
    u.turbidity.value = 2.2; u.rayleigh.value = 1.25; u.mieCoefficient.value = 0.0045; u.mieDirectionalG.value = 0.86;
    u.sunPosition.value.copy(SUN);
    return s;
  };
  const sky = makeSky(5000);
  scene.add(sky);

  // отражения и рассеянный свет — из того же неба плюс отражённый снегом свет снизу
  {
    const envScene = new THREE.Scene();
    envScene.add(makeSky(50));
    const snowDisk = new THREE.Mesh(new THREE.CircleGeometry(48, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col('#dfe8f4').multiplyScalar(1.6) }));
    snowDisk.position.y = -2; envScene.add(snowDisk);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.03).texture;
    scene.environmentIntensity = 0.9;
    pmrem.dispose();
  }

  // свет
  const hemi = new THREE.HemisphereLight('#b9d0f0', '#eef2f8', 0.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe9cf', 4.2);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 220 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // дальние горы и лесистые хребты — следуют за камерой, всегда на горизонте
  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, fog: false });
  const far = new THREE.Group();
  far.add(new THREE.Mesh(mountainGeometry({ inner: 1600, outer: 3600, height: 700, base: -640, seed: 7, scale: 900, rock: '#5d6573', forest: '#4a5360', snowLine: 0.42, haze: '#aebfd6', hazeK: 0.5 }), farMat));
  far.add(new THREE.Mesh(mountainGeometry({ inner: 700, outer: 1400, height: 270, base: -390, seed: 19, scale: 420, rock: '#5a6068', forest: '#1f3328', snowLine: 0.78, haze: '#a6b8cf', hazeK: 0.38 }), farMat));
  scene.add(far);
  const clouds = [];
  const cloudTex = cloudTexture();
  for (let i = 0; i < 9; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, depthWrite: false, opacity: 0.55, color: col('#ffffff').multiplyScalar(1.4) }));
    const a = rand(-1.4, 1.4) + Math.PI / 2, d = rand(2800, 3600);
    sp.userData = { a, d, h: rand(250, 700), w: rand(900, 1700) };
    sp.scale.set(sp.userData.w, sp.userData.w * 0.35, 1);
    clouds.push(sp); scene.add(sp);
  }

  // склон: всё игровое — в группе, наклонённой на угол склона
  const world = new THREE.Group();
  world.rotation.x = SLOPE;
  scene.add(world);

  const snowMap = snowTexture(), grooves = grooveNormalTexture();
  snowMap.repeat.set(1 / GROUND_TILE, 1 / GROUND_TILE);
  grooves.repeat.set(1 / GROOVE_TILE, 1 / GROOVE_TILE);
  const CELL = 4;                                            // шаг сетки рельефа, м
  const groundGeo = new THREE.PlaneGeometry(1000, 640, 250, 160).rotateX(-Math.PI / 2).translate(0, 0, 230);
  {
    const p = groundGeo.attributes.position, uv = groundGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, -p.getX(i), p.getZ(i));   // UV в метрах
  }
  const terrU = { uOff: { value: new THREE.Vector2() }, uShift: { value: new THREE.Vector2() }, uRef: { value: 0 }, uRoad: { value: new THREE.Vector2(-1e9, 0) } };
  const groundMat = new THREE.MeshStandardMaterial({ map: snowMap, normalMap: grooves, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.72, color: '#ffffff' });
  // искры на снегу: крошечные «грани» кристаллов отражают солнце, только на освещённом снегу и вблизи
  groundMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, terrU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;' + TERRAIN_GLSL)
      .replace('#include <beginnormal_vertex>', `
        vec3 lp = position + vec3(uShift.x, 0.0, uShift.y);
        float gx = -lp.x + uOff.x, gz = lp.z + uOff.y;
        float tH = terrH(gx, gz);
        const float E = 0.9;
        float dX = terrH(gx + E, gz) - terrH(gx - E, gz);
        float dZ = terrH(gx, gz + E) - terrH(gx, gz - E);
        vec3 objectNormal = normalize(vec3(dX / (2.0 * E), 1.0, -dZ / (2.0 * E)));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += tH - uRef;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <opaque_fragment>', `{
        vec3 Vd = normalize(cameraPosition - vWP);
        vec3 cell = floor(vWP * 26.0);
        float h1 = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float h2 = fract(sin(dot(cell, vec3(39.3468, 11.135, 83.155))) * 24634.6345);
        vec3 fn = normalize(vec3(h1 - 0.5, 0.55, h2 - 0.5));
        float spec = pow(max(dot(fn, normalize(Vd + ${glslVec(SUN)})), 0.0), 700.0);
        float lit = smoothstep(0.2, 0.9, dot(reflectedLight.directDiffuse, vec3(0.3333)));
        float fade = smoothstep(45.0, 3.0, length(cameraPosition - vWP));
        outgoingLight += vec3(1.0, 0.96, 0.88) * spec * lit * fade * 40.0 * step(0.62, h1);
      }
      #include <opaque_fragment>`);
  };
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.frustumCulled = false;
  world.add(ground);

  /* ----- постобработка и уровни качества ----- */
  const GradeShader = {
    defines: { BLUR_N: 8 },
    uniforms: {
      tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uSpeed: { value: 0 }, uTime: { value: 0 },
      uSun: { value: new THREE.Vector3() },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uSpeed, uTime; uniform vec3 uSun; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float aspect = uRes.x / uRes.y;
        vec2 d = vUv - 0.5; float r = length(d * vec2(aspect, 1.0));
        // размытие к краям на скорости + лёгкая хроматическая аберрация
        float blur = uSpeed * 0.05 * smoothstep(0.25, 0.95, r);
        float ca = 0.0012 + uSpeed * 0.0018;
        vec3 c = vec3(0.0);
        for (int i = 0; i < BLUR_N; i++) {
          vec2 uv = vUv - d * blur * (float(i) / float(BLUR_N));
          c.r += texture2D(tDiffuse, uv - d * ca * r).r;
          c.g += texture2D(tDiffuse, uv).g;
          c.b += texture2D(tDiffuse, uv + d * ca * r).b;
        }
        c /= float(BLUR_N);
        // блики объектива от солнца: «призраки» по линии солнце — центр кадра
        if (uSun.z > 0.001) {
          vec2 axis = vec2(0.5) - uSun.xy;
          for (int k = 0; k < 5; k++) {
            float f = float(k);
            float t = 0.45 + f * 0.33;
            vec2 gp = uSun.xy + axis * t * 2.0;
            float size = 0.025 + 0.035 * fract(f * 0.618);
            float dd = length((vUv - gp) * vec2(aspect, 1.0));
            vec3 tint = mix(vec3(1.0, 0.75, 0.45), vec3(0.45, 0.75, 1.0), fract(f * 0.37 + 0.2));
            c += tint * smoothstep(size, size * 0.55, dd) * 0.045 * uSun.z;
          }
          float ds = length((vUv - uSun.xy) * vec2(aspect, 1.0));
          c += vec3(1.0, 0.9, 0.75) * (exp(-ds * 9.0) * 0.18 + smoothstep(0.2, 0.19, ds) * smoothstep(0.17, 0.19, ds) * 0.03) * uSun.z;
        }
        // цвет: насыщенность, мягкая S-кривая, холодные тени и тёплые света
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.12);
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
        c *= mix(vec3(0.95, 0.99, 1.06), vec3(1.04, 1.0, 0.95), smoothstep(0.15, 0.85, l));
        c *= mix(1.0, 0.68, smoothstep(0.5, 1.15, r));
        c += (hash(vUv * uRes + fract(uTime * 7.1) * 311.0) - 0.5) * 0.022;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  };
  const QUALITY = {
    high:   { pr: 1.5,  samples: 4, shadow: 4096, blurN: 8 },
    medium: { pr: 1.25, samples: 2, shadow: 2048, blurN: 4 },
    low:    { pr: 1,    samples: 0, shadow: 1024, blurN: 0 },
  };
  let forcedQ = null;
  try { const s = localStorage.getItem(QUALITY_KEY); if (QUALITY[s]) forcedQ = s; } catch { /* приватный режим */ }
  let qName = null, composer = null, grade = null, bloom = null, settle = 0;
  const foliageMats = [];

  function setQuality(name) {
    qName = name;
    const q = QUALITY[name];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (composer) { composer.dispose(); composer = null; grade = bloom = null; }
    if (q.blurN) {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q.samples });
      composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 2.4);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      grade = new ShaderPass({ ...GradeShader, defines: { BLUR_N: q.blurN } });
      composer.addPass(grade);
    }
    for (const m of foliageMats) { m.alphaToCoverage = q.samples > 0; m.needsUpdate = true; }
    settle = 150;
    resize(W, H);
  }

  /* ----- общие материалы и геометрии ----- */
  const M = {
    tire: new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.9 }),
    headlight: new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff4d6', emissiveIntensity: 6 }),
    taillight: new THREE.MeshStandardMaterial({ color: '#b91c1c', emissive: '#ff2020', emissiveIntensity: 4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#0d141c', metalness: 0.2, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6, side: THREE.DoubleSide }),
    bumper: new THREE.MeshStandardMaterial({ color: '#23252b', roughness: 0.6 }),
    trailerSide: new THREE.MeshStandardMaterial({ map: canvasTex(1024, 256, (g, w, h) => {
      g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d9352b'; g.fillRect(0, h - 34, w, 14);
      g.fillStyle = '#16161a'; g.font = '900 112px Manrope, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('COULAIR CLUB', w / 2, h / 2 - 8);
    }), roughness: 0.5 }),
    trailerTop: new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.6 }),
    trailerEnd: new THREE.MeshStandardMaterial({ color: '#d1d5db', roughness: 0.5, metalness: 0.3 }),
    accentStripe: new THREE.MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.55 }),
    darkDouble: new THREE.MeshStandardMaterial({ color: '#1c1d22', roughness: 0.55, side: THREE.DoubleSide }),
    strap: new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.8, side: THREE.DoubleSide }),
    lens: new THREE.MeshPhysicalMaterial({ map: lensTexture(), metalness: 0.85, roughness: 0.08, clearcoat: 1, side: THREE.DoubleSide, envMapIntensity: 1.6 }),
    metal: new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.9, roughness: 0.28 }),
    poleShaft: new THREE.MeshStandardMaterial({ color: '#b8c0cc', metalness: 0.8, roughness: 0.3 }),
    binding: new THREE.MeshStandardMaterial({ color: '#8e96a2', metalness: 0.6, roughness: 0.35 }),
    red: new THREE.MeshStandardMaterial({ color: '#e3342f', roughness: 0.5 }),
    base: new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.3 }),
    skiBoot: new THREE.MeshPhysicalMaterial({ color: '#3a3f47', roughness: 0.35, clearcoat: 0.6 }),
    boardBoot: new THREE.MeshStandardMaterial({ color: '#2b2e34', roughness: 0.8 }),
    glove: new THREE.MeshStandardMaterial({ color: '#18181c', roughness: 0.75 }),
    skin: new THREE.MeshStandardMaterial({ color: '#e9b78f', roughness: 0.7 }),
    buff: new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.9 }),
    _accent: {},
    accentBoard(c) { return this._accent[c] || (this._accent[c] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 })); },
  };
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95 });
  const fillMat = new THREE.MeshStandardMaterial({ color: '#0b2013', roughness: 1 });
  const moundMat = new THREE.MeshStandardMaterial({ color: '#f4f8fd', roughness: 0.75 });
  const branchMats = [[1, 1], [2, 1.4], [3, 0.7]].map(([seed, snowAmt]) => {
    const m = new THREE.MeshStandardMaterial({ map: branchTexture(seed, snowAmt), alphaTest: 0.32, side: THREE.DoubleSide, roughness: 0.85 });
    foliageMats.push(m);
    return m;
  });
  const treeGeos = Array.from({ length: 8 }, (_, i) => treeGeometry(i + 1));
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  const rocks = Array.from({ length: 6 }, (_, i) => rockGeometry(i + 1));
  const driftGeo = new THREE.SphereGeometry(1, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const kickerSnow = snowMap.clone(); kickerSnow.repeat.set(0.25, 0.25); kickerSnow.offset.set(0, 0);
  const kickerGroove = grooves.clone(); kickerGroove.repeat.set(1 / GROOVE_TILE, 1 / GROOVE_TILE); kickerGroove.offset.set(0, 0);
  kickerSnow.repeat.set(2, 2); kickerGroove.repeat.set(3, 3);
  const groundLikeMat = new THREE.MeshStandardMaterial({ map: kickerSnow, normalMap: kickerGroove, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.74 });
  const kickerGeo = snowKickerGeometry(KICKERS.ramp, 11);
  const bigKickerGeo = snowKickerGeometry(KICKERS.bigramp, 23);
  const roadTex = roadTexture();
  roadTex.repeat.set(1000 / 40, 1);
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.62, metalness: 0.05 });
  const bankGeo = (() => {
    const g = new THREE.CylinderGeometry(1, 1, 1000, 14, 250, false).rotateZ(Math.PI / 2);
    const p = g.attributes.position, n = perlin(41);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), k = 1 + n(x * 0.15, 0.3, 0.7) * 0.35 + n(x * 0.6, 1.3, 0.2) * 0.12;
      p.setY(i, p.getY(i) * k); p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  })();
  const bankMat = new THREE.MeshStandardMaterial({ map: snowMap.clone(), color: '#e3e8f0', roughness: 0.85 });
  bankMat.map.repeat.set(1 / 12, 1 / 12);
  const signMats = { '-1': new THREE.MeshStandardMaterial({ map: signTexture(-1), roughness: 0.5, transparent: true, alphaTest: 0.5 }), '1': new THREE.MeshStandardMaterial({ map: signTexture(1), roughness: 0.5, transparent: true, alphaTest: 0.5 }) };
  // контактные тени — мягкие тёмные пятна на снегу под объектами
  const aoTex = aoTexture();
  const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const aoMat = new THREE.MeshBasicMaterial({ map: aoTex, color: '#0f1c30', transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const decal = (size, opacity = 1) => {
    const d = new THREE.Mesh(decalGeo, opacity === 1 ? aoMat : Object.assign(aoMat.clone(), { opacity: aoMat.opacity * opacity }));
    d.scale.set(size, 1, size); d.position.y = 0.012; d.renderOrder = 1;
    return d;
  };
  const flakeGeo = flakeGeometry();
  const flakeMat = new THREE.MeshStandardMaterial({ color: '#8cc4ff', emissive: '#2a78e6', emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.2 });
  const glowBlue = new THREE.SpriteMaterial({ map: softDot('70,150,255'), depthWrite: false, opacity: 0.45 });
  const glowGreen = new THREE.SpriteMaterial({ map: softDot('70,230,40'), depthWrite: false, opacity: 0.4 });
  const sparkMat = new THREE.SpriteMaterial({ map: softDot('255,255,255'), blending: THREE.AdditiveBlending, depthWrite: false });
  const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.9, 10).translate(0, 0.95, 0);
  const poleMats = { red: new THREE.MeshStandardMaterial({ map: stripeTexture('#d9352b', '#ffffff'), roughness: 0.4 }), blue: new THREE.MeshStandardMaterial({ map: stripeTexture('#2466d9', '#ffffff'), roughness: 0.4 }) };
  const flagMats = { red: new THREE.MeshStandardMaterial({ map: flagTexture('#e8453a', '#b8261d'), side: THREE.DoubleSide, roughness: 0.7 }), blue: new THREE.MeshStandardMaterial({ map: flagTexture('#3478ee', '#1a4fb0'), side: THREE.DoubleSide, roughness: 0.7 }) };
  const gateLineMat = new THREE.MeshBasicMaterial({
    map: canvasTex(128, 8, (g, w, h) => { for (let x = 0; x < w; x += 16) { g.fillStyle = '#2466d9'; g.fillRect(x, 0, 10, h); } }),
    transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const stumpGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.7, 12).translate(0, 0.35, 0);
  const stumpBark = new THREE.MeshStandardMaterial({ color: '#5a3820', roughness: 0.95, flatShading: true });
  const ringMat = new THREE.MeshStandardMaterial({ map: stumpTopTexture(), roughness: 0.9 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: '#f6f9fd', roughness: 0.8 });
  // общие геометрии не удаляются вместе с объектами трассы
  for (const g of [...treeGeos, ...rocks, kickerGeo, bigKickerGeo, flakeGeo, poleGeo, stumpGeo, decalGeo, driftGeo, bankGeo]) g.userData.shared = true;
  const disposeTree = obj => obj.traverse(m => { if (m.isMesh && !m.geometry.userData.shared) m.geometry.dispose(); });

  const riders = {};
  const pickupHelmetMat = new THREE.MeshPhysicalMaterial({ color: '#1b1c21', roughness: 0.4, clearcoat: 0.8 });
  const pickupAccent = new THREE.MeshStandardMaterial({ color: '#5dff3a', emissive: '#5dff3a', emissiveIntensity: 0.5 });

  /* ----- фабрики объектов трассы ----- */
  /* ----- снежная куча (в ней прячется йети) ----- */
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffd84a' });
  const holeMat = new THREE.MeshBasicMaterial({ color: '#1b2233', transparent: true, opacity: 0.8 });
  function makeSnowpile(o) {
    const g = new THREE.Group();
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1.7, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), moundMat);
    mound.scale.set(1, 0.72, 0.85); mound.castShadow = true; mound.receiveShadow = true;
    const lumps = [0, 1, 2].map(i => {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.55 + i * 0.1, 12, 8), whiteMat);
      l.scale.y = 0.7; l.position.set(Math.cos(i * 2.3) * 1.1, 0.35, Math.sin(i * 2.3) * 0.8); l.castShadow = true;
      return l;
    });
    const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 1.1, 5), new THREE.MeshStandardMaterial({ color: '#5b3a24', roughness: 0.9 }));
    twig.position.set(0.7, 1.3, 0.2); twig.rotation.z = -0.6;
    // щель с глазами смотрит вверх по склону — навстречу райдеру
    const hole = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 6), holeMat);
    hole.scale.set(1, 0.4, 0.3); hole.position.set(0, 0.62, -1.28); hole.visible = false;
    const eyes = new THREE.Group();
    for (const x of [-0.17, 0.17]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), eyeMat);
      e.position.set(x, 0.64, -1.4); eyes.add(e);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot('255,200,60'), depthWrite: false, opacity: 0.5 }));
    glow.scale.set(1.2, 0.6, 1); glow.position.set(0, 0.64, -1.45); eyes.add(glow);
    eyes.visible = false;
    g.add(mound, ...lumps, twig, hole, eyes, decal(4.2, 0.8));
    g.userData = { mound, lumps, eyes, hole, burst: false };
    return g;
  }

  /* ----- йети: мех, синеватое лицо, клыки, когти ----- */
  const furTex = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#f3f6fb'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * w, y = Math.random() * h, l = 6 + Math.random() * 12;
      c.strokeStyle = Math.random() < 0.5 ? 'rgba(170,190,215,.35)' : 'rgba(255,255,255,.8)';
      c.lineWidth = 1 + Math.random();
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 2, y + l / 2, x - 1, y + l); c.stroke();
    }
  }, { repeat: true });
  furTex.repeat.set(2, 2);
  const furMat = new THREE.MeshStandardMaterial({ map: furTex, color: '#ffffff', roughness: 0.95 });
  const yetiSkin = new THREE.MeshStandardMaterial({ color: '#7e95b3', roughness: 0.65 });
  const yetiDark = new THREE.MeshStandardMaterial({ color: '#1e2533', roughness: 0.6 });
  const yetiMouth = new THREE.MeshStandardMaterial({ color: '#5b0f1a', roughness: 0.5 });
  const fangMat = new THREE.MeshStandardMaterial({ color: '#fbfbf6', roughness: 0.3 });
  const yetiEye = new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: '#ff3b1f', emissiveIntensity: 1.6 });
  function makeYeti() {
    const g = new THREE.Group();
    const up = new THREE.Group(); up.rotation.x = -SLOPE; g.add(up);          // стоит вертикально на склоне
    const yawG = new THREE.Group(); up.add(yawG);
    const body = new THREE.Group(); yawG.add(body);
    const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
    const torso = mesh(new THREE.SphereGeometry(1, 20, 16), furMat, 0, 1.6, 0); torso.scale.set(0.78, 0.98, 0.62); body.add(torso);
    const belly = mesh(new THREE.SphereGeometry(1, 16, 12), yetiSkin, 0, 1.45, 0.32); belly.scale.set(0.42, 0.55, 0.32);
    belly.material = new THREE.MeshStandardMaterial({ color: '#c9d6e8', roughness: 0.9 }); body.add(belly);
    // пряди-клочья по контуру
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const tuft = mesh(new THREE.ConeGeometry(0.13, 0.42, 5), furMat, Math.cos(a) * 0.72, 1.6 + Math.sin(a * 2) * 0.35, Math.sin(a) * 0.5);
      tuft.rotation.z = -Math.cos(a) * 1.3; tuft.rotation.x = Math.sin(a) * 1.3; body.add(tuft);
    }
    // голова
    const head = new THREE.Group(); head.position.set(0, 2.55, 0.05); body.add(head);
    const skull = mesh(new THREE.SphereGeometry(0.48, 18, 14), furMat, 0, 0, 0); skull.scale.set(1, 0.95, 0.95); head.add(skull);
    const face = mesh(new THREE.SphereGeometry(0.33, 16, 12), yetiSkin, 0, -0.04, 0.3); face.scale.set(1, 1, 0.55); head.add(face);
    for (const x of [-0.12, 0.12]) {
      head.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), yetiEye, x, 0.06, 0.46));
      const brow = mesh(new THREE.BoxGeometry(0.17, 0.04, 0.05), yetiDark, x, 0.15, 0.45); brow.rotation.z = x > 0 ? 0.45 : -0.45; head.add(brow);
    }
    const mouth = mesh(new THREE.SphereGeometry(0.15, 12, 8), yetiMouth, 0, -0.16, 0.45); mouth.scale.set(1.25, 0.8, 0.45); head.add(mouth);
    for (const x of [-0.08, 0.08]) {
      const f = mesh(new THREE.ConeGeometry(0.03, 0.1, 5), fangMat, x, -0.08, 0.52); f.rotation.x = Math.PI; head.add(f);
    }
    // руки: шарнир в плече, висят вниз
    const arms = [-1, 1].map(sd => {
      const pivot = new THREE.Group(); pivot.position.set(sd * 0.74, 2.1, 0);
      const arm = mesh(new THREE.CapsuleGeometry(0.21, 0.85, 4, 10), furMat, 0, -0.55, 0); pivot.add(arm);
      const hand = mesh(new THREE.SphereGeometry(0.21, 12, 10), yetiSkin, 0, -1.12, 0); pivot.add(hand);
      for (const c of [-0.09, 0, 0.09]) {
        const claw = mesh(new THREE.ConeGeometry(0.035, 0.16, 5), yetiDark, c, -1.3, 0.08); claw.rotation.x = Math.PI - 0.4; pivot.add(claw);
      }
      body.add(pivot);
      return pivot;
    });
    // ноги: шарнир в бедре
    const legs = [-1, 1].map(sd => {
      const pivot = new THREE.Group(); pivot.position.set(sd * 0.34, 0.98, 0);
      pivot.add(mesh(new THREE.CapsuleGeometry(0.25, 0.5, 4, 10), furMat, 0, -0.45, 0));
      const foot = mesh(new THREE.SphereGeometry(0.3, 12, 8), yetiSkin, 0, -0.9, 0.14); foot.scale.set(1, 0.45, 1.45); pivot.add(foot);
      body.add(pivot);
      return pivot;
    });
    g.add(decal(3.4, 0.9));
    g.userData = { yawG, body, arms, legs, mouth, head };
    return g;
  }

  /* ----- знак «чёрная трасса» ----- */
  const steepTex = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#d1d5db'; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
    c.save(); c.translate(w / 2, h / 2 - 10); c.rotate(Math.PI / 4); c.fillStyle = '#111'; c.fillRect(-26, -26, 52, 52); c.restore();
    c.fillStyle = '#111'; c.font = '800 20px Manrope, sans-serif'; c.textAlign = 'center'; c.fillText('КРУТО', w / 2, h - 12);
  });
  const steepPlateMat = new THREE.MeshStandardMaterial({ map: steepTex, roughness: 0.6 });
  function makeSteepSign() {
    const g = new THREE.Group();
    g.rotation.x = -SLOPE;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 8).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ color: '#6b7280', metalness: 0.6, roughness: 0.4 }));
    post.castShadow = true; g.add(post);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), steepPlateMat);
    plate.position.set(0, 2.4, -0.06); plate.rotation.y = Math.PI; plate.castShadow = true; g.add(plate);
    return g;
  }

  const make = {
    snowpile: makeSnowpile,
    yeti: makeYeti,
    steepsign: makeSteepSign,
    tree(o) {
      const g = new THREE.Group();
      const i = (Math.random() * treeGeos.length) | 0;
      const m = new THREE.Mesh(treeGeos[i], [barkMat, fillMat, branchMats[i % branchMats.length], moundMat]);
      const k = (o.h * 0.1) / 8;
      m.scale.set(k * rand(0.9, 1.1), k, k * rand(0.9, 1.1));
      m.rotation.set(-SLOPE, rand(0, Math.PI * 2), 0);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m, decal(5.5 * k));
      g.userData.mesh = m; g.userData.sway = Math.random() * 6;
      return g;
    },
    rock(o) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(rocks[(Math.random() * rocks.length) | 0], rockMat);
      const k = o.w * S * 0.55;
      m.scale.set(k, k * rand(0.8, 1.1), k * rand(0.8, 1.1));
      m.rotation.y = rand(0, Math.PI * 2);
      m.castShadow = true; m.receiveShadow = true;
      const drift = new THREE.Mesh(driftGeo, moundMat);
      drift.scale.set(k * 1.1, k * 0.16, k * 0.75); drift.position.set(k * 0.3, -0.05, -k * 0.25); drift.receiveShadow = true;
      g.add(m, drift, decal(k * 3.4));
      return g;
    },
    stump() {
      const g = new THREE.Group();
      const s = new THREE.Mesh(stumpGeo, [stumpBark, ringMat, stumpBark]);
      s.castShadow = true; g.add(s);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), whiteMat);
      cap.scale.y = 0.35; cap.position.set(-0.05, 0.7, 0.03); g.add(cap);
      for (const a of [0.4, 2.3, 4.1]) {
        const root2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.6, 6).rotateZ(Math.PI / 2 - 0.3), stumpBark);
        root2.position.set(Math.cos(a) * 0.45, 0.06, Math.sin(a) * 0.45); root2.rotation.y = -a; root2.castShadow = true; g.add(root2);
      }
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), whiteMat);
      mound.scale.y = 0.18; g.add(mound, decal(2.2, 0.8));
      g.rotation.y = rand(0, Math.PI * 2);
      return g;
    },
    ramp() {
      const k = new THREE.Mesh(kickerGeo, groundLikeMat);
      k.castShadow = true; k.receiveShadow = true;
      return k;
    },
    bigramp() {
      const k = new THREE.Mesh(bigKickerGeo, groundLikeMat);
      k.castShadow = true; k.receiveShadow = true;
      return k;
    },
    sign(o) {
      const g = new THREE.Group();
      g.rotation.x = -SLOPE;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.4, 8).translate(0, 1.2, 0), M.metal);
      post.castShadow = true; g.add(post);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.375), signMats[String(-o.dir)]);
      plate.position.set(0, 2.25, -0.06); plate.rotation.y = Math.PI; plate.castShadow = true; g.add(plate);
      return g;
    },
    road(o) {
      // полотно горизонтально (поворот против уклона), машины — дочерние объекты
      const g = new THREE.Group();
      g.rotation.x = -SLOPE;
      const half = (o.w * S) / 2;
      const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(1000, half * 2 + 1.2).rotateX(-Math.PI / 2), roadMat);
      asphalt.receiveShadow = true; asphalt.position.y = 0.04; g.add(asphalt);
      for (const s of [-1, 1]) {
        const bank = new THREE.Mesh(bankGeo, bankMat);
        bank.scale.set(1, 0.75, 1.1); bank.position.set(0, -0.05, s * (half + 1.3));
        bank.castShadow = true; bank.receiveShadow = true; g.add(bank);
      }
      // фонари вдоль нижней обочины
      const lamps = [];
      for (let i = 0; i < 14; i++) {
        const l = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 8, 8).translate(0, 4, 0), M.metal);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.2).translate(0, 7.9, -1.1), M.metal);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.7), M.headlight);
        head.position.set(0, 7.82, -2.1);
        pole.castShadow = arm.castShadow = true;
        l.add(pole, arm, head); l.position.z = half + 3.2; g.add(l); lamps.push(l);
      }
      g.userData = { half, cars: new Map(), lamps };
      return g;
    },
    pole(o) {
      const red = o.color === '#d9352b';
      const g = new THREE.Group();
      g.rotation.x = -SLOPE;
      const pole = new THREE.Mesh(poleGeo, red ? poleMats.red : poleMats.blue);
      pole.castShadow = true; g.add(pole);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), M.dark);
      knob.position.y = 1.9; g.add(knob);
      const flagGeo = new THREE.PlaneGeometry(1.05, 0.72, 10, 3).translate(0.525, 0, 0);
      const flag = new THREE.Mesh(flagGeo, red ? flagMats.red : flagMats.blue);
      flag.position.y = 1.5; flag.castShadow = true;
      flag.scale.x = red ? -1 : 1;                 // полотнище смотрит к центру ворот
      flag.userData.base = Float32Array.from(flagGeo.attributes.position.array);
      g.add(flag);
      g.userData.flag = flag; g.userData.phase = Math.random() * 6;
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), whiteMat);
      mound.scale.y = 0.35; g.add(mound);
      return g;
    },
    gate(o) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(o.gap * S, 0.14).rotateX(-Math.PI / 2), gateLineMat);
      m.position.y = 0.02; m.renderOrder = 1;
      return m;
    },
    flake() {
      const g = new THREE.Group();
      const f = new THREE.Mesh(flakeGeo, flakeMat);
      f.castShadow = true; g.add(f);
      const glow = new THREE.Sprite(glowBlue); glow.scale.set(1.9, 1.9, 1); g.add(glow);
      g.userData.spin = f; g.userData.phase = Math.random() * 6;
      return g;
    },
    helmet() {
      const g = new THREE.Group();
      const h = makeHelmet(M, pickupHelmetMat, pickupAccent);
      h.scale.setScalar(3.2); g.add(h);
      const glow = new THREE.Sprite(glowGreen); glow.scale.set(3.2, 3.2, 1); g.add(glow);
      const sparks = [0, 1, 2].map(() => { const s = new THREE.Sprite(sparkMat); s.scale.set(0.25, 0.25, 1); g.add(s); return s; });
      g.userData.spin = h; g.userData.sparks = sparks; g.userData.phase = Math.random() * 6;
      return g;
    },
  };

  const live = new Map();       // игровой объект → 3D-объект

  /* ----- следы ----- */
  const MAXT = 400;
  const trackGeo = new THREE.BufferGeometry();
  trackGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXT * 2 * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  trackGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXT * 2 * 6 * 4), 4).setUsage(THREE.DynamicDrawUsage));
  const tracks3 = new THREE.Mesh(trackGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  tracks3.frustumCulled = false; tracks3.renderOrder = 1;
  world.add(tracks3);

  /* ----- снежная пыль и падающий снег ----- */
  const dot = softDot();
  const MAXP = 700;
  const dustGeo = pointsGeo(MAXP);
  const dustMat = pointsMaterial(dot, '#f7faff', 0.95);
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false; dust.renderOrder = 3;
  world.add(dust);
  const pMeta = new WeakMap();
  let spray = [];

  const NSNOW = coarse ? 900 : 1800;
  const snowGeo = pointsGeo(NSNOW);
  const snowMat2 = pointsMaterial(dot, '#ffffff', 0.9);
  const snowPts = new THREE.Points(snowGeo, snowMat2);
  snowPts.frustumCulled = false;
  world.add(snowPts);
  const flakes = [];
  for (let i = 0; i < NSNOW; i++) flakes.push({ x: rand(-45, 45), y: rand(0, 30), z: rand(-20, 90), s: rand(0.03, 0.09), v: rand(0.8, 1.8), w: rand(0, 6) });
  {
    const sz = snowGeo.attributes.size, al = snowGeo.attributes.alpha;
    flakes.forEach((f, i) => { sz.setX(i, f.s); al.setX(i, rand(0.5, 1)); });
  }

  /* ----- всплывающие надписи ----- */
  const texCache = new Map();
  const textSprites = new Map();
  const getTextTex = (t, c) => {
    const key = t + '|' + c;
    if (!texCache.has(key)) {
      if (texCache.size > 80) { const [k0, v0] = texCache.entries().next().value; v0.dispose(); texCache.delete(k0); }
      texCache.set(key, textTexture(t, c));
    }
    return texCache.get(key);
  };

  /* ----- debris: разлетевшееся снаряжение ----- */
  const debrisMap = new Map();

  const riderAO = decal(1.5, 1.1);
  world.add(riderAO);

  let W = 1, H = 1, lastPY = null, lastCX = 0, prevAngle = 0, turnS = 0, rollS = 0, t3 = 0, tiltX = 0, tiltZ = 0;
  const camPos = V(0, 3, -8), camLook = V(0, 1, 8);
  let camInit = false;
  const trickMeta = new WeakMap();
  const tmpV = V();

  function resize(w, h) {
    W = w; H = h;
    renderer.setSize(w, h, false);
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      grade.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updatePointScale();
  }
  function updatePointScale() {
    const px = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    const k = px / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    dustMat.uniforms.scale.value = k; snowMat2.uniforms.scale.value = k;
  }

  /* =================== кадр =================== */
  function render(v) {
    const { dt, P, cam, rider } = v;
    t3 += dt;
    const ox = cam.x, oy = P.y;
    const mx = x => -(x - ox) * S;
    const mz = y => (y - oy) * S;

    // сдвиг мира за кадр — для падающего снега
    const dY = lastPY === null ? 0 : (P.y - lastPY) * S, dX = (cam.x - lastCX) * S;
    lastPY = P.y; lastCX = cam.x;

    // рельеф: ближайшая трасса выполаживает склон, высоты считаются от точки под райдером
    let road = null;
    for (const o of v.objects) if (o.type === 'road' && (!road || Math.abs(o.y - P.y) < Math.abs(road.y - P.y))) road = o;
    TERRAIN.roadZ = road ? road.y * S : -1e9;
    TERRAIN.roadHalf = road ? (road.w * S) / 2 + 1.2 : 0;
    const hRef = terrH(P.x * S, P.y * S);
    const gy = (x, y) => terrH(x * S, y * S) - hRef;
    const ramps = v.objects.filter(o => (o.type === 'ramp' || o.type === 'bigramp') && Math.abs(o.y - P.y) < 400);
    const surfAt = (x, y) => { let h = 0; for (const o of ramps) h = Math.max(h, kickerProf(KICKERS[o.type], (x - o.x) * S, (y - o.y) * S)); return h; };
    const oxM = ox * S, oyM = oy * S;
    // сетка земли стоит на месте в мире (шаг CELL), иначе рельеф «плыл» бы
    const shX = oxM - CELL * Math.round(oxM / CELL), shZ = -(oyM - CELL * Math.floor(oyM / CELL));
    ground.position.set(shX, 0, shZ);
    terrU.uOff.value.set(oxM, oyM); terrU.uShift.value.set(shX, shZ); terrU.uRef.value = hRef;
    terrU.uRoad.value.set(TERRAIN.roadZ, TERRAIN.roadHalf);
    snowMap.offset.set(((oxM - shX) / GROUND_TILE) % 1, ((oyM + shZ) / GROUND_TILE) % 1);
    grooves.offset.set(((oxM - shX) / GROOVE_TILE) % 1, ((oyM + shZ) / GROOVE_TILE) % 1);

    /* --- объекты трассы --- */
    const seen = new Set();
    for (const o of v.objects) {
      if (o.dead) continue;
      let obj = live.get(o);
      if (!obj) {
        const f = make[o.type];
        if (!f) continue;
        obj = f(o);
        live.set(o, obj);
        world.add(obj);
      }
      seen.add(o);
      obj.position.set(mx(o.x), gy(o.x, o.y), mz(o.y));
      const ud = obj.userData;
      switch (o.type) {
        case 'road': {
          obj.position.set(0, pitchH(o.y * S) - hRef, mz(o.y));
          roadTex.offset.x = (-(oxM / 40) % 1 + 1) % 1;
          // машины
          const seenC = new Set();
          for (const c of o.cars) {
            let m = ud.cars.get(c);
            if (!m) { m = makeVehicle(c.kind, c.color, M); ud.cars.set(c, m); obj.add(m); }
            seenC.add(c);
            m.position.set(-(c.x - ox) * S, 0.04, c.lane * S);
            m.rotation.y = c.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
            for (const w of m.userData.wheels) w.rotation.x = c.wheel * S * 2.5;
          }
          for (const [c, m] of ud.cars) if (!seenC.has(c)) { obj.remove(m); disposeTree(m); m.userData.paint.dispose(); ud.cars.delete(c); }
          // фонари стоят на месте в мире, шаг 50 м
          const base = Math.round(oxM / 50) * 50;
          ud.lamps.forEach((l, i) => { l.position.x = -(base + (i - 7) * 50 - oxM); });
          break;
        }
        case 'tree':
          ud.mesh.rotation.z = Math.sin(t3 * 1.3 + ud.sway) * 0.012;
          break;
        case 'snowpile': {
          if (o.burst && !ud.burst) {
            ud.burst = true;
            ud.mound.scale.y *= 0.28; ud.mound.scale.x *= 1.15;
            ud.lumps.forEach((l, i) => { l.position.set(Math.cos(i * 2.1) * 1.9, 0.12, Math.sin(i * 2.1) * 1.6); });
            ud.hole.visible = true; ud.hole.position.y = 0.12;
          }
          const near = !o.burst && Math.abs(o.y - P.y) < 320 && Math.abs(o.x - P.x) < 260;
          ud.eyes.visible = near && Math.sin(t3 * 2.3 + o.eye) > -0.85;
          ud.hole.visible = ud.burst || ud.eyes.visible;
          break;
        }
        case 'yeti': {
          const k = o.phase === 'emerge' ? Math.min(1, o.t / 0.45) : 1;
          const carry = o.phase === 'carry';
          const caught = o.phase === 'caught' || carry, tired = o.phase === 'giveup' && Math.hypot(o.vx, o.vy) < 60;
          const lunge = o.phase === 'chase' ? o.lunge || 0 : 0;
          const ph = o.run;
          ud.body.position.y = -3.2 * (1 - k * k) + (o.phase === 'chase' || carry ? Math.abs(Math.sin(ph)) * 0.14 : 0);
          ud.body.rotation.x = o.phase === 'chase' ? 0.22 + lunge * 0.25 : tired ? 0.35 : 0;
          // смотрит на райдера
          const dxm = mx(P.x) - obj.position.x, dzm = -obj.position.z;
          ud.yawG.rotation.y = carry ? Math.PI : Math.atan2(dxm, dzm);
          ud.legs.forEach((l, i) => { l.rotation.x = o.phase === 'chase' || o.phase === 'giveup' || carry ? Math.sin(ph + i * Math.PI) * 0.85 : 0; });
          const armUp = caught ? 2.9 : tired ? 0.15 : 1.1 + lunge * 1.0;
          ud.arms.forEach((a, i) => {
            const sw = caught || tired ? 0 : Math.sin(ph + (i ? 0 : Math.PI)) * 0.55;
            a.rotation.x = -(armUp + sw);
            a.rotation.z = (i ? -1 : 1) * (caught ? 0.5 : 0.25);
          });
          ud.mouth.scale.y = caught ? 1.7 : 0.8 + lunge * 0.9 + Math.max(0, Math.sin(t3 * 6)) * 0.15;
          ud.head.rotation.x = caught ? -0.35 : 0;
          break;
        }
        case 'pole': {
          const flag = ud.flag, p = flag.geometry.attributes.position, b = flag.userData.base;
          for (let i = 0; i < p.count; i++) {
            const x = b[i * 3];
            p.setZ(i, Math.sin(x * 4.5 - t3 * 7 + ud.phase) * 0.09 * x + Math.sin(t3 * 3 + ud.phase) * 0.05 * x);
            p.setY(i, b[i * 3 + 1] - x * 0.05);
          }
          p.needsUpdate = true;
          flag.geometry.computeVertexNormals();
          break;
        }
        case 'flake':
          obj.position.y = 1.2 + Math.sin(t3 * 3 + ud.phase) * 0.15;
          ud.spin.rotation.y = t3 * 1.6 + ud.phase;
          obj.rotation.x = -SLOPE;
          break;
        case 'helmet': {
          obj.position.y = 1.3 + Math.sin(t3 * 2.5 + ud.phase) * 0.2;
          obj.rotation.x = -SLOPE;
          ud.spin.rotation.y = t3 * 1.2;
          const pulse = 0.5 + 0.5 * Math.sin(t3 * 4);
          obj.children[1].scale.setScalar(2.8 + pulse * 0.8);
          ud.sparks.forEach((s, i) => {
            const a = t3 * 2 + i * 2.1, r = 1.1 + Math.sin(t3 * 3 + i) * 0.2;
            s.position.set(Math.cos(a) * r, Math.sin(a * 1.3) * 0.5, Math.sin(a) * r);
            s.material.opacity = 0.5 + 0.5 * Math.sin(t3 * 6 + i);
          });
          break;
        }
      }
    }
    for (const [o, obj] of live) {
      if (seen.has(o)) continue;
      world.remove(obj);
      disposeTree(obj);
      live.delete(o);
    }

    /* --- райдер --- */
    if (!riders[rider]) {
      riders[rider] = new Rider(rider, v.RIDERS[rider], M);
      world.add(riders[rider].root);
    }
    for (const k in riders) riders[k].root.visible = k === rider;
    const R = riders[rider];
    const px = mx(P.x), ph = P.z * HZ;

    // курс по реальной скорости, крен — по скорости поворота
    const turn = dt > 0 ? (P.angle - prevAngle) / dt : 0;
    prevAngle = P.angle;
    turnS = damp(turnS, clamp(turn, -4, 4), 10, dt);
    const heading = Math.atan2(P.angle * 0.8, 1 - 0.38 * Math.abs(P.angle));
    const grounded = !P.air;
    const rollT = grounded ? clamp(turnS * 0.14 + P.angle * 0.22, -0.7, 0.7) : 0;
    rollS = damp(rollS, rollT, 8, dt);

    const gxP = P.x * S, gzP = P.y * S;
    let lift = grounded || !P.trick ? surfAt(P.x, P.y) : 0;
    const dsdz = grounded ? (surfAt(P.x, P.y + 8) - surfAt(P.x, P.y - 8)) / (16 * S) : 0;
    const dhdz = (terrH(gxP, gzP + 0.8) - terrH(gxP, gzP - 0.8)) / 1.6 + dsdz;
    const dhdx = -(terrH(gxP + 0.8, gzP) - terrH(gxP - 0.8, gzP)) / 1.6;
    tiltX = damp(tiltX, grounded ? Math.atan(-dhdz) : tiltX * 0.9, 10, dt);
    tiltZ = damp(tiltZ, grounded ? Math.atan(dhdx) : 0, 10, dt);
    R.root.rotation.set(0, 0, 0);
    R.pivot.rotation.set(0, 0, 0, 'XYZ');
    R.pivot.position.set(0, 0.95, 0);
    R.root.position.set(px, 0, 0);                              // райдер стоит там, где он на самом деле (а не там, где камера)
    const yaw = rider === 'ski' ? -heading : -heading * 0.9;
    R.root.rotation.order = 'YXZ';
    R.root.rotation.y = yaw;
    R.root.rotation.x = tiltX;
    R.root.rotation.z = rollS + tiltZ;

    const pose = {
      c: P.crouch, grab: !!(P.air && P.trick && P.z > 40), plant: P.plant, noGear: false,
      look: heading * 0.6, clock: v.clock, turn: turnS * 0.2, dt,
    };

    if (P.air && P.trick) {
      // с трамплина — сальто назад: оборот завершается ровно к приземлению, в середине райдер группируется
      let m = trickMeta.get(P.trick);
      if (!m) {
        const g = 900, rem = (P.vz + Math.sqrt(P.vz * P.vz + 2 * g * P.z)) / g;
        // высота кромки, с которой оторвался райдер
        let base = 0;
        for (const o of ramps) if (Math.abs(o.y - P.y) < 60) base = Math.max(base, kickerProf(KICKERS[o.type], (P.x - o.x) * S, 0));
        m = { T: Math.max(0.3, rem), t: 0, base };
        trickMeta.set(P.trick, m);
      }
      m.t += dt;
      const k = clamp(m.t / m.T, 0, 1);
      lift = m.base * (1 - k);                            // к приземлению — плавно на уровень склона
      if (P.trick.manual) {
        // игрок крутит сам: ← → — вращение, пробел — сальто, ↓ — грэб
        R.pivot.rotation.x = -P.flip;
        R.root.rotation.y = yaw - P.rot;
        pose.grab = P.grabbing;
        pose.c = P.grabbing ? 0.95 : 0.55 + 0.35 * Math.abs(Math.sin(P.flip));
      } else {
        const e = clamp((k - 0.08) / 0.8, 0, 1);            // отрыв и приземление — ровно, оборот — посередине
        R.pivot.rotation.x = -(e * e * (3 - 2 * e)) * Math.PI * 2 * (/двойн/i.test(P.trick.name) ? 2 : 1);
        pose.c = 0.55 + 0.45 * Math.sin(Math.PI * clamp(k * 1.15, 0, 1));
      }
    }
    if (P.crash) {
      const k = clamp(P.crash / 0.9, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      R.pivot.rotation.order = 'XYZ';
      if (R.skin) {
        // у модели: полный кувырок в воздухе, а падение на спину — анимация Death01
        R.pivot.rotation.x = e * Math.PI * 2;
        R.pivot.position.y = 0.95 + Math.sin(k * Math.PI) * 0.8;
        pose.anim = 'Death01';
      } else {
        R.pivot.rotation.x = e * Math.PI * 2.1;
        R.pivot.rotation.z = e * Math.PI * 0.5;
        R.pivot.position.y = lerp(0.95, 0.3, e) + Math.sin(k * Math.PI) * 0.8;
      }
      // отскок назад от препятствия; от ёлки — дальше, за пределы нижних лап, чтобы райдер не лежал под кроной
      R.root.position.z = -e * (v.cine && v.cine.hit && v.cine.hit.type === 'tree' ? 3.6 : 1.2);
      pose.noGear = rider === 'ski';
      pose.c = 0.9;
    }
    R.root.position.y = ph + lift;
    if (P.carried) {
      // над головой у йети: лежит поперёк, болтается и дрыгает ногами
      R.root.position.y = 2.45;
      R.root.position.z = 0.1;
      R.root.rotation.set(0, Math.PI / 2, 0);
      R.pivot.rotation.set(-1.4 + Math.sin(t3 * 9) * 0.22, 0, Math.sin(t3 * 7) * 0.2, 'XYZ');
      R.pivot.position.y = 0.95;
      pose.noGear = rider === 'ski';
      pose.c = 0.15 + Math.abs(Math.sin(t3 * 11)) * 0.45;
      pose.anim = 'Swim_Idle_Loop';
    }
    R.setShield(P.shield);
    R.update(pose);
    R.root.visible = !(P.inv > 0 && Math.floor(P.inv * 12) % 2);
    riderAO.position.set(px, 0.014 + (grounded ? lift : 0), R.root.position.z);
    riderAO.scale.setScalar(1.5 + ph * 0.6);
    riderAO.material.opacity = 0.55 / (1 + ph * 0.8);

    /* --- следы --- */
    {
      const pos = trackGeo.attributes.position.array, cl = trackGeo.attributes.color.array;
      const lines = rider === 'ski' ? [-0.12, 0.12] : [0];
      const w = rider === 'ski' ? 0.07 : 0.3;
      let n = 0;
      const tr = v.tracks, len = tr.length;
      const put = (x, z, a, y) => {
        pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
        cl[n * 4] = 0.5; cl[n * 4 + 1] = 0.6; cl[n * 4 + 2] = 0.78; cl[n * 4 + 3] = a;
        n++;
      };
      // непрерывная лента: у каждой точки своя нормаль (среднее соседних отрезков) — без изломов на стыках
      for (const off of lines) {
        let run = [];
        const flush = () => {
          const m = run.length;
          for (let i = 0; i < m && m > 1; i++) {
            const pa = run[Math.max(0, i - 1)], pb = run[Math.min(m - 1, i + 1)];
            const dx = pb.x - pa.x, dz = pb.z - pa.z, l = Math.hypot(dx, dz) || 1;
            run[i].nx = (-dz / l) * w / 2; run[i].nz = (dx / l) * w / 2;
          }
          for (let i = 1; i < m && n < MAXT * 12 - 6; i++) {
            const a = run[i - 1], b = run[i];
            put(a.x + a.nx, a.z + a.nz, a.f, a.y); put(b.x + b.nx, b.z + b.nz, b.f, b.y); put(b.x - b.nx, b.z - b.nz, b.f, b.y);
            put(a.x + a.nx, a.z + a.nz, a.f, a.y); put(b.x - b.nx, b.z - b.nz, b.f, b.y); put(a.x - a.nx, a.z - a.nz, a.f, a.y);
          }
          run = [];
        };
        for (let i = 0; i < len; i++) {
          const t = tr[i];
          if (!t) { flush(); continue; }
          // лыжа разнесена поперёк курса — тот же курс, что у модели райдера
          const h = Math.atan2(t.a * 0.8, 1 - 0.38 * Math.abs(t.a));
          run.push({
            x: mx(t.x) + off * Math.cos(h), z: mz(t.y) + off * Math.sin(h),
            y: gy(t.x, t.y) + surfAt(t.x, t.y) + 0.06, f: ((i + 1) / len) * 0.85,
          });
        }
        flush();
      }
      trackGeo.setDrawRange(0, n);
      trackGeo.attributes.position.needsUpdate = true;
      trackGeo.attributes.color.needsUpdate = true;
    }

    /* --- снежная пыль: частицы игры + брызги из-под кантов --- */
    if (v.state === 'play' && grounded && !P.crash) {
      const speedK = clamp((P.speed - 200) / 500, 0, 1);
      const carve = Math.abs(turnS);
      const n = Math.min(8, Math.floor(carve * 2.5 + speedK * 1.5 + Math.random()));
      const outSide = Math.sign(turnS || P.angle || 1);
      for (let i = 0; i < n; i++) {
        spray.push({
          x: P.x + rand(-6, 6), y: P.y - rand(0, 8), h: 0.05,
          vx: -outSide * rand(20, 90) * (0.4 + carve * 0.3), vy: -rand(0, 60), vh: rand(0.8, 2.8) * (0.5 + carve * 0.35),
          life: rand(0.35, 0.8), t: 0, r: rand(0.12, 0.3),
        });
      }
    }
    spray = spray.filter(p => (p.t += dt) < p.life);
    {
      const pos = dustGeo.attributes.position, sz = dustGeo.attributes.size, al = dustGeo.attributes.alpha;
      let n = 0;
      const emit = (x, h, z, size, a) => { if (n >= MAXP) return; pos.setXYZ(n, x, h, z); sz.setX(n, size); al.setX(n, a); n++; };
      for (const p of v.particles) {
        let m = pMeta.get(p);
        if (!m) { m = { h: 0.15, vh: rand(1, 3.2) * (Math.hypot(p.vx, p.vy) / 110 + 0.35) }; pMeta.set(p, m); }
        m.vh -= 9.8 * dt; m.h = Math.max(0.05, m.h + m.vh * dt);
        const k = p.t / p.life;
        emit(mx(p.x), m.h + gy(p.x, p.y), mz(p.y), p.r * S * (2.5 + k * 4), (1 - k) * 0.85);
      }
      for (const p of spray) {
        p.vh -= 9.8 * dt; p.h = Math.max(0.03, p.h + p.vh * dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
        const k = p.t / p.life;
        emit(mx(p.x), p.h + gy(p.x, p.y), mz(p.y), p.r * (1 + k * 2.5), (1 - k) * 0.7);
      }
      dustGeo.setDrawRange(0, n);
      pos.needsUpdate = sz.needsUpdate = al.needsUpdate = true;
    }

    /* --- падающий снег: мир уезжает назад вместе с ним --- */
    {
      const pos = snowGeo.attributes.position;
      for (let i = 0; i < NSNOW; i++) {
        const f = flakes[i];
        f.y -= f.v * dt; f.z -= dY; f.x += dX + Math.sin(t3 * 0.7 + f.w) * 0.3 * dt;
        if (f.y < 0) f.y += 30;
        if (f.z < -20) f.z += 110; else if (f.z > 90) f.z -= 110;
        if (f.x < -45) f.x += 90; else if (f.x > 45) f.x -= 90;
        pos.setXYZ(i, f.x, f.y, f.z);
      }
      pos.needsUpdate = true;
    }

    /* --- разлетевшееся снаряжение --- */
    {
      const seenD = new Set();
      for (const d of v.debris) {
        let m = debrisMap.get(d);
        if (!m) {
          m = d.kind === 'ski' ? makeSki(M, v.RIDERS.ski) : makePole(M);
          m.traverse(o => { o.castShadow = true; });
          debrisMap.set(d, m); world.add(m);
        }
        seenD.add(d);
        m.position.set(mx(d.x), d.z * HZ + 0.05 + gy(d.x, d.y), mz(d.y));
        m.rotation.set(d.kind === 'pole' ? Math.PI / 2 : d.z > 0 ? d.rot * 0.6 : 0, d.rot, d.z > 0 ? d.rot * 0.3 : 0);
      }
      for (const [d, m] of debrisMap) if (!seenD.has(d)) { world.remove(m); disposeTree(m); debrisMap.delete(d); }
    }

    /* --- всплывающие надписи --- */
    {
      const seenT = new Set();
      for (const t of v.texts) {
        let sp = textSprites.get(t);
        if (!sp) {
          sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: getTextTex(t.text, t.color), depthTest: false, transparent: true, fog: false }));
          sp.renderOrder = 10; textSprites.set(t, sp); world.add(sp);
        }
        seenT.add(t);
        sp.position.set(mx(t.x), 2.4 + t.t * 1.6 + gy(t.x, t.y), mz(t.y));
        const s = 0.9 + Math.min(1, t.t * 6) * 0.25;
        sp.scale.set(3.6 * s, 0.675 * s, 1);
        sp.material.opacity = 1 - t.t / 1.1;
      }
      for (const [t, sp] of textSprites) if (!seenT.has(t)) { world.remove(sp); sp.material.dispose(); textSprites.delete(t); }
    }

    /* --- камера --- */
    const speedK = clamp((P.speed - 240) / 460, 0, 1);
    const target = V(), look = V();
    if (v.cine) {
      const c = v.cine;
      if (c.kind === 'crash') {
        // камера со стороны, противоположной препятствию (ёлка не закрывает), покачивается в секторе и опускается
        let a0 = Math.PI + 0.9;
        if (c.hit) a0 = Math.atan2(px - mx(c.hit.x), (P.y - c.hit.y) * S + 0.001);
        const a = a0 + Math.sin(c.t * 0.7) * 0.55;
        const r = lerp(7.5, 4.6, clamp(c.t / 1.4, 0, 1));
        const rz = R.root.position.z;
        target.set(px + Math.sin(a) * r, 2.2 + Math.max(0, 1.6 - c.t) * 1.1, Math.cos(a) * r + rz);
        look.set(px, 0.55, rz);
      } else {
        // йети с добычей — снизу спереди; потом камера провожает его вверх по склону
        const carry = c.stage === 'carry';
        target.set(px + 3.4, carry ? 4.8 : 2.3, carry ? 10.5 : 6.4);
        look.set(px, carry ? 2.4 : 3.0, carry ? -2 : 0);
      }
    } else if (P.crash) {
      // после падения камера облетает райдера — препятствие не закрывает его
      const a = Math.PI + Math.min(P.crash, 6) * 0.35 * (px > 0 ? -1 : 1);
      target.set(px + Math.sin(a) * 6.5, 3.4, Math.cos(a) * 6.5 - 1.2);
      look.set(px, -2.2, -1.2);
    } else if (v.state === 'start') {
      const a = t3 * 0.22;
      target.set(px + Math.sin(a) * 6.2, 2.2, Math.cos(a) * 6.2 - 1);
      look.set(px, 1.0, 0);
    } else {
      const narrow = clamp(1 / camera.aspect, 1, 2.2) - 1;          // портрет: камера выше и дальше
      // в высоком прыжке камера отстаёт и держится ниже райдера — видно, над чем он летит
      const air = Math.min(ph, 14);
      target.set(px * 0.85 + P.angle * 0.8, 3.0 + narrow * 2.2 + speedK * 0.6 + air * 0.5, -7.4 - narrow * 4.5 - speedK * 1.8 - air * 0.75);
      look.set(px * 0.95 + P.angle * 1.5, 0.9 + ph * 0.75, 10 - air * 0.2);
    }
    const hAt = (X, Z) => terrH(-X + oxM, Z + oyM) - hRef;
    const tCam = hAt(target.x, target.z);
    target.y = Math.max(target.y + tCam * 0.85 + lift * 0.8, tCam + 1.6);
    look.y += hAt(look.x, look.z) * 0.8 + lift * 0.9;
    const cdt = v.cine ? v.realDt : dt;                       // в замедлении камера движется в реальном времени
    const k = camInit ? 1 - Math.exp(-cdt * (v.state === 'start' ? 2.5 : v.cine ? 3 : 4.5)) : 1;
    camInit = true;
    camPos.lerp(target, k); camLook.lerp(look, k);
    camera.position.copy(world.localToWorld(tmpV.copy(camPos)));
    if (v.shake) camera.position.add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(v.shake * 0.012));
    camera.lookAt(world.localToWorld(tmpV.copy(camLook)));
    camera.rotateZ(v.state === 'play' ? -rollS * 0.08 : 0);
    const fov = 58 + speedK * 14;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 3, dt); camera.updateProjectionMatrix(); updatePointScale(); }

    // небо, горы, облака и солнце следуют за камерой
    sky.position.copy(camera.position);
    far.position.set(camera.position.x, camera.position.y, camera.position.z);
    for (const c of clouds) {
      const u = c.userData;
      u.a += dt * 0.004;
      c.position.set(camera.position.x + Math.cos(u.a) * u.d, camera.position.y + u.h, camera.position.z + Math.sin(u.a) * u.d);
    }
    const riderWorld = world.localToWorld(tmpV.set(px, 0, 12));
    sun.target.position.copy(riderWorld);
    sun.position.copy(riderWorld).addScaledVector(SUN, 110);

    if (composer) {
      const u = grade.uniforms;
      u.uSpeed.value = v.state === 'play' && !P.crash ? speedK * 0.6 + (P.air ? 0.15 : 0) : 0;
      u.uTime.value = t3;
      // солнце в кадре → блики объектива
      const sp = tmpV.copy(camera.position).addScaledVector(SUN, 1000).project(camera);
      const facing = camera.getWorldDirection(new THREE.Vector3()).dot(SUN);
      const vis = facing > 0 ? clamp(1.3 - Math.max(Math.abs(sp.x), Math.abs(sp.y)), 0, 1) : 0;
      u.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5, vis);
      composer.render(dt);
    } else renderer.render(scene, camera);
    adapt(v);
  }

  // автоматическое качество: если кадров мало — ступенью ниже (обратно не поднимаем, чтобы не дёргалось)
  let wallLast = 0, wallAcc = 0, wallN = 0;
  function adapt(v) {
    const now = performance.now();
    const d = now - wallLast; wallLast = now;
    if (settle > 0) { settle--; return; }
    if (forcedQ || v.state !== 'play' || d > 250) return;
    wallAcc += d; wallN++;
    if (wallN < 120) return;
    const avg = wallAcc / wallN; wallAcc = wallN = 0;
    if (qName === 'high' && avg > 23) setQuality('medium');
    else if (qName === 'medium' && avg > 30) setQuality('low');
  }

  setQuality(forcedQ || (coarse ? 'medium' : 'high'));
  return { canvas, render, resize };
}
