/* =====================================================================
   Coulair Run — мини-игра: спуск на лыжах или сноуборде.
   Грузится только по нажатию кнопки «Мини-игра» (см. initGame в main.js).
   ===================================================================== */
(() => {
  const BEST_KEY = 'coulair-run-best';
  const RIDERS = {
    ski: {
      name: 'Лыжник', jacket: '#d9352b', accent: '#ffd23f',
      tricks: ['Мьют-грэб', 'Флэт-360', 'Спиннер', 'Рэйли', 'Бэкфлип', 'Мисти 720'],
    },
    board: {
      name: 'Сноубордист', jacket: '#16161a', accent: '#5dff3a',
      tricks: ['Инди-грэб', 'Мелон', 'Фронт 360', 'Бэкфлип', 'Мэтод', 'Кэб 540'],
    },
  };
  const TYPES = [                       // вес при генерации трассы
    ['tree', 44], ['rock', 18], ['flake', 18], ['gate', 8], ['ramp', 7], ['helmet', 3], ['stump', 6],
  ];

  let root, canvas, ctx, W = 0, H = 0, dpr = 1;
  let state = 'start', rider = 'ski', raf = 0, last = 0;
  let P, objects, tracks, particles, texts, cam, spawnY, score, bonus, best, shake, keys, overTimer;

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
    css.href = new URL('css/game.css', document.baseURI).href;
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
    P = { x: 0, y: 0, z: 0, vz: 0, angle: 0, speed: 240, shield: false, inv: 0, crash: 0, spin: 0, air: false, trick: null };
    objects = []; tracks = []; particles = []; texts = [];
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

  function toScreen(x, y) {
    return [x - cam.x + W / 2, y - P.y + PLAYER_Y()];
  }

  function draw() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (shake) ctx.translate(rand(-shake, shake) * 0.4, rand(-shake, shake) * 0.4);

    // снег с лёгкими бороздами от ратраков
    ctx.fillStyle = '#f5f8fc';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.strokeStyle = 'rgba(160, 180, 210, .12)';
    ctx.lineWidth = 1;
    const off = (P.y * 0.999) % 22;
    for (let y = -off; y < H; y += 22) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + 6); ctx.stroke();
    }

    // следы
    drawTracks();

    // объекты и райдер — по глубине, чтобы ёлки перекрывали правильно
    const list = objects.map(o => ({ y: o.y, o }));
    list.push({ y: P.y, player: true });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      if (it.player) drawPlayer();
      else drawObject(it.o);
    }

    // частицы снега
    ctx.fillStyle = '#fff';
    for (const p of particles) {
      const [sx, sy] = toScreen(p.x, p.y);
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.beginPath(); ctx.arc(sx, sy, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(150,170,200,.35)'; ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // всплывающие надписи
    ctx.textAlign = 'center';
    ctx.font = '800 16px Manrope, system-ui, sans-serif';
    for (const t of texts) {
      const [sx, sy] = toScreen(t.x, t.y);
      ctx.globalAlpha = 1 - t.t / 1.1;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sx, sy - t.t * 40);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawTracks() {
    ctx.strokeStyle = 'rgba(150, 170, 200, .45)';
    ctx.lineCap = 'round';
    const lines = rider === 'ski' ? [-4, 4] : [0];
    ctx.lineWidth = rider === 'ski' ? 1.6 : 5;
    for (const off of lines) {
      ctx.beginPath();
      let pen = false;
      for (const t of tracks) {
        if (!t) { pen = false; continue; }
        const [sx, sy] = toScreen(t.x + off * Math.cos(t.a * 0.6), t.y);
        if (!pen) { ctx.moveTo(sx, sy); pen = true; } else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }

  function shadow(sx, sy, rx, ry, a = 0.18) {
    ctx.fillStyle = `rgba(60, 80, 110, ${a})`;
    ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawObject(o) {
    const [sx, sy] = toScreen(o.x, o.y);
    if (sy < -120 || sy > H + 140 || sx < -80 || sx > W + 80) return;
    switch (o.type) {
      case 'tree': {
        shadow(sx + 6, sy + 2, 20, 7);
        ctx.fillStyle = '#5b3a24';
        ctx.fillRect(sx - 3, sy - 12, 6, 13);
        const h = o.h, layers = 3;
        for (let i = 0; i < layers; i++) {
          const top = sy - h + i * h * 0.24, base = sy - 8 - (layers - 1 - i) * h * 0.14;
          const half = 13 + i * 6;
          ctx.fillStyle = i % 2 ? '#1f5e3a' : '#256b43';
          ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx - half, base); ctx.lineTo(sx + half, base); ctx.closePath(); ctx.fill();
          // снег на лапах
          ctx.fillStyle = 'rgba(255,255,255,.85)';
          ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx - half * 0.45, top + (base - top) * 0.45); ctx.lineTo(sx + half * 0.3, top + (base - top) * 0.4); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'rock': {
        shadow(sx + 3, sy + 3, o.w * 0.6, 6);
        ctx.fillStyle = '#7d828c';
        ctx.beginPath(); ctx.ellipse(sx, sy - 5, o.w / 2, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9aa0aa';
        ctx.beginPath(); ctx.ellipse(sx - 4, sy - 8, o.w / 3, 6, -0.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(sx - 2, sy - 12, o.w / 3.2, 4, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'stump': {
        shadow(sx + 2, sy + 2, 11, 4);
        ctx.fillStyle = '#6b4428'; ctx.fillRect(sx - 8, sy - 10, 16, 10);
        ctx.fillStyle = '#c9a57c'; ctx.beginPath(); ctx.ellipse(sx, sy - 10, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(sx - 1, sy - 11, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'ramp': {
        shadow(sx, sy + 4, o.w / 2 + 4, 8, 0.14);
        const g = ctx.createLinearGradient(0, sy - 20, 0, sy + 6);
        g.addColorStop(0, '#dfe9f6'); g.addColorStop(1, '#b8cbe4');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(sx - o.w / 2 + 8, sy - 18); ctx.lineTo(sx + o.w / 2 - 8, sy - 18);
        ctx.lineTo(sx + o.w / 2, sy + 6); ctx.lineTo(sx - o.w / 2, sy + 6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx - o.w / 2 + 8, sy - 18); ctx.lineTo(sx + o.w / 2 - 8, sy - 18); ctx.stroke();
        break;
      }
      case 'pole': {
        shadow(sx + 3, sy + 1, 5, 2);
        ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 30); ctx.stroke();
        ctx.fillStyle = o.color;
        ctx.beginPath(); ctx.moveTo(sx, sy - 30); ctx.lineTo(sx + (o.color === '#d9352b' ? 14 : -14), sy - 25); ctx.lineTo(sx, sy - 20); ctx.closePath(); ctx.fill();
        break;
      }
      case 'flake': {
        o.rot += 0.03;
        ctx.save(); ctx.translate(sx, sy - 10); ctx.rotate(o.rot);
        ctx.strokeStyle = '#5aa7ff'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          ctx.rotate(Math.PI / 3);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -10);
          ctx.moveTo(0, -6); ctx.lineTo(-3, -9); ctx.moveTo(0, -6); ctx.lineTo(3, -9); ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'helmet': {
        o.bob += 0.06;
        const by = sy - 14 + Math.sin(o.bob) * 3;
        shadow(sx, sy + 2, 12, 4, 0.12);
        ctx.fillStyle = 'rgba(93, 255, 58, .22)';
        ctx.beginPath(); ctx.arc(sx, by, 20, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#16161a';
        ctx.beginPath(); ctx.arc(sx, by + 3, 12, Math.PI, 0); ctx.lineTo(sx + 12, by + 6); ctx.lineTo(sx - 12, by + 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5dff3a'; ctx.fillRect(sx - 12, by + 3, 24, 3);
        break;
      }
    }
  }

  function drawPlayer() {
    const [sx, sy0] = toScreen(P.x, P.y);
    const R = RIDERS[rider];
    if (P.inv > 0 && Math.floor(P.inv * 10) % 2) return;       // мигание после удара
    const lift = P.z * 0.45;
    const sy = sy0 - lift;
    shadow(sx + lift * 0.25, sy0 + 3, 14 - Math.min(8, P.z / 20), 5, 0.2);

    ctx.save();
    ctx.translate(sx, sy);
    if (P.crash) ctx.rotate(Math.min(P.crash, 0.8) * 5);      // кувырок при падении
    else if (P.spin) ctx.rotate(P.spin);
    const a = P.angle * 0.7;

    if (rider === 'ski') {
      // лыжи
      ctx.strokeStyle = '#16161a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const off of [-5, 5]) {
        ctx.save(); ctx.translate(off, 2); ctx.rotate(-a);
        ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 16); ctx.stroke();
        ctx.restore();
      }
      // палки
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-9, -8); ctx.lineTo(-13 - a * 4, 10); ctx.moveTo(9, -8); ctx.lineTo(13 - a * 4, 10); ctx.stroke();
    } else {
      // доска поперёк движения, чуть доворачивается в повороте
      ctx.save(); ctx.rotate(Math.PI / 2 - a * 0.6);
      ctx.fillStyle = R.accent;
      ctx.beginPath(); ctx.roundRect(-4.5, -18, 9, 36, 4.5); ctx.fill();
      ctx.fillStyle = '#16161a'; ctx.fillRect(-4.5, -6, 9, 3); ctx.fillRect(-4.5, 4, 9, 3);
      ctx.restore();
    }
    // тело
    ctx.fillStyle = '#2a2a30';
    ctx.beginPath(); ctx.roundRect(-6, -6, 12, 9, 3); ctx.fill();                  // штаны
    ctx.fillStyle = R.jacket;
    ctx.beginPath(); ctx.roundRect(-8, -17, 16, 13, 5); ctx.fill();                // куртка
    ctx.fillStyle = R.accent; ctx.fillRect(-8, -11, 16, 2);
    if (rider === 'board') {                                                        // руки в стороны для баланса
      ctx.strokeStyle = R.jacket; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-7, -13); ctx.lineTo(-15, -9 + a * 5); ctx.moveTo(7, -13); ctx.lineTo(15, -9 - a * 5); ctx.stroke();
    }
    // шлем и маска
    ctx.fillStyle = P.shield ? '#5dff3a' : '#16161a';
    ctx.beginPath(); ctx.arc(0, -21, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(-5, -21, 10, 3);
    ctx.restore();
  }

  /* ---------------- цикл ---------------- */
  function frame(t) {
    const dt = last ? Math.min((t - last) / 1000, 0.04) : 0.016;
    last = t;
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
