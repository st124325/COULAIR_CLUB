/* =====================================================================
   Coulair Run — мини-игра: спуск на лыжах или сноуборде.
   Грузится только по нажатию кнопки «Мини-игра» (см. initGame в main.js).
   ===================================================================== */
(() => {
  const V = (() => { try { return new URL(document.currentScript.src).searchParams.get('v') || ''; } catch { return ''; } })();
  const BEST_KEY = 'coulair-run-best';
  const MODE_KEY = 'coulair-run-mode';
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
  // автотрасса поперёк склона: перелететь можно только с большого трамплина
  const ROAD = { first: 4500, gapMin: 9000, gapMax: 14000, w: 150, clearBefore: 1150, clearAfter: 300, rampBefore: 150 };
  const VEHICLES = {
    car:   { len: 56,  wid: 24, h: 45,  speed: [300, 420], name: 'Сбила легковушка!' },
    suv:   { len: 62,  wid: 27, h: 58,  speed: [280, 380], name: 'Сбил внедорожник!' },
    truck: { len: 205, wid: 32, h: 115, speed: [220, 300], name: 'Сбил грузовик!' },
    bus:   { len: 150, wid: 32, h: 100, speed: [230, 300], name: 'Сбил автобус!' },
  };
  const TYPES = [                       // вес при генерации трассы
    ['tree', 44], ['rock', 18], ['flake', 18], ['gate', 8], ['ramp', 7], ['helmet', 3], ['stump', 6]
  ];
  // крутые участки («чёрная трасса»): каждые 3000 ед. (300 м) — стенка; совпадает с рельефом 3D (PITCH_LEN в game3d.js)
  const PITCH = { len: 3000, from: 0.58, to: 0.78, boost: 0.6 };
  // место для трассы: разгон к трамплину (~1400 ед.) — на ровном после крутяка, сама трасса — до следующего
  const ROAD_WIN = [0.36, 0.45];                                  // доли периода PITCH.len
  const roadSpot = y => {
    const L = PITCH.len, base = Math.floor(y / L) * L, f = (y - base) / L;
    if (f >= ROAD_WIN[0] && f <= ROAD_WIN[1]) return y;
    const at = ROAD_WIN[0] + Math.random() * (ROAD_WIN[1] - ROAD_WIN[0]);
    return (f < ROAD_WIN[0] ? base : base + L) + at * L;
  };
  const pitchF = y => { const t = y / PITCH.len; return t - Math.floor(t); };
  // крутизна 0…1 (пик в середине стенки)
  const steepness = y => { const f = pitchF(y); if (f < PITCH.from || f > PITCH.to) return 0; const u = (f - PITCH.from) / (PITCH.to - PITCH.from); return 4 * u * (1 - u); };
  // трюки в воздухе
  const TRICK = { spinRate: 9.5, flipRate: 7.5, spinTol: 1.1, flipTol: 1.2 };   // допуск при приземлении ~63° и ~69°
  // связки с трамплина: → / ← в прыжке — персонаж сам докручивает трюк к приземлению.
  // rot — вращение (в оборотах по 180°), flip — сальто (в полных оборотах), tilt — наклон оси (корк/родео)
  const COMBOS = {
    board: {
      1: [{ name: 'Фронтсайд Корк 720', rot: 4, flip: 1, grab: 'Мелон', pts: 1200 }, { name: 'Фронт 360', rot: 2, flip: 0, grab: 'Инди-грэб', pts: 420 }],
      '-1': [{ name: 'Бэксайд Родео 540', rot: -3, flip: 1, grab: 'Мэтод', pts: 1000 }, { name: 'Бэксайд 180', rot: -1, flip: 0, grab: 'Мэтод', pts: 260 }],
    },
    ski: {
      1: [{ name: 'Корк 720', rot: 4, flip: 1, grab: 'Сэйфти-грэб', pts: 1200 }, { name: 'Флэт 360', rot: 2, flip: 0, grab: 'Мьют-грэб', pts: 420 }],
      '-1': [{ name: 'Мисти 720', rot: -4, flip: 1, grab: 'Тейл-грэб', pts: 1250 }, { name: 'Спиннер 360', rot: -2, flip: 0, grab: 'Тейл-грэб', pts: 420 }],
    },
  };
  const GRABS = { ski: ['Мьют-грэб', 'Сэйфти-грэб', 'Тейл-грэб'], board: ['Инди-грэб', 'Мелон', 'Мэтод'] };

  let root, canvas, ctx, W = 0, H = 0, dpr = 1;
  let state = 'start', rider = 'ski', raf = 0, last = 0;
  let lastCrest = -1, mirror2d = false;
  let cine = null;                       // идущая кат-сцена: { kind: 'crash', t, dur, slow, zoom, … }
  let P, objects, tracks, particles, texts, debris = [], cam, spawnY, score, bonus, best, shake, keys, overTimer, nextRoadY;
  // графика: '2d' — canvas, '3d' — Three.js (js/game3d.js грузится только при первом включении)
  let mode = '2d', R3D = null, loading3D = null, toastTimer = 0;

  const load = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
  const save = v => { try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* приватный режим */ } };
  const loadMode = () => { try { return localStorage.getItem(MODE_KEY) === '3d' ? '3d' : '2d'; } catch { return '2d'; } };
  const saveMode = v => { try { localStorage.setItem(MODE_KEY, v); } catch { /* приватный режим */ } };
  const is3D = () => mode === '3d' && R3D;
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
      <p class="game__warn" data-hud="warn" hidden></p>
      <div class="game__cine" data-cine hidden aria-live="polite">
        <div class="game__vignette"></div>
        <div class="game__bar game__bar--top"></div>
        <div class="game__bar game__bar--bottom"></div>
        <div class="game__flash" data-cine-flash></div>
        <p class="game__boom" data-cine-word></p>
        <div class="game__caption" data-cine-caption>
          <strong data-cine-title></strong>
          <span data-cine-sub></span>
        </div>
        <p class="game__skip">Нажми, чтобы пропустить</p>
      </div>
      <div class="game__view game__view--hud" role="group" aria-label="Графика">
        <button data-mode="2d" aria-pressed="true">2D</button><button data-mode="3d" aria-pressed="false">3D</button>
      </div>
      <p class="game__toast" data-game-toast hidden></p>
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
        <div class="game__view game__view--panel" role="group" aria-label="Графика">
          <span class="game__label">Графика</span>
          <button data-mode="2d" aria-pressed="true">2D</button><button data-mode="3d" aria-pressed="false">3D</button>
        </div>
        <button class="game__start" data-game-start>Поехали</button>
        <p class="game__credits">3D: сноубордист — <a href="https://sketchfab.com/3d-models/b8a85b8427c64d098ca598188baca93c" target="_blank" rel="noopener">onirix</a> (CC BY 4.0) · лыжница — <a href="https://sketchfab.com/3d-models/52aabb1e0773487b93a6e56d0f0b875b" target="_blank" rel="noopener">lancehuang526</a> (CC BY 4.0)</p>
        <p class="game__keys">← → — поворот · пробел — прыжок<br>В воздухе: ← → — вращение · держи пробел — сальто · ↓ — грэб<br>Сноуборд: ↓ на земле — реверт, 180° в воздухе — едешь свитчем<br>V — 2D/3D · Esc — выход</p>
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
        <button data-touch="grab" aria-label="Грэб">✊</button>
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
      const m = e.target.closest('[data-mode]');
      if (m) { setMode(m.dataset.mode); m.blur(); }            // без фокуса: пробел — прыжок, а не повторное нажатие
      if (r) r.blur();
    });

    // сенсорные кнопки: держишь — едешь в сторону
    root.querySelectorAll('[data-touch]').forEach(btn => {
      const k = btn.dataset.touch;
      const on = e => {
        e.preventDefault();
        if (k === 'jump') { if (state === 'play' && P.air) keys.flip = true; else jump(); }
        else keys[k] = true;
        btn.classList.add('is-down');
      };
      const off = e => {
        e.preventDefault();
        if (k === 'jump') keys.flip = false;
        else { keys[k] = false; if (k === 'left') P.staleL = false; if (k === 'right') P.staleR = false; }
        btn.classList.remove('is-down');
      };
      btn.addEventListener('pointerdown', e => { on(e); btn.setPointerCapture?.(e.pointerId); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    });

    // долгое нажатие и двойной тап не выделяют текст и не открывают меню «копировать»
    root.addEventListener('pointerdown', e => { if (cine && cine.t > 0.4 && !e.target.closest('[data-game-close]')) endCine(); });
    root.addEventListener('contextmenu', e => e.preventDefault());
    root.addEventListener('selectstart', e => e.preventDefault());
    root.addEventListener('dblclick', e => e.preventDefault());

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    // размеры пересчитываются, когда подгрузились стили игры, при повороте телефона и т.п.
    new ResizeObserver(() => { if (!root.hidden) resize(); }).observe(root);
    document.addEventListener('visibilitychange', () => { if (document.hidden) last = 0; });
    setRider(rider);
    setMode(loadMode(), true);
  }

  /* ---------------- 2D / 3D ---------------- */
  function setMode(m, quiet) {
    if (m === '3d' && !R3D) {
      markMode('3d', true);
      load3D().then(() => { if (mode === '3d') apply('3d'); })
        .catch(err => {
          console.warn('Coulair Run 3D:', err);
          apply('2d');
          if (!quiet) toast('3D не запустилось на этом устройстве — играем в 2D');
        });
      mode = '3d';
      return;
    }
    apply(m);
  }

  function apply(m) {
    mode = m;
    saveMode(m);
    markMode(m, false);
    const on = is3D();
    canvas.hidden = on;
    if (R3D) R3D.canvas.hidden = !on;
    root.classList.toggle('game--3d', !!on);
    if (on && !root.hidden) R3D.resize(root.clientWidth || window.innerWidth, root.clientHeight || window.innerHeight);
  }

  function markMode(m, busy) {
    root.querySelectorAll('[data-mode]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.mode === m));
      b.classList.toggle('is-loading', busy && b.dataset.mode === '3d');
    });
  }

  function load3D() {
    if (!loading3D) {
      const url = new URL('js/game3d.js' + (V ? '?v=' + V : ''), document.baseURI).href;
      loading3D = import(url)
        .then(mod => { R3D = mod.create(root, canvas); })
        .catch(err => { loading3D = null; throw err; });
    }
    return loading3D;
  }

  function toast(text) {
    const el = root.querySelector('[data-game-toast]');
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function setRider(r) {
    rider = r;
    root.querySelectorAll('[data-rider]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.rider === r)));
    root.querySelector('[data-touch="grab"]').hidden = r === 'ski';   // у лыжника кнопки грэба нет
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
    if (cine && down) { e.preventDefault(); if (cine.t > 0.4) endCine(); return; }
    if (down && !e.repeat && (k === 'v' || k === 'V' || k === 'м' || k === 'М')) { setMode(mode === '3d' ? '2d' : '3d'); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'd', 'w', 's', 'ф', 'в', 'ц', 'ы'].includes(k)) e.preventDefault();
    if (k === 'ArrowLeft' || k === 'a' || k === 'ф') { keys.left = down; if (!down && P) P.staleL = false; }
    if (k === 'ArrowRight' || k === 'd' || k === 'в') { keys.right = down; if (!down && P) P.staleR = false; }
    if (k === 'ArrowDown' || k === 's' || k === 'ы') keys.grab = down;
    const jumpKey = k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'ц';
    if (jumpKey && !down) keys.flip = false;
    if (down && jumpKey) {
      if (state === 'play' && P.air && !e.repeat) keys.flip = true;          // в воздухе держишь — сальто
      else if (state === 'play') jump();
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
    if (is3D()) R3D.resize(cw, ch);
  }

  // в 3D видно далеко вперёд и в стороны — трасса генерируется с запасом (плотность та же)
  const ahead = () => (is3D() ? Math.max(H * 1.2, 2800) : H * 1.2);
  const spanX = () => (is3D() ? Math.max(W * 0.75, 1100) : W * 0.75);

  /* ---------------- игра ---------------- */
  function reset() {
    P = { x: 0, y: 0, z: 0, vz: 0, angle: 0, speed: 240, shield: false, inv: 0, crash: 0, spin: 0, air: false, trick: null,
          crouch: 0.3, plant: null, plantCD: 0,
          rot: 0, flip: 0, grabT: 0, grabbing: false, manual: false, staleL: false, staleR: false, boost: 1, steepT: 0,
          stance: 1, stanceVis: 0, revertLatch: false, takeoffStance: 1, combo: null };
    objects = []; tracks = []; particles = []; texts = []; debris = [];
    lastCrest = -1;
    cam = { x: 0 }; spawnY = 200; score = 0; bonus = 0; shake = 0; nextRoadY = roadSpot(ROAD.first);
    keys = { left: false, right: false, flip: false, grab: false };
    best = load();
    // стартовая поляна без препятствий + пара снежинок, чтобы сразу понять, что собирать
    objects.push({ type: 'flake', x: 0, y: 320, r: 16, rot: 0 }, { type: 'flake', x: 40, y: 420, r: 16, rot: 0 });
    spawnY = 520;
    hud();
  }

  function start() {
    if (cine) { cine = null; root.classList.remove('is-cine'); cineEl('[data-cine]').hidden = true; }
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
    setTimeout(() => { if (state === 'over' && !cine) showScreen('over'); }, 700);
    hud();
  }

  /* ---------------- кат-сцены ---------------- */
  const QUIPS = {
    tree: ['Ёлка победила по очкам', 'Это была не ёлка, это была судьба', 'Зато шапка снега бесплатно'],
    crash: ['Лыжи — отдельно, райдер — отдельно', 'Склон 1 : 0 Райдер', 'Инструктор такого не показывал', 'Главное — красиво упасть'],
    board: ['Доска цела. Самолюбие — не очень', 'Склон 1 : 0 Райдер', 'Главное — красиво упасть'],
  };
  function cineEl(sel) { return root.querySelector(sel); }
  function startCine(kind, opts = {}) {
    cine = {
      kind, t: 0, dur: 3.8, slow: 0, zoom: 1, pan: 0,
      focus: opts.focus || { x: P.x, y: P.y }, stage: '',
      word: opts.word || '', title: opts.title || '', hit: opts.hit || null,
    };
    root.classList.add('is-cine');
    const el = cineEl('[data-cine]');
    el.hidden = false;
    el.classList.remove('is-caption', 'is-boom');
    void el.offsetWidth;
    cineEl('[data-cine-word]').textContent = cine.word;
    cineEl('[data-cine-title]').textContent = cine.title;
    const q = cine.title.includes('ёлк') ? QUIPS.tree : rider === 'board' ? QUIPS.board : QUIPS.crash;
    cineEl('[data-cine-sub]').textContent = `${pick(q)} · ${Math.round(P.y / 10).toLocaleString('ru-RU')} м`;
    if (kind === 'crash') {                              // стоп-кадр со вспышкой и надписью
      el.classList.add('is-flash', 'is-boom');
      setTimeout(() => el.classList.remove('is-flash'), 60);
    }
  }
  function cineCaption(title, sub, boom) {
    const el = cineEl('[data-cine]');
    cineEl('[data-cine-title]').textContent = title;
    cineEl('[data-cine-sub]').textContent = sub;
    el.classList.add('is-caption');
    if (boom !== undefined) {
      cineEl('[data-cine-word]').textContent = boom;
      el.classList.remove('is-boom'); void el.offsetWidth; el.classList.add('is-boom');
    }
  }
  function endCine() {
    if (!cine) return;
    cine = null;
    root.classList.remove('is-cine');
    const el = cineEl('[data-cine]');
    el.hidden = true; el.classList.remove('is-caption', 'is-boom', 'is-flash');
    if (state === 'over') showScreen('over');
  }
  function updateCine(dt) {
    const c = cine;
    c.t += dt;
    let zoomT = 1;
    if (c.kind === 'crash') {
      // стоп-кадр → замедленный кувырок → лежит, звёздочки над головой
      c.slow = c.t < 0.18 ? 0 : c.t < 2.1 ? 0.28 : 1;
      zoomT = c.t < 2.4 ? 2.15 : 1.85;
      if (c.t > 0.5 && c.stage !== 'title') { c.stage = 'title'; cineEl('[data-cine]').classList.add('is-caption'); }
      c.focus.x += (P.x - c.focus.x) * Math.min(1, 2 * dt);
      c.focus.y += (P.y - c.focus.y) * Math.min(1, 2 * dt);
    }
    c.zoom += (zoomT - c.zoom) * Math.min(1, 2.6 * dt);
    c.pan += (1 - c.pan) * Math.min(1, 3 * dt);
    if (c.t > c.dur) endCine();
  }

  function jump() {
    if (state !== 'play' || P.z > 0 || P.crash) return;
    P.vz = 300; P.air = true; P.trick = null;
    takeoff(false);
  }

  function takeoff(fromRamp) {
    P.staleL = keys.left; P.staleR = keys.right;         // стрелки, зажатые для поворота, трюк не начинают
    keys.flip = false;
    P.rot = 0; P.flip = 0; P.grabT = 0; P.grabbing = false; P.manual = false; P.spin = 0; P.combo = null;
    P.fromRamp = fromRamp;
    P.takeoffStance = P.stance;
  }

  // оставшееся время полёта (та же гравитация 900, что в прыжке)
  const airLeft = () => (P.vz + Math.sqrt(Math.max(0, P.vz * P.vz + 2 * 900 * P.z))) / 900;

  function startCombo(dir) {
    const T = airLeft();
    const list = COMBOS[rider][dir];
    const c = T > 0.95 ? list[0] : T > 0.45 ? list[1] : null;          // на коротком прыжке — связка попроще
    if (!c) return;
    P.combo = { ...c, dir, t: 0, T: T * 0.86 };                          // докручивает чуть раньше приземления
    P.manual = true; P.spin = 0;
    if (P.trick) P.trick.manual = true; else P.trick = { name: '', points: 0, spinRate: 0, manual: true };
    addText(`${c.name}!`, P.x, P.y - 85, '#6d28d9');
  }

  function runCombo(dt) {
    const c = P.combo;
    c.t = Math.min(c.T, c.t + dt);
    const u = c.t / c.T, e = u * u * (3 - 2 * u);                         // разгон и торможение вращения
    P.rot = c.rot * Math.PI * e;
    // сальто в середине полёта (корк/родео — ось завалена), к приземлению снова ровно
    const fu = Math.min(1, Math.max(0, (u - 0.15) / 0.7));
    P.flip = c.flip * Math.PI * 2 * fu * fu * (3 - 2 * fu);
    P.grabbing = u > 0.2 && u < 0.8;
    if (P.grabbing) P.grabT += dt;
  }

  const wrapPi = a => { a %= Math.PI * 2; if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2; return a; };

  // приземление после ручных трюков: докрутил — очки, нет — падение
  function landTricks() {
    const board = rider === 'board';
    const unit = board ? Math.PI : Math.PI * 2;                 // доску можно приземлить задом наперёд
    const halves = Math.round(P.rot / unit);
    const spinErr = Math.abs(P.rot - halves * unit);
    if (spinErr > TRICK.spinTol || Math.abs(wrapPi(P.flip)) > TRICK.flipTol) {
      if (P.shield) {
        P.shield = false; P.inv = 1.6; shake = 8;
        addText('Жёстко! Шлем спас', P.x, P.y - 50, '#2d7a3e');
        return;
      }
      crashRoad(Math.abs(wrapPi(P.flip)) > TRICK.flipTol ? 'Не докрутил сальто!' : 'Приземлился боком!');
      return;
    }
    const parts = [];
    let pts = 0;
    const flips = Math.round(Math.abs(P.flip) / (Math.PI * 2));
    if (flips) { parts.push((['', '', 'Дабл ', 'Трипл ', 'Квад '][flips] || `${flips}× `) + 'бэкфлип'); pts += [0, 300, 800, 1500, 2500][flips] || 3000; }
    const deg = Math.abs(halves) * (board ? 180 : 360);
    if (deg) { const k = deg / 180; parts.push(String(deg)); pts += 25 * k * (k + 2); }
    if (board && halves % 2) {                                   // нечётные полуобороты — смена стойки
      P.stance *= -1;
      P.stanceVis += halves * Math.PI;                           // картинка не дёргается: разворот уже сделан в воздухе
      addText(P.stance < 0 ? 'Едешь свитчем' : 'Обычная стойка', P.x, P.y - 32, '#2466d9');
    }
    if (P.grabT > 0.2) {
      const list = GRABS[rider];
      parts.push(list[(Math.abs(Math.round(P.rot)) + flips) % list.length]);
      pts += 60 + Math.round(P.grabT * 120);
    }
    if (P.combo) {                                              // связка засчитывается целиком, со своим грэбом
      parts.length = 0;
      parts.push(P.combo.name + ' + ' + P.combo.grab);
      pts = P.combo.pts;
      P.combo = null;
    }
    if (!parts.length) return;
    if (P.fromRamp) pts += P.fromRamp === 'big' ? 300 : 100;
    if (board && P.takeoffStance < 0) parts.unshift('свитч');     // трюк из свитча — сложнее
    const mult = 1 + 0.5 * (parts.length - 1);
    const total = Math.round((pts * mult) / 10) * 10;
    bonus += total;
    const name = parts.join(' + ');
    addText(`${name[0].toUpperCase()}${name.slice(1)}${mult > 1 ? ` ×${mult}` : ''} +${total}`, P.x, P.y - 55, '#d9352b');
    if (total >= 1000) shake = 5;
  }

  function spawnRow() {
    const difficulty = Math.min(1, P.y / 60000);
    spawnY += rand(46, 92) * (1 - difficulty * 0.45);
    if (spawnY > nextRoadY - ROAD.clearBefore) { spawnRoad(nextRoadY); nextRoadY = roadSpot(nextRoadY + rand(ROAD.gapMin, ROAD.gapMax)); }
    // знаки «чёрная трасса» над каждой стенкой
    const crest = Math.floor(spawnY / PITCH.len) * PITCH.len + PITCH.from * PITCH.len;
    if (spawnY >= crest - 260 && lastCrest !== crest && crest > 600) {
      lastCrest = crest;
      for (const s of [-1, 1]) objects.push({ type: 'steepsign', x: cam.x + s * rand(170, 230), y: crest - 240, r: 6 });
    }
    if (inRoadZone(spawnY)) return;
    const total = TYPES.reduce((s, t) => s + t[1], 0);
    let roll = Math.random() * total, type = 'tree';
    for (const [t, w] of TYPES) { if ((roll -= w) < 0) { type = t; break; } }
    if (type === 'helmet' && P.shield) type = 'flake';
    // на широкой трассе в ряду несколько объектов — плотность одинаковая при любой ширине экрана
    const perRow = Math.max(1, Math.round(spanX() / 315));
    for (let i = 0; i < perRow; i++) spawnOne(i === 0 ? type : null);
  }

  function spawnRoad(y) {
    const rx = cam.x + rand(-110, 110);
    objects.push({ type: 'road', x: 0, y, w: ROAD.w, cars: [], spawnT: 0, passed: false });
    objects.push({ type: 'bigramp', x: rx, y: y - ROAD.w / 2 - ROAD.rampBefore, r: 60, w: 130, lip: 0 });
    // знаки заранее: трасса впереди, трамплин — по стрелке
    for (const [dy, dx] of [[-980, -95], [-980, 95], [-620, -95], [-620, 95]]) {
      objects.push({ type: 'sign', x: rx + dx, y: y + dy, r: 6, dir: Math.sign(dx) });
    }
    // прогреть трассу, чтобы машины уже ехали, когда её станет видно
    const road = objects[objects.length - 6];
    for (let i = 0; i < 40; i++) updateRoad(road, 0.25);
  }

  function inRoadZone(y) {
    for (const o of objects) if (o.type === 'road' && y > o.y - ROAD.clearBefore && y < o.y + o.w / 2 + ROAD.clearAfter) return true;
    return false;
  }

  // машины на трассе: едут в обе стороны по своим полосам
  const CAR_GAP = 28;                                     // минимальный зазор между машинами в полосе
  const carGap = (a, b) => (VEHICLES[a.kind].len + VEHICLES[b.kind].len) / 2 + CAR_GAP;
  // свободно ли место в полосе dir для машины kind в точке x
  const laneFree = (o, dir, kind, x) => o.cars.every(c => c.dir !== dir || Math.abs(c.x - x) > carGap(c, { kind }) + 40);

  function addCar(o, kind, dir, x, color) {
    const V = VEHICLES[kind], sp = rand(V.speed[0], V.speed[1]);
    o.cars.push({ kind, dir, x, lane: dir * 36, speed: sp, cruise: sp, color, wheel: 0 });
  }

  function updateRoad(o, dt) {
    if (Math.abs(o.y - P.y) > 5000) return;
    o.spawnT -= dt;
    if (o.spawnT <= 0) {
      o.spawnT = rand(0.8, 2.0);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const kind = pick(['car', 'car', 'car', 'suv', 'suv', 'truck', 'truck', 'bus']);
      const x = cam.x - dir * 1900;
      if (laneFree(o, dir, kind, x)) addCar(o, kind, dir, x, pick(['#c8102e', '#1d4ed8', '#f4f4f4', '#18181b', '#9ca3af', '#0f766e', '#f59e0b']));
    }
    // в каждой полосе догнавший сбавляет ход до скорости впереди идущего и не въезжает в него
    for (const dir of [1, -1]) {
      const lane = o.cars.filter(c => c.dir === dir).sort((a, b) => (b.x - a.x) * dir);   // первый — самый передний
      for (let i = 0; i < lane.length; i++) {
        const c = lane[i], lead = lane[i - 1];
        let target = c.cruise;
        if (lead) {
          const gap = (lead.x - c.x) * dir - carGap(lead, c);
          if (gap < 120) target = Math.min(c.cruise, lead.speed * (gap < 30 ? 0.9 : 1));
        }
        c.speed += (target - c.speed) * Math.min(1, 3 * dt);
        c.x += dir * c.speed * dt; c.wheel += c.speed * dt;
        if (lead && (lead.x - c.x) * dir < carGap(lead, c)) c.x = lead.x - dir * carGap(lead, c);
      }
    }
    o.cars = o.cars.filter(c => Math.abs(c.x - cam.x) < 2100);
  }

  function spawnOne(forced) {
    let type = forced;
    if (!type) {
      const total = TYPES.reduce((s, t) => s + t[1], 0);
      let roll = Math.random() * total;
      for (const [t, w] of TYPES) { if ((roll -= w) < 0) { type = t; break; } }
      if (type === 'helmet' && P.shield) type = 'flake';
    }
    const gap = type === 'gate' ? rand(80, 120) : 0;
    // ищем свободное место: объекты не должны налезать на трамплин, ворота и друг на друга
    let x, y, tries = 0;
    do {
      x = cam.x + rand(-spanX(), spanX());
      y = spawnY + rand(-20, 20);
    } while (!isFree(x, y, type, gap) && ++tries < 8);
    if (tries >= 8) return;
    if (type === 'ramp') {
      const f = pitchF(y);
      if (f > PITCH.from - 0.06 && f < PITCH.to + 0.04) type = 'flake';   // на стенке трамплин встал бы криво
    }
    switch (type) {
      case 'tree':   objects.push({ type, x, y, r: 11, h: rand(58, 96), sway: Math.random() * 6 }); break;
      case 'rock':   objects.push({ type, x, y, r: 13, w: rand(22, 34) }); break;
      case 'stump':  objects.push({ type, x, y, r: 9 }); break;
      case 'flake':  objects.push({ type, x, y, r: 18, rot: Math.random() * 6 }); break;
      case 'helmet': objects.push({ type, x, y, r: 20, bob: 0 }); break;
      case 'ramp':   objects.push({ type, x, y, r: 26, w: 60 }); break;
      case 'gate': {
        objects.push({ type: 'pole', x: x - gap / 2, y, r: 5, color: '#d9352b' });
        objects.push({ type: 'pole', x: x + gap / 2, y, r: 5, color: '#2466d9' });
        objects.push({ type: 'gate', x, y, gap, done: false });
        break;
      }
    }
  }

  // занимаемая площадь объекта (полуширина по x и y) с запасом для объезда
  function footprint(type, gap, r) {
    if (type === 'ramp') return [44, 50];                   // кикер длинный: разгон, стол и приземление
    if (type === 'bigramp') return [80, 120];
    if (type === 'gate') return [gap / 2 + 14, 16];
    return [r + 6, r + 6];
  }
  const RADIUS = { tree: 11, rock: 17, stump: 9, flake: 18, helmet: 20 };

  function isFree(x, y, type, gap) {
    const [ax, ay] = footprint(type, gap, RADIUS[type] || 12);
    for (const o of objects) {
      if (o.dead || o.type === 'pole' || o.type === 'road' || o.type === 'sign' || o.type === 'steepsign' || Math.abs(o.y - y) > 160) continue;
      const [bx, by] = footprint(o.type, o.gap, o.r);
      if (Math.abs(o.x - x) < ax + bx && Math.abs(o.y - y) < ay + by) return false;
    }
    return true;
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
    const reason = o.type === 'tree' ? 'Врезался в ёлку!' : o.type === 'pole' ? 'Снёс флаг!' : 'Зацепил камень!';
    if (o.type === 'tree') {
      // ёлка трясётся и сбрасывает шапку снега на райдера
      o.shake = 1.4;
      for (let i = 0; i < 34; i++) {
        particles.push({ x: o.x + rand(-16, 16), y: o.y - rand(45, 95), vx: rand(-25, 25), vy: rand(-30, 30), life: rand(2.2, 3.4), t: 0, r: rand(2.5, 5.5), floor: P.y + rand(-4, 8) });
      }
    }
    gameOver(reason);
    startCine('crash', { word: { tree: 'ХРЯСЬ!', rock: 'БДЫЩ!', stump: 'БДЫЩ!', pole: 'ДЗЫНЬ!' }[o.type] || 'БАМ!', title: reason, focus: { x: (P.x + o.x) / 2, y: (P.y + o.y) / 2 }, hit: { x: o.x, y: o.y, type: o.type } });
  }

  // радиус удара — по видимому размеру (ствол и густые нижние лапы, камень, пень, древко)
  const RIDER_R = 6;
  function hitRadius(o) {
    switch (o.type) {
      case 'tree': return 10;
      case 'rock': return o.w * 0.5;
      case 'stump': return 7;
      case 'pole': return 2.5;
      default: return o.r;
    }
  }

  function crashRoad(reason) {
    P.crash = 0.001; shake = 18;
    puff(P.x, P.y, 40, 1.8);
    const gear = rider === 'ski' ? ['ski', 'ski', 'pole', 'pole'] : [];
    for (const kind of gear) {
      debris.push({ kind, x: P.x + rand(-6, 6), y: P.y, z: 6, vx: rand(-260, 260), vy: P.speed * rand(0.2, 0.6), vz: rand(200, 380), rot: rand(0, 6), vr: rand(-18, 18) });
    }
    gameOver(reason);
    startCine('crash', { word: /приземл|сальто/i.test(reason) ? 'ШМЯК!' : 'БАМ!', title: reason });
  }

  function launch(o, big, ollie) {
    const t = big
      ? (is3D() ? 'Двойной бэкфлип' : pick(RIDERS[rider].tricks))
      : (is3D() ? 'Бэкфлип' : pick(RIDERS[rider].tricks));   // в 3D с трамплина — сальто назад
    P.vz = (big ? 720 + P.speed * 0.25 : 520 + P.speed * 0.25) + (ollie ? 110 : 0);
    P.air = true;
    takeoff(big ? 'big' : 'ramp');
    if (ollie) { bonus += 50; addText('Олли с кромки +50', P.x, P.y - 30, '#2466d9'); }
    P.trick = { name: t, points: (big ? 450 : 150) + Math.round(P.speed / 5) * 5, spinRate: rand(9, 14) * (Math.random() < 0.5 ? -1 : 1), big };
    // под райдером в середине полёта проезжает фура — для зрелищности
    const road = big && objects.find(r => r.type === 'road' && r.y > P.y);
    if (road) {
      const vy = P.speed * (1 - 0.38 * Math.abs(P.angle)), t = (road.y - P.y) / vy;
      const V = VEHICLES.truck, sp = (V.speed[0] + V.speed[1]) / 2;
      // только в свободную полосу, чтобы фура не появилась внутри другой машины
      for (const dir of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
        const x = P.x - dir * sp * t;
        if (laneFree(road, dir, 'truck', x)) { addCar(road, 'truck', dir, x, pick(['#c8102e', '#1d4ed8', '#18181b', '#0f766e'])); break; }
      }
    }
  }

  function update(dt) {
    if (state === 'play' && !P.crash) {
      // управление: держишь стрелку — поворачиваешь, отпустил — выравниваешься вниз по склону
      const target = keys.left && !keys.right ? -1 : keys.right && !keys.left ? 1 : 0;
      const turnRate = rider === 'ski' ? 6.5 : 5.2;
      const prevAngle = P.angle;
      if (!P.air) P.angle += (target - P.angle) * Math.min(1, turnRate * dt);
      else {
        // с трамплина: первое нажатие → или ← запускает связку, дальше персонаж крутит её сам
        const tapR = keys.right && !P.staleR, tapL = keys.left && !P.staleL;
        if (P.fromRamp && !P.combo && !P.manual && (tapR || tapL)) startCombo(tapR ? 1 : -1);
        if (P.combo) runCombo(dt);
        // трюки: ← → — вращение, зажатый прыжок — сальто, ↓ — грэб
        const spinIn = P.combo ? 0 : (keys.right && !P.staleR ? 1 : 0) - (keys.left && !P.staleL ? 1 : 0);
        if (!P.combo && (spinIn || keys.flip || keys.grab)) {
          if (!P.manual) {
            P.manual = true; P.spin = 0;
            if (P.trick) P.trick.manual = true;
            else P.trick = { name: '', points: 0, spinRate: 0, manual: true };
          }
          P.rot += spinIn * TRICK.spinRate * dt;
          if (keys.flip) P.flip += TRICK.flipRate * dt;
        }
        if (!P.combo) {
          P.grabbing = keys.grab;
          if (keys.grab) P.grabT += dt;
        }
      }
      // сноуборд: ↓ на земле — реверт, разворот доски на 180° (едешь другим боком)
      if (rider === 'board' && !P.air) {
        if (keys.grab && !P.revertLatch) {
          P.revertLatch = true; P.stance *= -1;
          puff(P.x, P.y + 4, 8, 0.6);
          addText(P.stance < 0 ? 'Реверт · свитч' : 'Реверт', P.x, P.y - 30, '#2466d9');
        }
        if (!keys.grab) P.revertLatch = false;
      }
      {
        const target = P.stance > 0 ? 0 : Math.PI;
        P.stanceVis += wrapPi(target - P.stanceVis) * Math.min(1, 14 * dt);
      }
      const carve = Math.abs(P.angle - prevAngle) / dt;

      const dist = P.y / 10;
      const st = steepness(P.y);
      const boostT = 1 + PITCH.boost * st;
      P.boost += (boostT - P.boost) * Math.min(1, (boostT > P.boost ? 2.5 : 0.7) * dt);   // разгон быстрый, спад плавный
      P.speed = Math.min(700, 240 + dist * 0.45) * P.boost;
      if (st > 0.05) {
        if (!P.steepT && !P.air) addText('◆ Чёрная трасса!', P.x, P.y - 70, '#16161a');
        P.steepT += dt;
      } else if (P.steepT) {
        if (P.steepT > 0.4 && state === 'play') { bonus += 150; addText('Прошёл крутяк +150', P.x, P.y - 60, '#16161a'); }
        P.steepT = 0;
      }
      const brake = 1 - 0.38 * Math.abs(P.angle);
      const vx = P.speed * P.angle * 0.8;
      const vy = P.speed * brake;
      const prevY = P.y;
      P.x += vx * dt;
      P.y += vy * dt;

      // прыжок
      if (P.air) {
        P.vz -= 900 * dt;
        P.z = Math.max(0, P.z + P.vz * dt);
        if (P.trick && !P.manual) P.spin += dt * P.trick.spinRate;
        if (P.z === 0) {
          P.air = false;
          puff(P.x, P.y, 10);
          if (P.manual) {
            landTricks();
            P.trick = null;
          } else if (P.trick) {
            const pts = P.trick.points;
            bonus += pts;
            addText(`${P.trick.name} +${pts}`, P.x, P.y - 50, '#d9352b');
            P.trick = null;
          }
          P.spin = 0; P.rot = 0; P.flip = 0; P.grabbing = false; P.manual = false;
        }
      }
      if (P.inv > 0) P.inv -= dt;

      // поза: присед сильнее в повороте и в воздухе; палка втыкается при заходе в поворот
      const targetCrouch = P.air ? (P.trick || P.grabbing ? 0.95 : 0.65) : 0.25 + 0.5 * Math.abs(P.angle) + Math.sin(clock * 7) * 0.03;
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
      if (!is3D() || rider !== 'ski') P.swayX = 0;
      const PX = P.x + (P.swayX || 0);                          // где реально лыжи (у 3D-лыжницы с петлянием)
      if (!P.air) tracks.push({ x: PX, y: P.y, a: P.angle });
      else tracks.push(null);
      if (tracks.length > 180) tracks.shift();

      // столкновения
      for (const o of objects) {
        if (o.dead) continue;
        const dx = o.x - PX, dy = o.y - P.y;
        // трамплин срабатывает ровно на кромке (o.y), если райдер на его ширине
        if (o.type === 'ramp' || o.type === 'bigramp') {
          const lip = o.y + (o.lip || 0);
          // срабатывает и в невысоком прыжке: залетел на кромку — подбросит ещё выше
          const low = !P.air || (!P.trick && P.z < 45);
          if (low && prevY < lip && P.y >= lip && Math.abs(dx) < (o.type === 'bigramp' ? 62 : 32)) launch(o, o.type === 'bigramp', P.air);
          continue;
        }
        if (o.type === 'road') {
          updateRoad(o, dt);
          const half = o.w / 2;
          if (Math.abs(P.y - o.y) < half + 4) {
            for (const c of o.cars) {
              const V = VEHICLES[c.kind];
              if (P.z < V.h && Math.abs(P.x - c.x) < V.len / 2 + 8 && Math.abs(P.y - (o.y + c.lane)) < V.wid / 2 + 8) { crashRoad(V.name); break; }
            }
            if (state === 'play' && P.z < 22) crashRoad('Выехал на трассу!');
          } else if (!o.passed && P.y > o.y + half) {
            o.passed = true;
            bonus += 300; addText('Перелёт через трассу +300', P.x, P.y - 60, '#d9352b');
          }
          if (state !== 'play') break;
          continue;
        }
        if (o.type === 'sign' || o.type === 'steepsign') continue;
        if (o.type === 'gate') {
          if (!o.done && P.y >= o.y) {
            o.done = true;
            if (Math.abs(P.x - o.x) < o.gap / 2) { bonus += 100; addText('Ворота +100', o.x, o.y - 30, '#2466d9'); }
          }
          continue;
        }
        const reach = hitRadius(o) + (o.type === 'flake' || o.type === 'helmet' ? 10 : RIDER_R);
        const dist2 = dx * dx + dy * dy, rr = reach * reach;
        if (dist2 > rr) continue;
        switch (o.type) {
          case 'flake':
            o.dead = true; bonus += 25; addText('+25', o.x, o.y - 20, '#2466d9'); puff(o.x, o.y, 6, 0.6);
            break;
          case 'helmet':
            o.dead = true; P.shield = true; addText('Шлем надет!', o.x, o.y - 30, '#2d7a3e');
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

    if (state !== 'play' || P.crash) for (const o of objects) if (o.type === 'road') updateRoad(o, dt);
    warn();

    // камера плавно следует за райдером
    cam.x += (P.x - cam.x) * Math.min(1, 3 * dt);

    // генерация и уборка трассы
    while (spawnY < P.y + ahead()) spawnRow();
    objects = objects.filter(o => !o.dead && o.y > P.y - Math.max(H * 0.6, 500));

    for (const p of particles) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
      if (p.floor !== undefined && p.y > p.floor) { p.y = p.floor; p.vy = 0; p.vx *= 0.3; }
    }
    for (const o of objects) if (o.shake > 0) o.shake = Math.max(0, o.shake - dt);
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

  // подсказка: впереди трасса — где большой трамплин
  let warnCache = '';
  function warn() {
    let text = '';
    if (state === 'play' && !P.crash) {
      const road = objects.find(o => o.type === 'road' && !o.passed && o.y - P.y < 1500 && o.y - P.y > -o.w / 2);
      if (road && !(P.air && P.trick && P.trick.big)) {
        const ramp = objects.find(o => o.type === 'bigramp' && Math.abs(o.y - (road.y - road.w / 2 - ROAD.rampBefore)) < 1);
        if (ramp && P.y < ramp.y) {
          const dx = ramp.x - P.x;
          text = Math.abs(dx) < 50 ? '⚠ Трасса! Трамплин прямо — держи курс' : dx < 0 ? '⚠ Трасса! Трамплин левее ←' : '⚠ Трасса! Трамплин правее →';
        } else text = '⚠ Трасса! Прыгай!';
      }
    }
    if (!text && state === 'play' && !P.crash) {
      if (steepness(P.y) > 0.05) text = '◆ Крутяк! Скорость растёт';
      else {
        const f = pitchF(P.y);
        if (f > PITCH.from - 0.12 && f < PITCH.from) text = '◆ Впереди чёрная трасса — крутой склон';
      }
    }
    if (text === warnCache) return;
    warnCache = text;
    const el = root.querySelector('[data-hud="warn"]');
    el.textContent = text; el.hidden = !text;
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
      // кромка — плотный снег, подсвеченный солнцем; края насыпи неровные
      const r = rng(17);
      g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx - half + 2, lip - 0.8);
      for (let x = -half + 4; x <= half - 2; x += 4) g.lineTo(cx + x, lip - 0.8 + (r() - 0.5) * 0.8);
      g.stroke();
      g.fillStyle = 'rgba(150,172,205,.35)';
      for (let i = 0; i < 14; i++) { g.beginPath(); g.ellipse(cx + (r() - 0.5) * half * 1.8, back + 3 + r() * (lip - back - 6), 1.5 + r() * 2, 0.8, 0, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#f4f8fd';
      for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
        g.beginPath(); g.ellipse(cx + sx * (half - 2 + r() * 4), back + 4 + i * 5.5, 2.5 + r() * 2, 2 + r(), 0, 0, Math.PI * 2); g.fill();
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
      asphalt: ctx.createPattern(sprite(128, 64, g => {
        g.fillStyle = '#3d4047'; g.fillRect(0, 0, 128, 64);
        const r = rng(3);
        for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.12)'; g.fillRect(r() * 128, r() * 64, 0.8, 0.8); }
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 18, 128, 5); g.fillRect(0, 44, 128, 5);    // накатанные колеи
      }), 'repeat'),
      puff: puffSprite(),
    };
    SPR.asphalt.setTransform(new DOMMatrix().scale(1 / SS));
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
    if (cine) {
      // камера наезжает и уводит точку интереса к центру кадра
      const [fx, fy] = toScreen(cine.focus.x, cine.focus.y);
      ctx.translate(fx + (W / 2 - fx) * cine.pan, fy + (H * 0.5 - fy) * cine.pan);
      ctx.scale(cine.zoom, cine.zoom);
      ctx.translate(-fx, -fy);
    }

    // снег
    const T = 256;
    const ox = (((cam.x - W / 2) % T) + T) % T, oy = (((P.y - PLAYER_Y()) % T) + T) % T;
    ctx.save(); ctx.translate(-ox, -oy);
    ctx.fillStyle = SPR.snow; ctx.fillRect(0, 0, W + T * 2, H + T * 2);
    ctx.restore();

    for (const o of objects) if (o.type === 'road') drawRoad(o);
    drawSteep();
    drawTracks();

    const list = objects.filter(o => o.type !== 'road').map(o => ({ y: o.y, o }));
    list.push({ y: P.y, player: true });
    for (const d of debris) list.push({ y: d.y, d });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      if (it.player) drawPlayer();
      else if (it.d) drawDebris(it.d);
      else drawObject(it.o);
    }

    if (cine && cine.kind === 'crash' && cine.t > 1.4) drawDizzy();

    // полосы скорости на разгоне
    if (state === 'play' && P.boost > 1.12) {
      const k = Math.min(1, (P.boost - 1.12) / 0.4);
      ctx.strokeStyle = `rgba(95,125,180,${0.45 * k})`; ctx.lineWidth = 1.3;
      for (let i = 0; i < 18; i++) {
        const x = ((i * 97.3 + (i % 3) * 41) % W);
        if (Math.abs(x - W / 2) < W * 0.18) continue;
        const y = (((i * 173.7 - clock * (900 + i * 30)) % (H + 120)) + H + 120) % (H + 120) - 60;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 40 + (i % 4) * 14); ctx.stroke();
      }
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

  // крутой участок: склон темнеет с крутизной, на бровке — светлый перегиб и тень под ним
  function drawSteep() {
    const top = P.y - PLAYER_Y(), bot = top + H;
    const first = Math.floor(top / PITCH.len) - 1, last = Math.floor(bot / PITCH.len) + 1;
    for (let i = first; i <= last; i++) {
      const y0 = (i + PITCH.from) * PITCH.len, y1 = (i + PITCH.to) * PITCH.len;
      if (y1 < top || y0 > bot) continue;
      for (let wy = Math.max(y0, top - 4); wy < Math.min(y1, bot); wy += 4) {
        ctx.fillStyle = `rgba(55,82,138,${0.27 * steepness(wy)})`;
        ctx.fillRect(0, wy - top, W, 4.5);
      }
      // бровка: светлая кромка и резкая тень сразу за ней
      const cy = y0 - top;
      if (cy > -40 && cy < H + 40) {
        const gl = ctx.createLinearGradient(0, cy - 26, 0, cy + 30);
        gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.45, 'rgba(255,255,255,.85)');
        gl.addColorStop(0.55, 'rgba(120,145,190,.28)'); gl.addColorStop(1, 'rgba(120,145,190,0)');
        ctx.fillStyle = gl; ctx.fillRect(0, cy - 26, W, 56);
      }
      // выкат внизу стенки — снова светлее
      const by = y1 - top;
      if (by > -30 && by < H + 30) {
        const gb = ctx.createLinearGradient(0, by - 24, 0, by + 24);
        gb.addColorStop(0, 'rgba(62,88,140,.06)'); gb.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gb; ctx.fillRect(0, by - 24, W, 48);
      }
    }
  }

  // знак «чёрная трасса»: чёрный ромб на столбике
  function drawSteepSign(sx, sy) {
    shadow(sx + 6, sy + 1, 9, 2.5);
    ctx.fillStyle = '#6b7280'; ctx.fillRect(sx - 1.2, sy - 42, 2.4, 42);
    ctx.save(); ctx.translate(sx, sy - 46);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(-13, -13, 26, 26, 3); ctx.fill();
    ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#111'; ctx.fillRect(-6.5, -6.5, 13, 13);
    ctx.restore();
    ctx.fillStyle = '#111'; ctx.font = '800 6px Manrope, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('КРУТО', sx, sy - 28);
  }

  // после падения: звёздочки и птички кружат над головой
  function drawDizzy() {
    const [sx, sy] = toScreen(P.x, P.y);
    const cx = sx + 14, cy = sy - 22;
    const a0 = clock * 3.2;
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i / 5) * Math.PI * 2;
      const x = cx + Math.cos(a) * 17, y = cy + Math.sin(a) * 6;
      const front = Math.sin(a) > 0;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a * 1.5);
      if (i % 2) {
        ctx.fillStyle = front ? '#ffd23f' : '#e0a800';
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const r = k % 2 ? 1.8 : 4.4, b = (k / 10) * Math.PI * 2 - Math.PI / 2;
          k ? ctx.lineTo(Math.cos(b) * r, Math.sin(b) * r) : ctx.moveTo(Math.cos(b) * r, Math.sin(b) * r);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(120,80,0,.6)'; ctx.lineWidth = 0.6; ctx.stroke();
      } else {
        ctx.strokeStyle = '#2b3445'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
        const f = Math.sin(clock * 14 + i) * 1.5;
        ctx.beginPath(); ctx.moveTo(-4, -f); ctx.quadraticCurveTo(-2, -2, 0, 0); ctx.quadraticCurveTo(2, -2, 4, -f); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // следы: вдавленная борозда + светлый край.
  // Точка следа — ровно под лыжей: то же смещение и поворот, что у спрайта (лыжи на ±5.5, масштаб 1.12, курс angle·0.8)
  const SKI_OFF = 5.5 * 1.12;
  function trackRuns() {
    const runs = [];
    let cur = [];
    for (const t of tracks) {
      if (!t) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
      cur.push(t);
    }
    if (cur.length > 1) runs.push(cur);
    return runs;
  }
  // плавная линия через середины отрезков + сдвиг по нормали (для светлого края борозды)
  function strokeSmooth(pts, shift) {
    const n = pts.length;
    const q = pts.map((p, i) => {
      if (!shift) return p;
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [p[0] - (dy / l) * shift, p[1] + (dx / l) * shift];
    });
    ctx.beginPath();
    ctx.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(q[i][0], q[i][1], (q[i][0] + q[i + 1][0]) / 2, (q[i][1] + q[i + 1][1]) / 2);
    }
    ctx.lineTo(q[n - 1][0], q[n - 1][1]);
    ctx.stroke();
  }
  function drawTracks() {
    const ski = rider === 'ski';
    const sides = ski ? [-1, 1] : [0];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const run of trackRuns()) {
      for (const side of sides) {
        const pts = run.map(t => {
          const th = t.a * 0.8;
          return toScreen(t.x + side * SKI_OFF * Math.cos(th), t.y - side * SKI_OFF * Math.sin(th));
        });
        ctx.strokeStyle = 'rgba(120,145,190,.34)'; ctx.lineWidth = ski ? 2.4 : 8;
        strokeSmooth(pts, 0);
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = ski ? 0.9 : 1.6;
        strokeSmooth(pts, ski ? 0.9 : 2.6);
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
        const wob = o.shake ? Math.sin(clock * 45) * o.shake * 2.6 : 0;
        ctx.drawImage(sp, sx - sp.w / 2 + wob, sy - sp.baseY, sp.w, sp.h);
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
      case 'bigramp': {
        const sp = SPR.kicker, k = 2;
        shadow(sx + 8, sy + 20, 72, 14, 0.2);
        ctx.drawImage(sp, sx - (sp.w * k) / 2, sy - sp.baseY * k, sp.w * k, sp.h * k);
        break;
      }
      case 'sign': drawSign(sx, sy, o); break;
      case 'pole': drawGatePole(sx, sy, o); break;
      case 'steepsign': drawSteepSign(sx, sy); break;
      case 'flake': drawFlakePickup(sx, sy, o); break;
      case 'helmet': drawHelmetPickup(sx, sy, o); break;
    }
  }

  // трасса поперёк склона: асфальт, разметка, отвалы снега, машины
  function drawRoad(o) {
    const [, sy] = toScreen(0, o.y);
    const half = o.w / 2;
    if (sy + half + 40 < 0 || sy - half - 40 > H) return;
    const top = sy - half, bot = sy + half;
    // отвалы снега по краям с грязной кромкой
    for (const [y0, dir] of [[top, -1], [bot, 1]]) {
      const gr = ctx.createLinearGradient(0, y0, 0, y0 + dir * 22);
      gr.addColorStop(0, '#8e949c'); gr.addColorStop(0.35, '#dfe5ee'); gr.addColorStop(1, 'rgba(242,246,251,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, Math.min(y0, y0 + dir * 22), W, 22);
    }
    ctx.fillStyle = SPR.asphalt;
    ctx.save(); ctx.translate(-(((cam.x % 128) + 128) % 128), top); ctx.fillRect(0, 0, W + 128, o.w); ctx.restore();
    // разметка: сплошные по краям, двойная жёлтая по центру
    ctx.fillStyle = 'rgba(240,240,240,.9)';
    ctx.fillRect(0, top + 7, W, 2); ctx.fillRect(0, bot - 9, W, 2);
    ctx.fillStyle = '#e8b422';
    ctx.fillRect(0, sy - 3, W, 1.6); ctx.fillRect(0, sy + 1.4, W, 1.6);
    // снежные наносы на обочинах
    ctx.fillStyle = 'rgba(245,248,252,.85)';
    const off = ((cam.x % 90) + 90) % 90;
    for (let x = -off; x < W + 90; x += 90) {
      ctx.beginPath(); ctx.ellipse(x + 20, top + 3, 26, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 65, bot - 3, 22, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of o.cars) drawVehicle(c, sy);
  }

  function drawVehicle(c, roadY) {
    const V = { car: [56, 24], suv: [62, 27], truck: [205, 32], bus: [150, 32] }[c.kind];
    const x = c.x - cam.x + W / 2, y = roadY + c.lane;
    if (x < -V[0] || x > W + V[0]) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(c.dir, 1);         // нос машины — в сторону движения (+x)
    const L = V[0], Wd = V[1];
    ctx.fillStyle = 'rgba(20,24,32,.3)';
    ctx.beginPath(); ctx.roundRect(-L / 2 + 3, -Wd / 2 + 4, L, Wd, 6); ctx.fill();
    if (c.kind === 'truck') {
      // фура: прицеп с логотипом и кабина
      ctx.fillStyle = '#f3f4f6'; ctx.beginPath(); ctx.roundRect(-L / 2, -Wd / 2, L - 46, Wd, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#16161a'; ctx.font = '800 11px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.save(); ctx.scale(c.dir, 1); ctx.fillText('COULAIR', c.dir * -23, 1); ctx.restore();
      ctx.fillStyle = c.color; ctx.beginPath(); ctx.roundRect(L / 2 - 42, -Wd / 2 + 1, 42, Wd - 2, 6); ctx.fill();
      ctx.fillStyle = '#1f2937'; ctx.fillRect(L / 2 - 14, -Wd / 2 + 4, 8, Wd - 8);
    } else if (c.kind === 'bus') {
      ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.roundRect(-L / 2, -Wd / 2, L, Wd, 6); ctx.fill();
      ctx.fillStyle = '#e5e7eb'; ctx.fillRect(-L / 2 + 10, -Wd / 2 + 5, L - 24, Wd - 10);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let i = -L / 2 + 20; i < L / 2 - 20; i += 22) ctx.fillRect(i, -Wd / 2 + 5, 2, Wd - 10);
      ctx.fillStyle = '#1f2937'; ctx.fillRect(L / 2 - 12, -Wd / 2 + 3, 7, Wd - 6);
    } else {
      const g = ctx.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, c.color); g.addColorStop(1, '#000000');
      ctx.fillStyle = c.color; ctx.beginPath(); ctx.roundRect(-L / 2, -Wd / 2, L, Wd, 8); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.fillStyle = g; ctx.fill(); ctx.globalAlpha = 1;
      // стёкла и крыша
      ctx.fillStyle = '#1b2230';
      ctx.beginPath(); ctx.roundRect(L * 0.08, -Wd / 2 + 3, L * 0.18, Wd - 6, 3); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-L * 0.36, -Wd / 2 + 3, L * 0.12, Wd - 6, 3); ctx.fill();
      ctx.fillStyle = c.color; ctx.beginPath(); ctx.roundRect(-L * 0.24, -Wd / 2 + 3, L * 0.32, Wd - 6, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-L * 0.22, -Wd / 2 + 4, L * 0.28, 3);
    }
    // фары и стоп-сигналы
    ctx.fillStyle = '#fff7d1'; ctx.fillRect(L / 2 - 3, -Wd / 2 + 2, 3, 5); ctx.fillRect(L / 2 - 3, Wd / 2 - 7, 3, 5);
    ctx.fillStyle = '#ef4444'; ctx.fillRect(-L / 2, -Wd / 2 + 2, 2.5, 5); ctx.fillRect(-L / 2, Wd / 2 - 7, 2.5, 5);
    ctx.restore();
  }

  // знак «Внимание, трасса» со стрелкой к большому трамплину
  function drawSign(sx, sy, o) {
    shadow(sx + 4, sy + 1, 7, 2);
    ctx.fillStyle = '#6b7280'; ctx.fillRect(sx - 1, sy - 34, 2, 34);
    const y = sy - 44;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d9352b'; ctx.lineWidth = 2.6; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(sx, y - 11); ctx.lineTo(sx + 11, y + 8); ctx.lineTo(sx - 11, y + 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#16161a'; ctx.font = '900 11px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', sx, y + 6);
    ctx.fillStyle = '#2466d9'; ctx.fillRect(sx - 10, y + 11, 20, 9);
    ctx.fillStyle = '#fff'; ctx.beginPath();
    const d = -o.dir;
    ctx.moveTo(sx + d * 7, y + 15.5); ctx.lineTo(sx - d * 1, y + 12); ctx.lineTo(sx - d * 1, y + 19); ctx.closePath(); ctx.fill();
    ctx.fillRect(sx - (d > 0 ? 6 : -1), y + 14.5, 7, 2);
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
    if (mirror2d) { ctx.save(); ctx.scale(-1, 1); ctx.fillText('COULAIR', -2, 1.3); ctx.restore(); }
    else ctx.fillText('COULAIR', 2, 1.3);
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
    const lift = P.z < 160 ? P.z * 0.45 : 72 + (P.z - 160) * 0.18;   // большой прыжок — сжато, чтобы райдер оставался в кадре
    const sy = sy0 - lift;
    shadow(sx + 5 + lift * 0.3, sy0 + 4, 20 - Math.min(10, P.z / 16), 6.5, 0.28);

    ctx.save();
    ctx.translate(sx, sy);
    const pose = { crouch: P.crouch, plant: P.plant, grab: (P.air && P.trick && !P.manual && P.z > 40) || P.grabbing, noGear: false };
    if (P.crash) {
      const k = Math.min(P.crash / 0.7, 1);
      ctx.rotate(k * Math.PI * 1.5);                            // кувырок и падение на бок
      ctx.translate(0, k * 6);
      pose.noGear = rider === 'ski';
      pose.crouch = 0.9;
    } else if (P.manual) {
      ctx.rotate(P.rot);                                           // вращение — в плоскости экрана
      const c = Math.cos(P.flip);                                  // сальто — «переворачивание» спрайта
      ctx.scale(1, Math.sign(c || 1) * Math.max(0.12, Math.abs(c)));
    } else if (P.spin) ctx.rotate(P.spin);
    ctx.scale(1.12, 1.12);
    if (rider === 'board') {
      const c = Math.cos(P.stanceVis);                             // реверт — «переворот» картинки
      mirror2d = c < 0;
      ctx.scale(Math.sign(c || 1) * Math.max(0.15, Math.abs(c)), 1);
    }
    if (rider === 'ski') drawSkier(pose); else drawBoarder(pose);
    mirror2d = false;
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
    if (cine) updateCine(dt);
    if (state !== 'start') update(cine ? dt * cine.slow : dt);
    else { if (!is3D()) P.y += 60 * dt; cam.x = P.x; P.angle = Math.sin(t / 900) * 0.5; P.x += P.angle * 40 * dt; while (spawnY < P.y + ahead()) spawnRow(); objects = objects.filter(o => o.y > P.y - H * 0.6); }
    if (is3D()) {
      try {
        R3D.render({ dt: cine ? dt * Math.max(cine.slow, 0.05) : dt, realDt: dt, clock, state, rider, RIDERS, P, cam, objects, tracks, particles, texts, debris, shake, cine });
      } catch (err) {
        console.warn('Coulair Run 3D:', err);
        R3D = null; loading3D = null; apply('2d'); toast('3D-графика дала сбой — переключились на 2D');
        draw();
      }
    } else draw();
    raf = requestAnimationFrame(frame);
  }

  function open() {
    if (!root) build();
    window.getSelection?.().removeAllRanges();             // снять выделение, оставшееся на странице
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
  // для автотестов: состояние игры доступно только с ?gamedebug в адресе
  if (/[?&]gamedebug/.test(location.search)) window.__coulairRun = () => ({
    P, objects, keys, state, texts, get bonus() { return bonus; },
    teleport(y) { P.y = y; cam.x = P.x; objects.length = 0; tracks.length = 0; spawnY = y + 200; nextRoadY = y + 20000; },
  });
})();
