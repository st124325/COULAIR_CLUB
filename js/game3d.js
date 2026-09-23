/* =====================================================================
   Coulair Run 3D — объёмная графика мини-игры на Three.js.
   Правила и физика остаются в js/game.js, здесь только отрисовка того же мира.
   Модуль грузится при первом включении «3D» в игре.
   ===================================================================== */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js';

const S = 0.08;              // игровая единица → метры
const HZ = 0.035;            // высота прыжка (игровая z) → метры
const SLOPE = 0.27;          // уклон трассы, рад (~15°)
const GROUND_TILE = 24;      // размер тайла снега, м
const GROOVE_TILE = 3;       // тайл вельвета от ратрака, м
const SUN = new THREE.Vector3(0.55, 0.5, 0.68).normalize();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const rng = seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const col = hex => new THREE.Color(hex);

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
function pineGeometry(seed) {
  const r = rng(seed * 97 + 13);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.26, 2.4, 7);
  trunk.translate(0, 1.2, 0);
  parts.push(paint(trunk, '#5b3a22', c => c.offsetHSL(0, 0, (r() - 0.5) * 0.06)));
  const tiers = 6 + ((r() * 3) | 0);
  const top = 8.2, base = 1.0;
  const snowy = 0.55 + r() * 0.45;
  const hue = (r() - 0.5) * 0.03;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const hgt = 2.5 - t * 1.2;
    const y0 = base + t * (top - base - hgt * 0.8);
    const rad = (2.7 - t * 2.25) * (0.9 + r() * 0.2);
    const radial = 12;
    const cone = new THREE.ConeGeometry(rad, hgt, radial, 3, true);
    const p = cone.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const ring = Math.floor(k / (radial + 1)), j = k % (radial + 1);
      let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      if (ring === 3) {                      // нижний край — зубцами лап, концы провисают
        const tooth = j % 2 ? 0.78 : 1.08;
        x *= tooth; z *= tooth; y -= j % 2 ? 0 : 0.28 + r() * 0.1;
      } else if (ring > 0) {
        const k2 = 0.93 + r() * 0.12; x *= k2; z *= k2;
      }
      p.setXYZ(k, x, y, z);
    }
    cone.translate(0, y0 + hgt / 2, 0);
    const dark = col('#123a24'), light = col('#2f7a4c');
    parts.push(paint(cone, '#23633e', (c, x, y) => {
      const k = clamp((y - y0) / hgt, 0, 1);
      c.copy(dark).lerp(light, k * 0.9 + r() * 0.15).offsetHSL(hue, 0, (r() - 0.5) * 0.04);
    }));
    // снежная шапка на ярусе: неровный край, синеватый низ
    const cap = new THREE.ConeGeometry(rad * (0.72 + 0.1 * snowy), hgt * 0.55, radial, 1, true);
    const cp = cap.attributes.position;
    for (let k = 0; k < cp.count; k++) {
      if (k >= radial + 1) {
        const f = 0.55 + r() * 0.45 * snowy;
        cp.setXYZ(k, cp.getX(k) * f, cp.getY(k) - r() * 0.18, cp.getZ(k) * f);
      }
    }
    cap.translate(0, y0 + hgt - hgt * 0.55 / 2 + 0.05, 0);
    const white = col('#ffffff'), blue = col('#c7d6ee');
    parts.push(paint(cap, '#ffffff', (c, x, y) => c.copy(blue).lerp(white, clamp((y - (y0 + hgt * 0.45)) / (hgt * 0.5), 0, 1))));
  }
  const mound = new THREE.SphereGeometry(1.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  mound.scale(1, 0.22, 1);
  parts.push(paint(mound, '#f4f8fd'));
  return merge(parts);
}

function rockGeometry(seed) {
  const r = rng(seed * 31 + 7);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const flat = 0.5 + r() * 0.2;
  jitter(g, (x, y, z) => {
    const k = 0.78 + r() * 0.35;
    return [x * k * (1 + r() * 0.1), Math.max(-0.25, y * k * flat), z * k];
  });
  const pos = g.attributes.position, n = pos.count;
  const c = new Float32Array(n * 3), a = V(), b = V(), d = V(), nrm = V();
  const rockA = col('#8b929c'), rockB = col('#4b5058'), snow = col('#f6f9fd'), snowB = col('#d6e2f2');
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); d.fromBufferAttribute(pos, i + 2);
    nrm.subVectors(d, b).cross(V().subVectors(a, b)).normalize();
    const yMid = (a.y + b.y + d.y) / 3;
    if (nrm.y > 0.62 - r() * 0.15 && yMid > -0.05) tmp.copy(snowB).lerp(snow, nrm.y);
    else tmp.copy(rockB).lerp(rockA, clamp(0.5 + nrm.x * 0.4 + (r() - 0.5) * 0.4, 0, 1));
    for (let k = 0; k < 3; k++) { c[(i + k) * 3] = tmp.r; c[(i + k) * 3 + 1] = tmp.g; c[(i + k) * 3 + 2] = tmp.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const drift = paint(new THREE.SphereGeometry(1.25, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.22, 0.9).translate(0.2, -0.22, -0.3), '#f3f7fc');
  return merge([g, drift]);
}

function kickerGeometry() {
  // профиль вдоль склона: плавный разгон к кромке, короткий стол, крутой спуск
  const sh = new THREE.Shape();
  sh.moveTo(-2.6, 0);
  for (let i = 1; i <= 14; i++) {
    const t = i / 14;
    sh.lineTo(-2.6 + t * 4.0, Math.pow(t, 1.8) * 1.35);
  }
  sh.lineTo(1.65, 1.35);
  sh.quadraticCurveTo(2.3, 0.9, 2.7, 0);
  sh.lineTo(-2.6, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 4.6, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.1, bevelSegments: 2, curveSegments: 8 });
  g.rotateY(-Math.PI / 2);
  g.translate(2.3, 0, 0);
  return paint(g, '#f4f8fd', (c, x, y) => c.lerp(col('#c9d8ee'), clamp(0.35 - y * 0.3, 0, 0.35)));
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

function mountainsGeometry(inner, outer, height, base, seed, rock, snowLine, haze, hazeK) {
  const r = rng(seed);
  const NA = 220, NR = 7;
  const phases = Array.from({ length: 6 }, () => r() * Math.PI * 2);
  const ridge = a => {
    let h = 0;
    h += Math.sin(a * 3 + phases[0]) * 0.35 + Math.sin(a * 7 + phases[1]) * 0.25 + Math.sin(a * 13 + phases[2]) * 0.15;
    h += Math.sin(a * 23 + phases[3]) * 0.08 + Math.sin(a * 41 + phases[4]) * 0.04;
    return Math.pow(clamp(0.5 + h * 0.8, 0, 1), 1.6);
  };
  const pos = [], cols = [];
  const pt = (ia, ir) => {
    const a = (ia / NA) * Math.PI * 2, t = ir / NR;
    const rad = lerp(inner, outer, t) * (1 + (r() - 0.5) * 0.02);
    const prof = Math.pow(Math.sin(t * Math.PI), 0.7);           // от подножия к гребню и обратно
    const h = base + height * (0.12 + ridge(a + t * 0.18) * 0.88) * prof * (0.9 + r() * 0.2);
    return [Math.cos(a) * rad, h, Math.sin(a) * rad];
  };
  const grid = [];
  for (let ia = 0; ia <= NA; ia++) { grid.push([]); for (let ir = 0; ir <= NR; ir++) grid[ia].push(pt(ia % NA, ir)); }
  const cRock = col(rock), cSnow = col('#f2f6ff'), cHaze = col(haze), cFoot = col(rock).lerp(col('#1e2c3a'), 0.35), c = new THREE.Color();
  const push = (p, hn) => {
    pos.push(...p);
    const k = clamp((p[1] - base) / height, 0, 1);
    const snowK = clamp((k - snowLine) / 0.1 + hn * 0.6, 0, 1);
    c.copy(cFoot).lerp(cRock, clamp(k * 2, 0, 1)).lerp(cSnow, snowK).lerp(cHaze, hazeK * (1 - k * 0.5));
    cols.push(c.r, c.g, c.b);
  };
  for (let ia = 0; ia < NA; ia++) for (let ir = 0; ir < NR; ir++) {
    const a = grid[ia][ir], b = grid[ia + 1][ir], cc = grid[ia + 1][ir + 1], d = grid[ia][ir + 1];
    const n1 = r() * 0.3, n2 = r() * 0.3;
    push(a, n1); push(cc, n1); push(b, n1);
    push(a, n2); push(d, n2); push(cc, n2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
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

    const jacket = new THREE.MeshStandardMaterial({ color: R.jacket, roughness: 0.62 });
    const jacketDark = new THREE.MeshStandardMaterial({ color: R.jacketDark, roughness: 0.65 });
    const pants = new THREE.MeshStandardMaterial({ color: R.pants, roughness: 0.8 });
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
  }

  setShield(on) {
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
      for (const [i, s] of [[0, 1], [1, -1]]) {
        const plant = pose.plant && pose.plant.side === -s ? Math.sin((pose.plant.t / 0.3) * Math.PI) : 0;
        const sh = this.shoulder(chest, fwd, s);
        let hand;
        if (pose.grab) hand = V(s * 0.1, 0.3, 0.28);
        else hand = V(s * 0.3, pelvis.y + 0.1 + plant * 0.08, pelvis.z + 0.42 + plant * 0.12);
        this.arm(i, sh, hand, V(s, -0.4, -0.6));
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
      const sway = Math.sin(pose.clock * 3.2) * 0.06;
      for (const [i, s] of [[0, 1], [1, -1]]) {
        const sh = this.shoulder(chest, fwd, -s);
        let hand;
        if (pose.grab && s === 1) hand = V(0.16, 0.2, 0.02);
        else if (pose.grab) hand = V(0.1, chest.y - 0.25, -0.45);
        else hand = V(0.14, chest.y - 0.3 + s * sway + pose.turn * s * 0.08, s * (0.6 - c * 0.08));
        this.arm(i, sh, hand, V(-0.3, -0.5, s * 0.4));
      }
      this.board.position.set(0, 0.03, 0);
    }
    // голова смотрит вниз по склону, чуть вперёд
    const headFwd = this.kind === 'ski' ? V(Math.sin(pose.look * 0.4), -0.25, 1) : V(0.35, -0.2, 1);
    const hp = this.head.position.clone();
    orient(this.head, hp, hp.clone().add(V(0, 1, 0)), headFwd.normalize());
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const HORIZON = col('#d9e5f3');
  scene.fog = new THREE.Fog(HORIZON, 70, 235);
  scene.background = HORIZON;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);

  // небо: градиент, солнце и ореол
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: col('#4f86d0') }, horizon: { value: HORIZON }, bottom: { value: col('#c9d7ea') }, sunDir: { value: SUN } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `
      uniform vec3 top, horizon, bottom, sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(horizon, top, pow(clamp(h, 0., 1.), 0.5));
        c = mix(c, bottom, smoothstep(0., -0.3, h));
        float s = max(dot(normalize(vDir), sunDir), 0.);
        c += vec3(1., .95, .85) * (pow(s, 900.) * 6. + pow(s, 60.) * .35 + pow(s, 6.) * .12);
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  // окружение для отражений (маска, шлем, кристаллы) — из того же неба
  {
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
    const snowDisk = new THREE.Mesh(new THREE.CircleGeometry(9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e8eef7' }));
    snowDisk.position.y = -1; envScene.add(snowDisk);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  // свет
  const hemi = new THREE.HemisphereLight('#bcd4f5', '#f2f5fa', 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e2', 2.4);
  sun.castShadow = true;
  const SH = coarse ? 1024 : 2048;
  sun.shadow.mapSize.set(SH, SH);
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // дальние горы и лесистые холмы — следуют за камерой, всегда на горизонте
  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: false, side: THREE.DoubleSide });
  const far = new THREE.Group();
  far.add(new THREE.Mesh(mountainsGeometry(950, 1650, 700, -420, 7, '#6d7d97', 0.55, '#c3d2e8', 0.42), farMat));
  far.add(new THREE.Mesh(mountainsGeometry(560, 900, 330, -330, 19, '#2f4a4c', 0.72, '#b4c6dc', 0.3), farMat));
  scene.add(far);
  const clouds = [];
  const cloudTex = cloudTexture();
  for (let i = 0; i < 9; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, depthWrite: false, opacity: 0.75 }));
    const a = rand(-1.4, 1.4) + Math.PI / 2, d = rand(1100, 1500);
    sp.userData = { a, d, h: rand(40, 220), w: rand(400, 800) };
    sp.scale.set(sp.userData.w, sp.userData.w * 0.4, 1);
    clouds.push(sp); scene.add(sp);
  }

  // склон: всё игровое — в группе, наклонённой на угол склона
  const world = new THREE.Group();
  world.rotation.x = SLOPE;
  scene.add(world);

  const snowMap = snowTexture(), grooves = grooveNormalTexture();
  snowMap.repeat.set(1 / GROUND_TILE, 1 / GROUND_TILE);
  grooves.repeat.set(1 / GROOVE_TILE, 1 / GROOVE_TILE);
  const groundGeo = new THREE.PlaneGeometry(900, 1100, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, 300);
  {
    const p = groundGeo.attributes.position, uv = groundGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, -p.getX(i), p.getZ(i));   // UV в метрах, «приклеены» к миру
  }
  const groundMat = new THREE.MeshStandardMaterial({ map: snowMap, normalMap: grooves, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.82, color: '#ffffff' });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  world.add(ground);

  /* ----- общие материалы и геометрии ----- */
  const M = {
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
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const snowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const pines = Array.from({ length: 8 }, (_, i) => pineGeometry(i + 1));
  const rocks = Array.from({ length: 6 }, (_, i) => rockGeometry(i + 1));
  const kickerGeo = kickerGeometry();
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
  const barkMat = new THREE.MeshStandardMaterial({ color: '#5a3820', roughness: 0.95, flatShading: true });
  const ringMat = new THREE.MeshStandardMaterial({ map: stumpTopTexture(), roughness: 0.9 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: '#f6f9fd', roughness: 0.8 });
  const orangeMat = new THREE.MeshStandardMaterial({ color: '#ff6a13', roughness: 0.5, emissive: '#ff6a13', emissiveIntensity: 0.15 });
  const orangeDouble = orangeMat.clone(); orangeDouble.side = THREE.DoubleSide;
  // общие геометрии не удаляются вместе с объектами трассы
  for (const g of [...pines, ...rocks, kickerGeo, flakeGeo, poleGeo, stumpGeo]) g.userData.shared = true;
  const disposeTree = obj => obj.traverse(m => { if (m.isMesh && !m.geometry.userData.shared) m.geometry.dispose(); });

  const riders = {};
  const pickupHelmetMat = new THREE.MeshPhysicalMaterial({ color: '#1b1c21', roughness: 0.4, clearcoat: 0.8 });
  const pickupAccent = new THREE.MeshStandardMaterial({ color: '#5dff3a', emissive: '#5dff3a', emissiveIntensity: 0.5 });

  /* ----- фабрики объектов трассы ----- */
  const make = {
    tree(o) {
      const m = new THREE.Mesh(pines[(Math.random() * pines.length) | 0], treeMat);
      const k = (o.h * 0.1) / 8;
      m.scale.set(k * rand(0.9, 1.1), k, k * rand(0.9, 1.1));
      m.rotation.set(-SLOPE, rand(0, Math.PI * 2), 0);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.sway = Math.random() * 6;
      return m;
    },
    rock(o) {
      const m = new THREE.Mesh(rocks[(Math.random() * rocks.length) | 0], rockMat);
      const k = o.w * S * 0.55;
      m.scale.set(k, k * rand(0.8, 1.1), k * rand(0.8, 1.1));
      m.rotation.y = rand(0, Math.PI * 2);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    },
    stump() {
      const g = new THREE.Group();
      const s = new THREE.Mesh(stumpGeo, [barkMat, ringMat, barkMat]);
      s.castShadow = true; g.add(s);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), whiteMat);
      cap.scale.y = 0.35; cap.position.set(-0.05, 0.7, 0.03); g.add(cap);
      for (const a of [0.4, 2.3, 4.1]) {
        const root2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.6, 6).rotateZ(Math.PI / 2 - 0.3), barkMat);
        root2.position.set(Math.cos(a) * 0.45, 0.06, Math.sin(a) * 0.45); root2.rotation.y = -a; root2.castShadow = true; g.add(root2);
      }
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), whiteMat);
      mound.scale.y = 0.18; g.add(mound);
      g.rotation.y = rand(0, Math.PI * 2);
      return g;
    },
    ramp() {
      const g = new THREE.Group();
      const k = new THREE.Mesh(kickerGeo, snowMat);
      k.castShadow = true; k.receiveShadow = true; g.add(k);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.05, 0.14), orangeMat);
      lip.position.set(0, 1.42, 1.6); g.add(lip);
      for (const s of [-1, 1]) {
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6).translate(0, 0.8, 0), M.dark);
        stick.position.set(s * 2.55, 1.2, 1.6); stick.rotation.x = -SLOPE; stick.castShadow = true; g.add(stick);
        const flag = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(s * 0.55, -0.15, 0), V(0, -0.35, 0)]), orangeDouble);
        flag.geometry.computeVertexNormals();
        flag.position.set(0, 1.6, 0); stick.add(flag);
      }
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
  const tracks3 = new THREE.Mesh(trackGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
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

  let W = 1, H = 1, lastPY = null, lastCX = 0, prevAngle = 0, turnS = 0, rollS = 0, t3 = 0;
  const camPos = V(0, 3, -8), camLook = V(0, 1, 8);
  let camInit = false;
  const trickMeta = new WeakMap();
  const tmpV = V();

  function resize(w, h) {
    W = w; H = h;
    renderer.setSize(w, h, false);
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

    // земля «приклеена» к миру
    snowMap.offset.set(((ox * S) / GROUND_TILE) % 1, ((oy * S) / GROUND_TILE) % 1);
    grooves.offset.set(((ox * S) / GROOVE_TILE) % 1, ((oy * S) / GROOVE_TILE) % 1);

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
      obj.position.set(mx(o.x), 0, mz(o.y));
      const ud = obj.userData;
      switch (o.type) {
        case 'tree':
          obj.rotation.z = Math.sin(t3 * 1.3 + ud.sway) * 0.012;
          break;
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

    R.root.position.set(px, ph, 0);
    R.root.rotation.set(0, 0, 0);
    R.pivot.rotation.set(0, 0, 0, 'XYZ');
    R.pivot.position.set(0, 0.95, 0);
    const yaw = rider === 'ski' ? -heading : -heading * 0.9;
    R.root.rotation.order = 'YXZ';
    R.root.rotation.y = yaw;
    R.root.rotation.z = rollS;

    const pose = {
      c: P.crouch, grab: !!(P.air && P.trick && P.z > 40), plant: P.plant, noGear: false,
      look: heading * 0.6, clock: v.clock, turn: turnS * 0.2,
    };

    if (P.air && P.trick) {
      // трюк: число оборотов по названию, вращение завершается ровно к приземлению
      let m = trickMeta.get(P.trick);
      if (!m) {
        const g = 900, rem = (P.vz + Math.sqrt(P.vz * P.vz + 2 * g * P.z)) / g;
        const name = P.trick.name.toLowerCase();
        const deg = +(name.match(/\d{3}/) || [0])[0];
        const kind = /флип/.test(name) ? 'flip' : /мисти/.test(name) ? 'misty' : /флэт/.test(name) ? 'flat'
          : deg || /спиннер/.test(name) ? 'spin' : 'grab';
        m = { T: Math.max(0.3, rem), t: 0, kind, turns: Math.max(1, Math.round((deg || 360) / 360)), dir: Math.sign(P.trick.spinRate) || 1 };
        trickMeta.set(P.trick, m);
      }
      m.t += dt;
      const k = clamp(m.t / m.T, 0, 1);
      const e = k * k * (3 - 2 * k);
      const a = e * Math.PI * 2 * m.turns * m.dir;
      if (m.kind === 'flip') R.pivot.rotation.x = -Math.abs(a);
      else if (m.kind === 'misty') { R.pivot.rotation.order = 'YXZ'; R.pivot.rotation.y = a; R.pivot.rotation.x = -Math.sin(e * Math.PI) * 1.2; }
      else if (m.kind === 'flat') { R.pivot.rotation.order = 'ZYX'; R.pivot.rotation.z = Math.sin(e * Math.PI) * 0.9; R.pivot.rotation.y = a; }
      else if (m.kind === 'spin') R.pivot.rotation.y = a;
      else { R.pivot.rotation.x = -Math.sin(e * Math.PI) * 0.35; R.pivot.rotation.z = Math.sin(e * Math.PI) * 0.25 * m.dir; }
    }
    if (P.crash) {
      const k = clamp(P.crash / 0.9, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      R.pivot.rotation.order = 'XYZ';
      R.pivot.rotation.x = e * Math.PI * 2.1;
      R.pivot.rotation.z = e * Math.PI * 0.5;
      R.pivot.position.y = lerp(0.95, 0.3, e) + Math.sin(k * Math.PI) * 0.8;
      R.root.position.z = -e * 1.2;                            // отскок назад от препятствия
      pose.noGear = rider === 'ski';
      pose.c = 0.9;
    }
    R.setShield(P.shield);
    R.update(pose);
    R.root.visible = !(P.inv > 0 && Math.floor(P.inv * 12) % 2);

    /* --- следы --- */
    {
      const pos = trackGeo.attributes.position.array, cl = trackGeo.attributes.color.array;
      const lines = rider === 'ski' ? [-0.12, 0.12] : [0];
      const w = rider === 'ski' ? 0.07 : 0.3;
      let n = 0;
      const tr = v.tracks, len = tr.length;
      const put = (x, z, a) => {
        pos[n * 3] = x; pos[n * 3 + 1] = 0.015; pos[n * 3 + 2] = z;
        cl[n * 4] = 0.5; cl[n * 4 + 1] = 0.6; cl[n * 4 + 2] = 0.78; cl[n * 4 + 3] = a;
        n++;
      };
      for (const off of lines) {
        for (let i = 1; i < len && n < MAXT * 12 - 6; i++) {
          const a = tr[i - 1], b = tr[i];
          if (!a || !b) continue;
          const ax = mx(a.x) - off * Math.cos(a.a * 0.6), az = mz(a.y), bx = mx(b.x) - off * Math.cos(b.a * 0.6), bz = mz(b.y);
          let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz) || 1;
          const nx = (-dz / l) * w / 2, nz = (dx / l) * w / 2;
          const fa = (i / len) * 0.85, fb = ((i + 1) / len) * 0.85;
          put(ax + nx, az + nz, fa); put(bx + nx, bz + nz, fb); put(bx - nx, bz - nz, fb);
          put(ax + nx, az + nz, fa); put(bx - nx, bz - nz, fb); put(ax - nx, az - nz, fa);
        }
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
        emit(mx(p.x), m.h, mz(p.y), p.r * S * (2.5 + k * 4), (1 - k) * 0.85);
      }
      for (const p of spray) {
        p.vh -= 9.8 * dt; p.h = Math.max(0.03, p.h + p.vh * dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
        const k = p.t / p.life;
        emit(mx(p.x), p.h, mz(p.y), p.r * (1 + k * 2.5), (1 - k) * 0.7);
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
        m.position.set(mx(d.x), d.z * HZ + 0.05, mz(d.y));
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
          sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: getTextTex(t.text, t.color), depthTest: false, transparent: true }));
          sp.renderOrder = 10; textSprites.set(t, sp); world.add(sp);
        }
        seenT.add(t);
        sp.position.set(mx(t.x), 2.4 + t.t * 1.6, mz(t.y));
        const s = 0.9 + Math.min(1, t.t * 6) * 0.25;
        sp.scale.set(3.6 * s, 0.675 * s, 1);
        sp.material.opacity = 1 - t.t / 1.1;
      }
      for (const [t, sp] of textSprites) if (!seenT.has(t)) { world.remove(sp); sp.material.dispose(); textSprites.delete(t); }
    }

    /* --- камера --- */
    const speedK = clamp((P.speed - 240) / 460, 0, 1);
    const target = V(), look = V();
    if (P.crash) {
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
      target.set(px * 0.85 + P.angle * 0.8, 3.0 + narrow * 2.2 + speedK * 0.6 + ph * 0.8, -7.4 - narrow * 4.5 - speedK * 1.8 - ph * 0.3);
      look.set(px * 0.95 + P.angle * 1.5, 0.9 + ph * 0.85, 10);
    }
    const k = camInit ? 1 - Math.exp(-dt * (v.state === 'start' ? 2.5 : 4.5)) : 1;
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
    sun.position.copy(riderWorld).addScaledVector(SUN, 90);

    renderer.render(scene, camera);
  }

  return { canvas, render, resize };
}
