/* =====================================================================
   Coulair Run — мини-игра: спуск на лыжах или сноуборде.
   Грузится только по нажатию кнопки «Мини-игра» (см. initGame в main.js).
   ===================================================================== */
(() => {
  const V = (() => { try { return new URL(document.currentScript.src).searchParams.get('v') || ''; } catch { return ''; } })();
  const BEST_KEY = 'coulair-run-best';
  const RIDERS = {
    ski: {
      name: 'Лыжник', jacket: '#d9352b', jacketLight: '#ff6a5c', jacketDark: '#8e1a14', accent: '#ffd23f',
      pants: '#23242a', ski: '#1d4ed8',
      tricks: ['Мьют-грэб', 'Флэт-360', 'Спиннер', 'Рэйли', 'Бэкфлип', 'Мисти 720'],
    },
    board: {
      name: 'Сноубордист', jacket: '#23242b', jacketLight: '#4a4c57', jacketDark: '#0b0b0e', accent: '#5dff3a',
      pants: '#3b3f4a', board: '#16161a',
      tricks: ['Инди-грэб', 'Мелон', 'Фронт 360', 'Бэкфлип', 'Мэтод', 'Кэб 540'],
    },
  };
  const TYPES = [                       // вес при генерации трассы
    ['tree', 44], ['rock', 18], ['flake', 18], ['gate', 8], ['ramp', 7], ['helmet', 3], ['stump', 6],
  ];

  let root, canvas, ctx, W = 0, H = 0, dpr = 1;
  let state = 'start', rider = 'ski', raf = 0, last = 0;
  let P, objects, tracks, particles, texts, debris = [], cam, spawnY, score, bonus, best, shake, keys, overTimer;

  const load = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
  const save = v => { try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* приватный режим */ } };
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };

  /* ---------------- DOM ---------------- */
  function build() {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('css/game.css' + (V ? '?v=' + V : ''), document.baseURI).href;
    document.head.appendChild(css);

    root = document.createElement('div');
    root.className = 'game';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Мини-игра Coulair Run');
    root.innerHTML = `
      <canvas class="game__canvas"></canvas>
      <div class="game__hud" aria-hidden="true">
        <div><span class="game__label">Очки</span><strong data-hud="score">0</strong></div>
        <div><span class="game__label">Спуск</span><strong data-hud="dist">0 м</strong></div>
        <div class="game__shield" data-hud="shield" hidden title="Шлем защитит от одного падения">⛑</div>
        <div class="game__best"><span class="game__label">Рекорд</span><strong data-hud="best">0</strong></div>
      </div>
      <button class="game__close" data-game-close aria-label="Закрыть игру">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>

      <div class="game__panel" data-screen="start">
        <p class="game__eyebrow">Мини-игра</p>
        <h2 class="game__title">Coulair Run</h2>
        <p class="game__text">Спускайся как можно дальше: объезжай ёлки и камни, собирай снежинки, проезжай ворота и прыгай с трамплинов. Шлем спасёт от одного падения.</p>
        <div class="game__riders" role="radiogroup" aria-label="Кем кататься">
          <button class="game__rider" data-rider="ski" role="radio"><span>⛷️</span>Лыжник</button>
          <button class="game__rider" data-rider="board" role="radio"><span>🏂</span>Сноубордист</button>
        </div>
        <button class="game__start" data-game-start>Поехали</button>
        <p class="game__keys">← → — поворот · пробел — прыжок · Esc — выход</p>
      </div>

      <div class="game__panel" data-screen="over" hidden>
        <p class="game__eyebrow" data-over-reason>Упал!</p>
        <h2 class="game__title" data-over-score>0 очков</h2>
        <p class="game__text" data-over-text></p>
        <button class="game__start" data-game-start>Ещё раз</button>
        <button class="game__link" data-game-menu>Сменить райдера</button>
        <a class="game__link" data-game-shop href="catalog/?type=helmet">Настоящие шлемы — в каталоге →</a>
      </div>

      <div class="game__touch" aria-hidden="true">
        <button data-touch="left">◀</button>
        <button data-touch="jump">▲</button>
        <button data-touch="right">▶</button>
      </div>`;
    document.body.appendChild(root);
    canvas = root.querySelector('canvas');
    ctx = canvas.getContext('2d');

    const shop = root.querySelector('[data-game-shop]');
    shop.href = typeof fixUrl === 'function' ? fixUrl(shop.getAttribute('href')) : shop.href;

    root.addEventListener('click', e => {
      if (e.target.closest('[data-game-close]')) close();
      const r = e.target.closest('[data-rider]');
      if (r) setRider(r.dataset.rider);
      if (e.target.closest('[data-game-start]')) start();
      if (e.target.closest('[data-game-menu]')) showScreen('start');
    });

    // сенсорные кнопки: держишь — едешь в сторону
    root.querySelectorAll('[data-touch]').forEach(btn => {
      const k = btn.dataset.touch;
      const on = e => { e.preventDefault(); if (k === 'jump') jump(); else keys[k] = true; btn.classList.add('is-down'); };
      const off = e => { e.preventDefault(); if (k !== 'jump') keys[k] = false; btn.classList.remove('is-down'); };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    });

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    // размеры пересчитываются, когда подгрузились стили игры, при повороте телефона и т.п.
    new ResizeObserver(() => { if (!root.hidden) resize(); }).observe(root);
    document.addEventListener('visibilitychange', () => { if (document.hidden) last = 0; });
    setRider(rider);
  }

  function setRider(r) {
    rider = r;
    root.querySelectorAll('[data-rider]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.rider === r)));
  }

  function showScreen(name) {
    state = name === 'start' ? 'start' : state;
    root.querySelectorAll('[data-screen]').forEach(p => { p.hidden = p.dataset.screen !== name; });
    if (name === 'start') { reset(); state = 'start'; }
  }

  function onKey(e) {
    if (!root || root.hidden) return;
    const down = e.type === 'keydown';
    const k = e.key;
    if (k === 'Escape') { if (down) close(); e.stopPropagation(); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'd', 'w', 'ф', 'в', 'ц'].includes(k)) e.preventDefault();
    if (k === 'ArrowLeft' || k === 'a' || k === 'ф') keys.left = down;
    if (k === 'ArrowRight' || k === 'd' || k === 'в') keys.right = down;
    if (down && (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'ц')) {
      if (state === 'play') jump();
      else if (state === 'over' && performance.now() - overTimer > 600) start();
      else if (state === 'start') start();
    }
    if (down && k === 'Enter' && state !== 'play') start();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = root.clientWidth || window.innerWidth, ch = root.clientHeight || window.innerHeight;
    // на больших экранах мир крупнее, чтобы райдер и ёлки не терялись
    const zoom = Math.max(1, Math.min(1.6, Math.min(cw / 800, ch / 620)));
    W = cw / zoom; H = ch / zoom;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  }

  /* ---------------- игра ---------------- */
  function reset() {
    P = { x: 0, y: 0, z: 0, vz: 0, angle: 0, speed: 240, shield: false, inv: 0, crash: 0, spin: 0, air: false, trick: null,
          crouch: 0.3, plant: null, plantCD: 0 };
    objects = []; tracks = []; particles = []; texts = []; debris = [];
    cam = { x: 0 }; spawnY = 200; score = 0; bonus = 0; shake = 0;
    keys = { left: false, right: false };
    best = load();
    // стартовая поляна без препятствий + пара снежинок, чтобы сразу понять, что собирать
    objects.push({ type: 'flake', x: 0, y: 320, r: 16, rot: 0 }, { type: 'flake', x: 40, y: 420, r: 16, rot: 0 });
    spawnY = 520;
    hud();
  }

  function start() {
    reset();
    state = 'play';
    root.querySelectorAll('[data-screen]').forEach(p => { p.hidden = true; });
    last = 0;
  }

  function gameOver(reason) {
    state = 'over';
    overTimer = performance.now();
    const total = Math.round(score);
    const isBest = total > best;
    if (isBest) { best = total; save(best); }
    root.querySelector('[data-over-reason]').textContent = reason;
    root.querySelector('[data-over-score]').textContent = `${total.toLocaleString('ru-RU')} ${plural(total, 'очко', 'очка', 'очков')}`;
    root.querySelector('[data-over-text]').textContent = isBest
      ? 'Новый рекорд! Так держать.'
      : `Спуск ${Math.round(P.y / 10)} м. Рекорд — ${best.toLocaleString('ru-RU')}.`;
    setTimeout(() => { if (state === 'over') showScreen('over'); }, 700);
    hud();
  }

  function jump() {
    if (state !== 'play' || P.z > 0 || P.crash) return;
    P.vz = 300; P.air = true; P.trick = null;
  }

  function spawnRow() {
    const difficulty = Math.min(1, P.y / 60000);
    spawnY += rand(46, 92) * (1 - difficulty * 0.45);
    const total = TYPES.reduce((s, t) => s + t[1], 0);
    let roll = Math.random() * total, type = 'tree';
    for (const [t, w] of TYPES) { if ((roll -= w) < 0) { type = t; break; } }
    if (type === 'helmet' && P.shield) type = 'flake';
    // на широкой трассе в ряду несколько объектов — плотность одинаковая при любой ширине экрана
    const perRow = Math.max(1, Math.round(W / 420));
    for (let i = 0; i < perRow; i++) spawnOne(i === 0 ? type : null);
  }

  function spawnOne(forced) {
    let type = forced;
    if (!type) {
      const total = TYPES.reduce((s, t) => s + t[1], 0);
      let roll = Math.random() * total;
      for (const [t, w] of TYPES) { if ((roll -= w) < 0) { type = t; break; } }
      if (type === 'helmet' && P.shield) type = 'flake';
    }
    const x = cam.x + rand(-W * 0.75, W * 0.75);
    const y = spawnY + rand(-20, 20);
    switch (type) {
      case 'tree':   objects.push({ type, x, y, r: 11, h: rand(58, 96), sway: Math.random() * 6 }); break;
      case 'rock':   objects.push({ type, x, y, r: 13, w: rand(22, 34) }); break;
      case 'stump':  objects.push({ type, x, y, r: 9 }); break;
      case 'flake':  objects.push({ type, x, y, r: 18, rot: Math.random() * 6 }); break;
      case 'helmet': objects.push({ type, x, y, r: 20, bob: 0 }); break;
      case 'ramp':   objects.push({ type, x, y, r: 26, w: 60 }); break;
      case 'gate': {
        const gap = rand(80, 120);
        objects.push({ type: 'pole', x: x - gap / 2, y, r: 5, color: '#d9352b' });
        objects.push({ type: 'pole', x: x + gap / 2, y, r: 5, color: '#2466d9' });
        objects.push({ type: 'gate', x, y, gap, done: false });
        break;
      }
    }
  }

  function addText(text, x, y, color = '#16161a') {
    texts.push({ text, x, y, t: 0, color });
  }

  function puff(x, y, n, spread = 1) {
    for (let i = 0; i < n; i++) {
      particles.push({ x, y, vx: rand(-80, 80) * spread, vy: rand(-110, 10) * spread, life: rand(0.4, 0.9), t: 0, r: rand(2, 5) });
    }
  }

  function crashInto(o) {
    if (P.inv > 0) return;
    if (P.shield) {
      P.shield = false; P.inv = 1.6;
      puff(o.x, o.y, 22, 1.3);
      o.dead = true;
      addText('Шлем спас!', P.x, P.y - 40, '#2d7a3e');
      shake = 8;
      return;
    }
    P.crash = 0.001; shake = 14;
    puff(P.x, P.y, 34, 1.6);
    // «распродажа на склоне»: лыжи и палки разлетаются
    const gear = rider === 'ski' ? ['ski', 'ski', 'pole', 'pole'] : [];
    for (const kind of gear) {
      debris.push({ kind, x: P.x + rand(-6, 6), y: P.y, z: 6, vx: rand(-160, 160), vy: P.speed * rand(0.35, 0.8), vz: rand(160, 300), rot: rand(0, 6), vr: rand(-14, 14) });
    }
    gameOver(o.type === 'tree' ? 'Врезался в ёлку!' : o.type === 'pole' ? 'Снёс флаг!' : 'Зацепил камень!');
  }

  function update(dt) {
    if (state === 'play' && !P.crash) {
      // управление: держишь стрелку — поворачиваешь, отпустил — выравниваешься вниз по склону
      const target = keys.left && !keys.right ? -1 : keys.right && !keys.left ? 1 : 0;
      const turnRate = rider === 'ski' ? 6.5 : 5.2;
      const prevAngle = P.angle;
      P.angle += (target - P.angle) * Math.min(1, turnRate * dt);
      const carve = Math.abs(P.angle - prevAngle) / dt;

      const dist = P.y / 10;
      P.speed = Math.min(700, 240 + dist * 0.45);
      const brake = 1 - 0.38 * Math.abs(P.angle);
      const vx = P.speed * P.angle * 0.8;
      const vy = P.speed * brake;
      P.x += vx * dt;
      P.y += vy * dt;

      // прыжок
      if (P.air) {
        P.vz -= 900 * dt;
        P.z = Math.max(0, P.z + P.vz * dt);
        if (P.trick) P.spin += dt * P.trick.spinRate;
        if (P.z === 0) {
          P.air = false;
          puff(P.x, P.y, 10);
          if (P.trick) {
            const pts = P.trick.points;
            bonus += pts;
            addText(`${P.trick.name} +${pts}`, P.x, P.y - 50, '#d9352b');
            P.trick = null;
          }
          P.spin = 0;
        }
      }
      if (P.inv > 0) P.inv -= dt;

      // поза: присед сильнее в повороте и в воздухе; палка втыкается при заходе в поворот
      const targetCrouch = P.air ? (P.trick ? 0.95 : 0.65) : 0.25 + 0.5 * Math.abs(P.angle) + Math.sin(clock * 7) * 0.03;
      P.crouch += (targetCrouch - P.crouch) * Math.min(1, 9 * dt);
      P.plantCD -= dt;
      if (P.plant) { P.plant.t += dt; if (P.plant.t > 0.3) P.plant = null; }
      if (!P.air && target && P.plantCD <= 0 && Math.abs(P.angle) < 0.7) {
        P.plant = { side: target, t: 0 }; P.plantCD = 0.55;
        if (rider === 'ski') puff(P.x + target * 18, P.y + 12, 3, 0.35);
      }

      // брызги снега при резком повороте
      if (!P.air && carve > 2.2 && Math.random() < 0.8) {
        particles.push({ x: P.x - Math.sign(P.angle) * 6, y: P.y + 6, vx: -Math.sign(P.angle) * rand(40, 120), vy: rand(-60, 0), life: rand(0.3, 0.6), t: 0, r: rand(1.5, 3.5) });
      }

      // следы
      if (!P.air) tracks.push({ x: P.x, y: P.y, a: P.angle });
      else tracks.push(null);
      if (tracks.length > 180) tracks.shift();

      // столкновения
      for (const o of objects) {
        if (o.dead) continue;
        const dx = o.x - P.x, dy = o.y - P.y;
        if (o.type === 'gate') {
          if (!o.done && P.y >= o.y) {
            o.done = true;
            if (Math.abs(P.x - o.x) < o.gap / 2) { bonus += 100; addText('Ворота +100', o.x, o.y - 30, '#2466d9'); }
          }
          continue;
        }
        const dist2 = dx * dx + dy * dy, rr = (o.r + 10) * (o.r + 10);
        if (dist2 > rr) continue;
        switch (o.type) {
          case 'flake':
            o.dead = true; bonus += 25; addText('+25', o.x, o.y - 20, '#2466d9'); puff(o.x, o.y, 6, 0.6);
            break;
          case 'helmet':
            o.dead = true; P.shield = true; addText('Шлем надет!', o.x, o.y - 30, '#2d7a3e');
            break;
          case 'ramp':
            if (!P.air) {
              const t = pick(RIDERS[rider].tricks);
              P.vz = 520 + P.speed * 0.25; P.air = true;
              P.trick = { name: t, points: 150 + Math.round(P.speed / 5) * 5, spinRate: rand(9, 14) * (Math.random() < 0.5 ? -1 : 1) };
            }
            break;
          case 'tree':  if (P.z < 70) crashInto(o); break;
          case 'pole':  if (P.z < 30) crashInto(o); break;
          case 'rock':
          case 'stump': if (P.z < 10) crashInto(o); break;
        }
        if (state !== 'play') break;
      }

      score = P.y / 10 + bonus;
    } else if (P.crash) {
      P.crash += dt;
    }

    // камера плавно следует за райдером
    cam.x += (P.x - cam.x) * Math.min(1, 3 * dt);

    // генерация и уборка трассы
    while (spawnY < P.y + H * 1.2) spawnRow();
    objects = objects.filter(o => !o.dead && o.y > P.y - H * 0.6);

    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; }
    for (const d of debris) {
      d.vz -= 900 * dt; d.z += d.vz * dt;
      if (d.z <= 0) { d.z = 0; d.vz = -d.vz * 0.3; d.vx *= 0.9; d.vy *= 0.9; d.vr *= 0.8; }
      const f = d.z > 0 ? 1 : Math.exp(-3 * dt);
      d.vx *= f; d.vy *= f; d.vr *= f;
      d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
    }
    particles = particles.filter(p => p.t < p.life);
    for (const t of texts) t.t += dt;
    texts = texts.filter(t => t.t < 1.1);
    shake = Math.max(0, shake - 40 * dt);
    hud();
  }

  let hudCache = '';
  function hud() {
    const s = Math.round(score), d = Math.round((P ? P.y : 0) / 10);
    const key = `${s}|${d}|${best}|${P && P.shield}`;
    if (key === hudCache) return;
    hudCache = key;
    root.querySelector('[data-hud="score"]').textContent = s.toLocaleString('ru-RU');
    root.querySelector('[data-hud="dist"]').textContent = d.toLocaleString('ru-RU') + ' м';
    root.querySelector('[data-hud="best"]').textContent = Math.max(best, state === 'play' ? s : 0).toLocaleString('ru-RU');
    root.querySelector('[data-hud="shield"]').hidden = !(P && P.shield);
  }

  /* ---------------- отрисовка ---------------- */
  const PLAYER_Y = () => H * 0.32;
  const SS = 3;                       // спрайты рисуются в 3× — чёткие при любом масштабе
  let SPR = null, clock = 0;

  function toScreen(x, y) {
    return [x - cam.x + W / 2, y - P.y + PLAYER_Y()];
  }

  function sprite(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * SS); c.height = Math.ceil(h * SS);
    const g = c.getContext('2d');
    g.scale(SS, SS);
    paint(g, w, h);
    c.w = w; c.h = h;
    return c;
  }
  const rng = seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  // --- снег: вельвет от ратрака, неровности и искры; тайл бесшовный ---
  function snowTile() {
    const S = 256;
    return sprite(S, S, g => {
      g.fillStyle = '#f2f6fb'; g.fillRect(0, 0, S, S);
      const r = rng(11);
      for (let i = 0; i < 16; i++) {
        const x = r() * S, y = r() * S, rad = 24 + r() * 60, dark = r() < 0.6;
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
          const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          gr.addColorStop(0, dark ? 'rgba(160,182,215,.13)' : 'rgba(255,255,255,.7)');
          gr.addColorStop(1, dark ? 'rgba(160,182,215,0)' : 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
        }
      }
      for (let x = 0; x < S; x += 4) {                       // вельвет вдоль склона
        g.fillStyle = 'rgba(175,195,225,.09)'; g.fillRect(x, 0, 1.3, S);
        g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + 1.6, 0, 1, S);
      }
      for (let i = 0; i < 220; i++) {                        // искры и крупинки
        const x = r() * S, y = r() * S;
        g.fillStyle = r() < 0.7 ? `rgba(255,255,255,${0.7 + r() * 0.3})` : 'rgba(140,165,205,.28)';
        g.fillRect(x, y, 0.7 + r() * 0.6, 0.7 + r() * 0.6);
      }
    });
  }

  // --- ель: ярусы с пилообразными лапами и снегом на каждом ---
  function pineSprite(seed) {
    const r = rng(seed * 97 + 13);
    const h = 92 + r() * 46, w = h * (0.5 + r() * 0.12);
    const SW = w + 12, SH = h + 12;
    const c = sprite(SW, SH, g => {
      const cx = SW / 2, base = h + 4;
      const trunk = g.createLinearGradient(cx - 4, 0, cx + 4, 0);
      trunk.addColorStop(0, '#7a4f2e'); trunk.addColorStop(1, '#3c2415');
      g.fillStyle = trunk; g.fillRect(cx - 4, base - 18, 8, 18);
      const tiers = 6 + (r() * 3 | 0);
      for (let i = tiers - 1; i >= 0; i--) {                 // снизу вверх: верхние ярусы перекрывают нижние
        const t = i / (tiers - 1);
        const top = 2 + t * (h - 34);
        const bottom = top + 20 + t * 18;
        const half = 4 + t * (w / 2 - 4) * (0.92 + r() * 0.12);
        const teeth = 4 + (t * 5 | 0);
        const edge = [];
        for (let k = teeth; k >= -teeth; k--) {
          edge.push([cx + half * k / teeth + (r() - 0.5) * 2, bottom - (k % 2 ? 5 + r() * 3 : 0)]);
        }
        const gr = g.createLinearGradient(cx - half, top, cx + half, bottom);
        gr.addColorStop(0, '#3b8a58'); gr.addColorStop(0.45, '#23633e'); gr.addColorStop(1, '#123a24');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(cx, top);
        edge.forEach(([x, y]) => g.lineTo(x, y));
        g.closePath(); g.fill();
        // тёмный низ яруса
        g.fillStyle = 'rgba(8,30,18,.35)';
        g.beginPath(); edge.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
        for (let k = edge.length - 1; k >= 0; k--) g.lineTo(edge[k][0] * 0.98 + cx * 0.02, edge[k][1] - 5);
        g.closePath(); g.fill();
        // снег на лапах: светлая шапка слева-сверху, синеватая тень справа
        const sg = g.createLinearGradient(cx - half, top, cx + half, top);
        sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.6, '#eef4fc'); sg.addColorStop(1, '#c9d8ee');
        g.fillStyle = sg;
        g.beginPath(); g.moveTo(cx, top - 0.5);
        const sy = top + (bottom - top) * 0.55;
        g.lineTo(cx + half * 0.55, top + (bottom - top) * 0.5);
        for (let k = 6; k >= -6; k--) g.lineTo(cx + half * 0.72 * k / 6, sy + (k % 2 ? 3 : -1) * (0.6 + r()));
        g.closePath(); g.fill();
        // комья снега на концах лап
        for (let k = 0; k < 3; k++) {
          const e = edge[(r() * edge.length) | 0];
          g.fillStyle = 'rgba(255,255,255,.9)';
          g.beginPath(); g.ellipse(e[0], e[1] - 5, 2 + r() * 2, 1.4, 0, 0, Math.PI * 2); g.fill();
        }
      }
    });
    c.baseY = h + 4;
    return c;
  }

  // --- камень с гранями и снежной шапкой ---
  function rockSprite(seed) {
    const r = rng(seed * 31 + 7);
    const w = 30 + r() * 16, h = w * 0.6;
    const SW = w + 10, SH = h + 12;
    const c = sprite(SW, SH, g => {
      const cx = SW / 2, by = h + 6;
      const pts = [];
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (i / (n - 1)) * Math.PI;
        const k = 0.72 + r() * 0.32;
        pts.push([cx + Math.cos(a) * (w / 2) * (i === 0 || i === n - 1 ? 1 : k), by - 3 + Math.sin(a) * h * k]);
      }
      const body = g.createLinearGradient(cx - w / 2, by - h, cx + w / 2, by);
      body.addColorStop(0, '#b3b8c1'); body.addColorStop(0.5, '#80868f'); body.addColorStop(1, '#4b5058');
      g.fillStyle = body;
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      const ctr = [cx - w * 0.06, by - h * 0.42];
      for (let i = 0; i < pts.length - 1; i++) {             // грани: свет слева, тень справа
        g.beginPath(); g.moveTo(ctr[0], ctr[1]); g.lineTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.closePath();
        g.fillStyle = i < 3 ? `rgba(255,255,255,${0.06 + r() * 0.14})` : `rgba(0,0,0,${0.06 + r() * 0.16})`;
        g.fill();
      }
      g.strokeStyle = 'rgba(40,44,52,.35)'; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(ctr[0], ctr[1]); g.lineTo(pts[4][0], pts[4][1]); g.moveTo(ctr[0], ctr[1]); g.lineTo(pts[2][0], pts[2][1]); g.stroke();
      // снежная шапка
      const cap = g.createLinearGradient(0, by - h, 0, by - h * 0.4);
      cap.addColorStop(0, '#ffffff'); cap.addColorStop(1, '#dde7f5');
      g.fillStyle = cap;
      g.beginPath(); g.moveTo(pts[1][0] - 1, pts[1][1] + 2);
      for (let i = 1; i < n - 1; i++) g.lineTo(pts[i][0], pts[i][1] - 1.5);
      for (let k = 5; k >= 0; k--) g.lineTo(pts[1][0] + (pts[n - 2][0] - pts[1][0]) * k / 5, pts[3][1] + h * 0.28 + (k % 2 ? 2.5 : 0));
      g.closePath(); g.fill();
      // снег, наметённый у основания
      g.fillStyle = '#f3f7fc';
      g.beginPath(); g.ellipse(cx - w * 0.3, by, w * 0.28, 3.2, 0, Math.PI, 0); g.fill();
      g.beginPath(); g.ellipse(cx + w * 0.32, by, w * 0.22, 2.6, 0, Math.PI, 0); g.fill();
    });
    c.baseY = h + 6;
    return c;
  }

  function stumpSprite() {
    const c = sprite(30, 26, g => {
      const cx = 15, by = 22;
      const bark = g.createLinearGradient(cx - 9, 0, cx + 9, 0);
      bark.addColorStop(0, '#7b5132'); bark.addColorStop(0.5, '#5a3820'); bark.addColorStop(1, '#3a2414');
      g.fillStyle = bark;
      g.beginPath(); g.moveTo(cx - 9, by - 13); g.lineTo(cx - 10, by); g.quadraticCurveTo(cx, by + 3, cx + 10, by); g.lineTo(cx + 9, by - 13); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,18,8,.5)'; g.lineWidth = 0.7;
      for (const x of [-6, -2, 3, 7]) { g.beginPath(); g.moveTo(cx + x, by - 12); g.lineTo(cx + x + 0.5, by); g.stroke(); }
      g.fillStyle = '#d8b78c';
      g.beginPath(); g.ellipse(cx, by - 13, 9, 3.6, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(120,80,40,.6)'; g.lineWidth = 0.5;
      for (const k of [2.5, 5, 7.5]) { g.beginPath(); g.ellipse(cx, by - 13, k, k * 0.4, 0, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(cx - 1.5, by - 14, 6.5, 2.4, -0.1, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f2f6fb';
      g.beginPath(); g.ellipse(cx, by + 0.5, 12, 2.6, 0, Math.PI, 0); g.fill();
    });
    c.baseY = 22;
    return c;
  }

  // --- кикер: подъём к кромке, оранжевая разметка, тень за кромкой ---
  function kickerSprite() {
    const W0 = 70, H0 = 44;
    const c = sprite(W0, H0, g => {
      const cx = W0 / 2, lip = 30, back = 6, half = 28;
      // боковины
      g.fillStyle = '#c8d6ea';
      g.beginPath(); g.moveTo(cx - half + 6, back); g.lineTo(cx - half, lip); g.lineTo(cx - half - 3, lip + 6); g.lineTo(cx - half + 3, back + 2); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(cx + half - 6, back); g.lineTo(cx + half, lip); g.lineTo(cx + half + 3, lip + 6); g.lineTo(cx + half - 3, back + 2); g.closePath(); g.fill();
      // рабочая поверхность — светлеет к кромке
      const top = g.createLinearGradient(0, back, 0, lip);
      top.addColorStop(0, '#e3ebf6'); top.addColorStop(1, '#ffffff');
      g.fillStyle = top;
      g.beginPath(); g.moveTo(cx - half + 6, back); g.lineTo(cx + half - 6, back); g.lineTo(cx + half, lip); g.lineTo(cx - half, lip); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(170,190,220,.5)'; g.lineWidth = 0.6;
      for (let x = -half + 8; x < half - 6; x += 4) { g.beginPath(); g.moveTo(cx + x * 0.8, back + 1); g.lineTo(cx + x, lip - 1); g.stroke(); }
      // стенка за кромкой в тени
      const drop = g.createLinearGradient(0, lip, 0, lip + 10);
      drop.addColorStop(0, '#9fb3d1'); drop.addColorStop(1, 'rgba(159,179,209,0)');
      g.fillStyle = drop;
      g.beginPath(); g.moveTo(cx - half, lip); g.lineTo(cx + half, lip); g.lineTo(cx + half - 4, lip + 10); g.lineTo(cx - half + 4, lip + 10); g.closePath(); g.fill();
      // разметка кромки
      g.strokeStyle = '#ff6a13'; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(cx - half + 1, lip - 0.5); g.lineTo(cx + half - 1, lip - 0.5); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(cx - half + 3, lip - 1.6); g.lineTo(cx + half - 3, lip - 1.6); g.stroke();
      // маркеры по углам
      for (const sx of [-1, 1]) {
        const x = cx + sx * (half + 2);
        g.strokeStyle = '#333'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, lip + 2); g.lineTo(x, lip - 16); g.stroke();
        g.fillStyle = '#ff6a13';
        g.beginPath(); g.moveTo(x, lip - 16); g.lineTo(x + sx * 7, lip - 13); g.lineTo(x, lip - 10); g.closePath(); g.fill();
      }
    });
    c.baseY = 30;
    return c;
  }

  // мягкая частица снежной пыли
  function puffSprite() {
    return sprite(24, 24, g => {
      const gr = g.createRadialGradient(12, 12, 0, 12, 12, 12);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.5, 'rgba(245,249,255,.75)');
      gr.addColorStop(1, 'rgba(235,242,252,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 24, 24);
    });
  }

  function buildSprites() {
    const snow = snowTile();
    const pat = ctx.createPattern(snow, 'repeat');
    pat.setTransform(new DOMMatrix().scale(1 / SS));
    SPR = {
      snow: pat,
      pines: Array.from({ length: 7 }, (_, i) => pineSprite(i + 1)),
      rocks: Array.from({ length: 5 }, (_, i) => rockSprite(i + 1)),
      stump: stumpSprite(),
      kicker: kickerSprite(),
      puff: puffSprite(),
    };
  }

  function shadow(sx, sy, rx, ry, a = 0.22) {
    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
    gr.addColorStop(0, `rgba(70, 95, 140, ${a})`);
    gr.addColorStop(1, 'rgba(70, 95, 140, 0)');
    ctx.fillStyle = gr;
    ctx.save(); ctx.translate(sx, sy); ctx.scale(1, ry / rx); ctx.translate(-sx, -sy);
    ctx.beginPath(); ctx.arc(sx, sy, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!SPR) buildSprites();
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (shake) ctx.translate(rand(-shake, shake) * 0.4, rand(-shake, shake) * 0.4);

    // снег
    const T = 256;
    const ox = (((cam.x - W / 2) % T) + T) % T, oy = (((P.y - PLAYER_Y()) % T) + T) % T;
    ctx.save(); ctx.translate(-ox, -oy);
    ctx.fillStyle = SPR.snow; ctx.fillRect(0, 0, W + T * 2, H + T * 2);
    ctx.restore();

    drawTracks();

    const list = objects.map(o => ({ y: o.y, o }));
    list.push({ y: P.y, player: true });
    for (const d of debris) list.push({ y: d.y, d });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      if (it.player) drawPlayer();
      else if (it.d) drawDebris(it.d);
      else drawObject(it.o);
    }

    // снежная пыль
    for (const p of particles) {
      const [sx, sy] = toScreen(p.x, p.y);
      const k = p.t / p.life;
      const size = p.r * (2.2 + k * 2.5);
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.drawImage(SPR.puff, sx - size / 2, sy - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    // всплывающие надписи с обводкой
    ctx.textAlign = 'center';
    ctx.font = '800 17px Manrope, system-ui, sans-serif';
    ctx.lineJoin = 'round';
    for (const t of texts) {
      const [sx, sy] = toScreen(t.x, t.y);
      const yy = sy - t.t * 42;
      ctx.globalAlpha = 1 - t.t / 1.1;
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 4;
      ctx.strokeText(t.text, sx, yy);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sx, yy);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // следы: вдавленная борозда + светлый край
  function drawTracks() {
    const lines = rider === 'ski' ? [-5.5, 5.5] : [0];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? 'rgba(255,255,255,.8)' : 'rgba(120,145,190,.34)';
      ctx.lineWidth = rider === 'ski' ? (pass ? 0.9 : 2.4) : (pass ? 1.6 : 8);
      for (const off of lines) {
        ctx.beginPath();
        let pen = false;
        for (const t of tracks) {
          if (!t) { pen = false; continue; }
          const [sx, sy] = toScreen(t.x + off * Math.cos(t.a * 0.6) + (pass ? 1 : 0), t.y);
          if (!pen) { ctx.moveTo(sx, sy); pen = true; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
    }
  }

  function drawObject(o) {
    const [sx, sy] = toScreen(o.x, o.y);
    if (sy < -40 || sy > H + 170 || sx < -90 || sx > W + 90) return;
    if (o.v === undefined) o.v = (Math.random() * 1000) | 0;
    switch (o.type) {
      case 'tree': {
        const sp = SPR.pines[o.v % SPR.pines.length];
        shadow(sx + sp.w * 0.28, sy + 2, sp.w * 0.55, 8, 0.26);
        ctx.drawImage(sp, sx - sp.w / 2, sy - sp.baseY, sp.w, sp.h);
        break;
      }
      case 'rock': {
        const sp = SPR.rocks[o.v % SPR.rocks.length];
        shadow(sx + 5, sy + 1, sp.w * 0.5, 6);
        ctx.drawImage(sp, sx - sp.w / 2, sy - sp.baseY, sp.w, sp.h);
        break;
      }
      case 'stump': {
        const sp = SPR.stump;
        shadow(sx + 4, sy + 1, 13, 4);
        ctx.drawImage(sp, sx - sp.w / 2, sy - sp.baseY, sp.w, sp.h);
        break;
      }
      case 'ramp': {
        const sp = SPR.kicker;
        shadow(sx + 4, sy + 10, 36, 7, 0.16);
        ctx.drawImage(sp, sx - sp.w / 2, sy - sp.baseY, sp.w, sp.h);
        break;
      }
      case 'pole': drawGatePole(sx, sy, o); break;
      case 'flake': drawFlakePickup(sx, sy, o); break;
      case 'helmet': drawHelmetPickup(sx, sy, o); break;
    }
  }

  // слаломное древко с полосами и развевающимся полотнищем
  function drawGatePole(sx, sy, o) {
    shadow(sx + 6, sy + 1, 9, 2.5);
    const red = o.color === '#d9352b';
    const h = 40, dir = red ? 1 : -1;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : (red ? '#d9352b' : '#2466d9');
      ctx.fillRect(sx - 1.3, sy - h + i * (h / 8), 2.6, h / 8 + 0.3);
    }
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(sx + 0.4, sy - h, 0.9, h);
    // полотнище
    const wave = Math.sin(clock * 5 + o.x * 0.1) * 2.5;
    const fg = ctx.createLinearGradient(sx, 0, sx + dir * 18, 0);
    fg.addColorStop(0, red ? '#e8453a' : '#3478ee'); fg.addColorStop(1, red ? '#b8261d' : '#1a4fb0');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(sx, sy - h + 1);
    ctx.quadraticCurveTo(sx + dir * 9, sy - h - 1 + wave, sx + dir * 18, sy - h + 2 + wave);
    ctx.lineTo(sx + dir * 17, sy - h + 13 + wave);
    ctx.quadraticCurveTo(sx + dir * 9, sy - h + 11 + wave * 0.5, sx, sy - h + 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '800 5px Manrope, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('CC', sx + dir * 9, sy - h + 9 + wave * 0.6);
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(sx, sy - h, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  // снежинка-бонус: светящийся кристалл
  function drawFlakePickup(sx, sy, o) {
    o.rot += 0.025;
    const y = sy - 14 + Math.sin(clock * 3 + o.x) * 2;
    shadow(sx + 3, sy + 1, 8, 2.5, 0.14);
    const glow = ctx.createRadialGradient(sx, y, 0, sx, y, 18);
    glow.addColorStop(0, 'rgba(120,190,255,.45)'); glow.addColorStop(1, 'rgba(120,190,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, y, 18, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(sx, y); ctx.rotate(o.rot);
    ctx.lineCap = 'round';
    for (const [col, lw] of [['#3f8ff0', 3], ['#e6f3ff', 1.2]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -11);
        ctx.moveTo(0, -4.5); ctx.lineTo(-3, -7.5); ctx.moveTo(0, -4.5); ctx.lineTo(3, -7.5);
        ctx.moveTo(0, -8); ctx.lineTo(-2, -10); ctx.moveTo(0, -8); ctx.lineTo(2, -10);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // --- шлем: матовая оболочка с бликом, вентиляция, маска с зеркальной линзой ---
  function drawHelmet(x, y, s, shell = '#1b1c21', accent = '#5dff3a', side = 0) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    // оболочка
    const g = ctx.createRadialGradient(-4 + side * 2, -7, 1, 0, -1, 13);
    g.addColorStop(0, shell === '#f4f5f7' ? '#ffffff' : '#6b6e78');
    g.addColorStop(0.35, shell);
    g.addColorStop(1, shell === '#f4f5f7' ? '#b9bfca' : '#050507');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-10.5, 3);
    ctx.bezierCurveTo(-11.5, -7, -6, -12.5, 0, -12.5);
    ctx.bezierCurveTo(6, -12.5, 11.5, -7, 10.5, 3);
    ctx.quadraticCurveTo(10, 6.5, 7.5, 7);
    ctx.lineTo(-7.5, 7);
    ctx.quadraticCurveTo(-10, 6.5, -10.5, 3);
    ctx.closePath(); ctx.fill();
    // рёбра и вентиляция
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    for (const [vx, vy, rot] of [[-4.5, -8.5, -0.5], [0, -10, 0], [4.5, -8.5, 0.5], [-7.5, -4, -1], [7.5, -4, 1]]) {
      ctx.save(); ctx.translate(vx, vy); ctx.rotate(rot);
      ctx.beginPath(); ctx.roundRect(-0.9, -2, 1.8, 4, 0.9); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = accent; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-9.8, -1); ctx.bezierCurveTo(-8, -3.5, 8, -3.5, 9.8, -1); ctx.stroke();
    // блик
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.beginPath(); ctx.ellipse(-4 + side * 2, -8.5, 3.6, 1.6, -0.5, 0, Math.PI * 2); ctx.fill();
    // ремень маски
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.roundRect(-10.8, 0.6, 21.6, 3.6, 1.2); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(-9.5, 1.9, 3, 1); ctx.fillRect(6.5, 1.9, 3, 1);
    // маска: оправа и зеркальная линза
    ctx.fillStyle = '#0d0d10';
    ctx.beginPath(); ctx.roundRect(-8 + side * 1.5, -0.4, 16, 7.4, 3.2); ctx.fill();
    const lens = ctx.createLinearGradient(-7, 0, 7, 6.4);
    lens.addColorStop(0, '#ffb13b'); lens.addColorStop(0.45, '#ff4f7b'); lens.addColorStop(0.8, '#7a5cff'); lens.addColorStop(1, '#2cc9ff');
    ctx.fillStyle = lens;
    ctx.beginPath(); ctx.roundRect(-7 + side * 1.5, 0.5, 14, 5.6, 2.6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.moveTo(-5.5 + side * 1.5, 1.4); ctx.lineTo(-1 + side * 1.5, 1.4); ctx.lineTo(-3 + side * 1.5, 3.6); ctx.lineTo(-6 + side * 1.5, 3.6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawHelmetPickup(sx, sy, o) {
    o.bob = (o.bob || 0) + 0.05;
    const y = sy - 18 + Math.sin(o.bob) * 3;
    shadow(sx + 4, sy + 1, 13, 3.5, 0.18);
    const pulse = 0.5 + 0.5 * Math.sin(clock * 4);
    const glow = ctx.createRadialGradient(sx, y, 2, sx, y, 26);
    glow.addColorStop(0, `rgba(93,255,58,${0.3 + pulse * 0.15})`); glow.addColorStop(1, 'rgba(93,255,58,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, y, 26, 0, Math.PI * 2); ctx.fill();
    drawHelmet(sx, y + 2, 1.35, '#1b1c21', '#5dff3a', Math.sin(clock * 1.5) * 0.8);
    // искорки
    for (let i = 0; i < 3; i++) {
      const a = clock * 2 + i * 2.1, r = 17 + Math.sin(clock * 3 + i) * 3;
      const px = sx + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.6;
      ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(clock * 6 + i)})`;
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-0.6, -2.4, 1.2, 4.8); ctx.fillRect(-2.4, -0.6, 4.8, 1.2);
      ctx.restore();
    }
  }

  /* --- райдер --- */
  const SKIN = '#e9b78f';

  function limb(x1, y1, x2, y2, x3, y3, w, col, hi) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.stroke();
    if (hi) {
      ctx.strokeStyle = hi; ctx.lineWidth = w * 0.3;
      ctx.beginPath(); ctx.moveTo(x1 - w * 0.22, y1); ctx.lineTo(x2 - w * 0.22, y2); ctx.lineTo(x3 - w * 0.22, y3); ctx.stroke();
    }
  }

  function drawSki(x, color, accent) {
    // лыжа от пятки (-19) до загнутого носка (+27)
    const g = ctx.createLinearGradient(x - 2.5, 0, x + 2.5, 0);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, color); g.addColorStop(1, '#0c0c0f');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 2.2, -19); ctx.quadraticCurveTo(x, -20.5, x + 2.2, -19);
    ctx.lineTo(x + 2, 20); ctx.quadraticCurveTo(x + 2.8, 25.5, x, 27.5); ctx.quadraticCurveTo(x - 2.8, 25.5, x - 2, 20);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(x - 0.6, -15, 1.2, 12); ctx.fillRect(x - 0.6, 6, 1.2, 12);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.ellipse(x - 0.5, 24.5, 0.8, 2, 0, 0, Math.PI * 2); ctx.fill();
    // крепление
    ctx.fillStyle = '#9ca3ad'; ctx.fillRect(x - 2.4, -5, 4.8, 2.2); ctx.fillRect(x - 2.4, 4, 4.8, 2.4);
    ctx.fillStyle = '#e3342f'; ctx.fillRect(x - 1, 4.4, 2, 1.4);
  }

  function drawBoot(x, y) {
    const g = ctx.createLinearGradient(x - 3.5, 0, x + 3.5, 0);
    g.addColorStop(0, '#6e737c'); g.addColorStop(1, '#2b2e34');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x - 3.6, y - 8, 7.2, 12.5, 2.4); ctx.fill();
    ctx.strokeStyle = 'rgba(230,235,245,.8)'; ctx.lineWidth = 0.7;
    for (const by of [-5, -2, 1.5]) { ctx.beginPath(); ctx.moveTo(x - 3, y + by); ctx.lineTo(x + 3, y + by); ctx.stroke(); }
  }

  function drawPole(hx, hy, tx, ty) {
    ctx.strokeStyle = '#b8c0cc'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,65,75,.6)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(hx + 0.5, hy); ctx.lineTo(tx + 0.5, ty); ctx.stroke();
    const k = 0.86, bx = hx + (tx - hx) * k, by = hy + (ty - hy) * k;
    ctx.strokeStyle = '#1a1a1e'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.ellipse(bx, by, 2.3, 1, 0, 0, Math.PI * 2); ctx.stroke();
  }

  function drawTorso(hipY, shY, R, lean) {
    const g = ctx.createLinearGradient(-10, 0, 10, 0);
    g.addColorStop(0, R.jacketLight); g.addColorStop(0.45, R.jacket); g.addColorStop(1, R.jacketDark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-8, hipY + 1); ctx.quadraticCurveTo(-11.5, (hipY + shY) / 2, -10.5 + lean * 0.3, shY + 1.5);
    ctx.quadraticCurveTo(0, shY - 2.5, 10.5 + lean * 0.3, shY + 1.5);
    ctx.quadraticCurveTo(11.5, (hipY + shY) / 2, 8, hipY + 1);
    ctx.closePath(); ctx.fill();
    // полоса-акцент, молния, карманы, воротник
    ctx.fillStyle = R.accent;
    ctx.beginPath(); ctx.moveTo(-10.4, shY + 6); ctx.lineTo(10.4, shY + 6); ctx.lineTo(10.2, shY + 8); ctx.lineTo(-10.2, shY + 8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(0.5, shY); ctx.lineTo(0.5, hipY + 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6.5, hipY - 5); ctx.lineTo(-3, hipY - 6); ctx.moveTo(6.5, hipY - 5); ctx.lineTo(3, hipY - 6); ctx.stroke();
    ctx.fillStyle = R.jacketDark;
    ctx.beginPath(); ctx.roundRect(-8, hipY - 1.5, 16, 3, 1.5); ctx.fill();
    ctx.fillStyle = '#16161a';
    ctx.beginPath(); ctx.ellipse(0, shY, 5.5, 2.6, 0, 0, Math.PI * 2); ctx.fill();   // бафф на шее
  }

  function drawSkier(pose) {
    const R = RIDERS.ski;
    const th = P.angle * 0.8;
    const c = pose.crouch, lean = P.angle * 3.5;
    const cos = Math.cos(-th), sin = Math.sin(-th);
    const rot = (x, y) => [x * cos - y * sin, x * sin + y * cos];

    // лыжи и ботинки поворачиваются по направлению движения
    if (!pose.noGear) {
      ctx.save(); ctx.rotate(-th);
      drawSki(-5.5, R.ski, R.accent); drawSki(5.5, R.ski, R.accent);
      ctx.restore();
    }
    const [alx, aly] = rot(-5.5, -1), [arx, ary] = rot(5.5, -1);
    ctx.save(); ctx.rotate(-th);
    drawBoot(-5.5, 0); drawBoot(5.5, 0);
    ctx.restore();

    // корпус чуть наклоняется в поворот
    const hipY = -28 + c * 8, kneeY = -15 + c * 3, shY = hipY - 17 + c * 2;
    ctx.save(); ctx.translate(lean, 0);
    const kx = 6.5 + c * 2.5;
    limb(-4.5, hipY, -kx - lean * 0.2, kneeY, alx - lean, aly - 6, 7, R.pants, 'rgba(255,255,255,.12)');
    limb(4.5, hipY, kx - lean * 0.2, kneeY, arx - lean, ary - 6, 7, R.pants, 'rgba(255,255,255,.08)');
    ctx.rotate(-th * 0.25);
    drawTorso(hipY, shY, R, lean);

    // руки и палки; внутренняя палка «втыкается» в повороте
    const plantL = pose.plant && pose.plant.side < 0 ? Math.sin(pose.plant.t / 0.3 * Math.PI) : 0;
    const plantR = pose.plant && pose.plant.side > 0 ? Math.sin(pose.plant.t / 0.3 * Math.PI) : 0;
    const handY = hipY - 2 + c * 1.5;
    const grab = pose.grab;
    const hl = grab ? [-5, 10] : [-13.5, handY + plantL * 2];
    const hr = [13.5, handY + plantR * 2];
    if (!pose.noGear) {
      drawPole(hl[0], hl[1], -18 - plantL * 1, 9 + plantL * 10);
      drawPole(hr[0], hr[1], 18 + plantR * 1, 9 + plantR * 10);
    }
    limb(-9.5, shY + 3, -13.5, shY + 10, hl[0], hl[1], 5.2, R.jacket, 'rgba(255,255,255,.2)');
    limb(9.5, shY + 3, 13.5, shY + 10, hr[0], hr[1], 5.2, R.jacketDark);
    for (const [gx, gy] of [hl, hr]) {
      ctx.fillStyle = '#18181c'; ctx.beginPath(); ctx.arc(gx, gy, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(gx - 0.8, gy - 0.9, 1, 0, Math.PI * 2); ctx.fill();
    }
    // голова
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.ellipse(0, shY - 4, 3.6, 3, 0, 0, Math.PI * 2); ctx.fill();
    drawHelmet(0, shY - 11.5, 0.66, P.shield ? '#f4f5f7' : '#1b1c21', P.shield ? '#5dff3a' : R.accent, P.angle);
    ctx.restore();
  }

  function drawBoarder(pose) {
    const R = RIDERS.board;
    const th = P.angle * 0.55;
    const c = pose.crouch, lean = P.angle * 3;
    // доска поперёк движения
    ctx.save(); ctx.rotate(-th);
    const edgeTilt = 1 - Math.abs(P.angle) * 0.25;
    ctx.scale(1, edgeTilt);
    const bg = ctx.createLinearGradient(0, -6, 0, 6);
    bg.addColorStop(0, '#fafafa'); bg.addColorStop(0.3, R.board); bg.addColorStop(1, '#0b0b0d');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(-28, -6, 56, 12, 6); ctx.fill();
    ctx.fillStyle = R.accent;
    ctx.beginPath(); ctx.moveTo(-18, -6); ctx.lineTo(-10, -6); ctx.lineTo(-16, 6); ctx.lineTo(-24, 6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(14, -6); ctx.lineTo(18, -6); ctx.lineTo(12, 6); ctx.lineTo(8, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '800 3.6px Manrope, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('COULAIR', 2, 1.3);
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.roundRect(-28, -6, 56, 12, 6); ctx.stroke();
    // крепления: хайбэк, база, стрепы
    for (const bx of [-11, 11]) {
      ctx.fillStyle = '#1c1d22'; ctx.beginPath(); ctx.roundRect(bx - 4.5, -7.5, 9, 3.5, 1.5); ctx.fill();   // хайбэк
      ctx.fillStyle = '#2d2f36'; ctx.beginPath(); ctx.roundRect(bx - 4, -4.5, 8, 9, 2); ctx.fill();
    }
    ctx.restore();
    const b1 = [-11 * Math.cos(-th), -11 * Math.sin(-th)], b2 = [11 * Math.cos(-th), 11 * Math.sin(-th)];
    for (const [bx, by] of [b1, b2]) drawBoot(bx, by + 1.5);
    ctx.save(); ctx.rotate(-th);
    for (const bx of [-11, 11]) { ctx.fillStyle = R.accent; ctx.fillRect(bx - 4.2, -2.5, 8.4, 1.4); ctx.fillRect(bx - 4.2, 1.8, 8.4, 1.4); }
    ctx.restore();

    const hipY = -27 + c * 8, kneeY = -14 + c * 3, shY = hipY - 17 + c * 2;
    ctx.save(); ctx.translate(lean, 0);
    limb(-4.5, hipY, b1[0] - 3 - lean, kneeY, b1[0] - lean, b1[1] - 6, 7, R.pants, 'rgba(255,255,255,.12)');
    limb(4.5, hipY, b2[0] + 3 - lean, kneeY, b2[0] - lean, b2[1] - 6, 7, R.pants, 'rgba(255,255,255,.08)');
    ctx.rotate(-th * 0.35);
    drawTorso(hipY, shY, R, lean);
    // руки в стороны для баланса, качаются
    const sway = Math.sin(clock * 3.2) * 1.5;
    const grab = pose.grab;
    const hl = grab ? [-3, 2] : [-21, shY + 10 - P.angle * 6 + sway];
    const hr = [21, shY + 10 + P.angle * 6 - sway];
    limb(-9.5, shY + 3, -16, shY + 6 - P.angle * 3, hl[0], hl[1], 5.2, R.jacket, 'rgba(255,255,255,.2)');
    limb(9.5, shY + 3, 16, shY + 6 + P.angle * 3, hr[0], hr[1], 5.2, R.jacketDark);
    for (const [gx, gy] of [hl, hr]) {
      ctx.fillStyle = '#18181c'; ctx.beginPath(); ctx.arc(gx, gy, 2.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.ellipse(0, shY - 4, 3.6, 3, 0, 0, Math.PI * 2); ctx.fill();
    drawHelmet(0, shY - 11.5, 0.66, P.shield ? '#f4f5f7' : '#1b1c21', R.accent, P.angle);
    ctx.restore();
  }

  function drawPlayer() {
    const [sx, sy0] = toScreen(P.x, P.y);
    if (P.inv > 0 && Math.floor(P.inv * 12) % 2) return;       // мигание после удара
    const lift = P.z * 0.45;
    const sy = sy0 - lift;
    shadow(sx + 5 + lift * 0.3, sy0 + 4, 20 - Math.min(10, P.z / 16), 6.5, 0.28);

    ctx.save();
    ctx.translate(sx, sy);
    const pose = { crouch: P.crouch, plant: P.plant, grab: P.air && P.trick && P.z > 40, noGear: false };
    if (P.crash) {
      const k = Math.min(P.crash / 0.7, 1);
      ctx.rotate(k * Math.PI * 1.5);                            // кувырок и падение на бок
      ctx.translate(0, k * 6);
      pose.noGear = rider === 'ski';
      pose.crouch = 0.9;
    } else if (P.spin) ctx.rotate(P.spin);
    ctx.scale(1.12, 1.12);
    if (rider === 'ski') drawSkier(pose); else drawBoarder(pose);
    ctx.restore();
  }

  // разлетевшееся снаряжение после падения
  function drawDebris(d) {
    const [sx, sy0] = toScreen(d.x, d.y);
    const sy = sy0 - d.z * 0.45;
    shadow(sx + 3, sy0 + 1, d.kind === 'ski' ? 16 : 10, 3, 0.18);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(d.rot);
    if (d.kind === 'ski') { ctx.translate(0, -4); drawSki(0, RIDERS.ski.ski, RIDERS.ski.accent); }
    else drawPole(0, -14, 0, 14);
    ctx.restore();
  }

  /* ---------------- цикл ---------------- */
  function frame(t) {
    const dt = last ? Math.min((t - last) / 1000, 0.04) : 0.016;
    last = t;
    clock += dt;
    if (state !== 'start') update(dt);
    else { P.y += 60 * dt; cam.x = P.x; P.angle = Math.sin(t / 900) * 0.5; P.x += P.angle * 40 * dt; while (spawnY < P.y + H * 1.2) spawnRow(); objects = objects.filter(o => o.y > P.y - H * 0.6); }
    draw();
    raf = requestAnimationFrame(frame);
  }

  function open() {
    if (!root) build();
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    resize();
    showScreen('start');
    last = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    setTimeout(() => root.querySelector('[data-game-start]').focus(), 50);
  }

  function close() {
    root.hidden = true;
    cancelAnimationFrame(raf);
    state = 'start';
    document.body.style.overflow = '';
    const btn = document.getElementById('gameBtn');
    if (btn) btn.focus();
  }

  window.CoulairGame = { open, close };
})();
