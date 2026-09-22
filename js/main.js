/* =====================================================================
   Coulair Club — всё, что нужно менять, собрано в CONFIG
   ===================================================================== */
const CONFIG = {
  // Бегущая строка
  ticker: ['Дроп штанов скоро', 'Новые шлемы', 'Новые горнолыжные ботинки', 'Осенние скидки'],

  // Соцсети (кнопка в углу, Telegram в шапке и футере). Пустая ссылка — пункт скрывается.
  socials: [
    { id: 'telegram',  label: 'Telegram',  url: 'https://t.me/coulairclub' },
    { id: 'whatsapp',  label: 'WhatsApp',  url: '' },
    { id: 'vk',        label: 'ВКонтакте', url: '' },
    { id: 'instagram', label: 'Instagram', url: '' },
  ],

  // Видео на первом экране: после первого проигрывания появляется матовый блок, дальше видео крутится по кругу.
  // На узких экранах берётся облегчённая 720p-версия.
  heroVideo: { desktop: 'assets/hero.mp4', mobile: 'assets/hero-720.mp4' },

  // 360° штанов: кадры, нарезанные из видео (01.jpg … 72.jpg = полный оборот)
  pants360: { path: 'assets/pants360/', count: 144 },

  // Главный товар
  pants: {
    id: 'pants', type: 'pants', name: 'Широкие горнолыжные штаны',
    price: 7999, oldPrice: 10000, sizes: ['M', 'L', 'XL'],
    image: 'assets/pants360/001.jpg', url: './#pants', fit: 'contain',
  },

  // Товары каталога берутся из catalog/catalog.js (собирается: python3 tools/build_catalog.py).
  // Карточки-анонсы «скоро» — показываются в конце ленты на главной.
  teasers: [
    { type: 'helmet', name: 'Новые шлемы', note: 'Скоро в наличии' },
    { type: 'boots',  name: 'Горнолыжные ботинки', note: 'Скоро в наличии' },
  ],

  // Куда отправлять заявки. Пусто — заявка только показывается как «принята» (и пишется в консоль).
  // Подойдёт любой URL, принимающий POST JSON: свой сервер, Formspree и т.п.
  orderEndpoint: '',

  freeShippingFrom: 2,
};

const PLACEHOLDERS = {
  helmet: 'assets/products/helmet-placeholder.svg',
  boots:  'assets/products/boots-placeholder.svg',
  pants:  'assets/products/pants-placeholder.svg',
};
const CATALOG_TITLES = { all: 'Подобрано к сезону', helmet: 'Горнолыжные шлемы', boots: 'Горнолыжные ботинки', pants: 'Горнолыжные штаны' };
const TYPE_TABS = [['all', 'Всё'], ['helmet', 'Шлемы'], ['boots', 'Ботинки'], ['pants', 'Штаны']];

/* ---------- утилиты ---------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const rub = n => n.toLocaleString('ru-RU') + ' ₽';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const catalogItems = () => window.CATALOG || [];
const allProducts = () => [CONFIG.pants, ...catalogItems()];
const findProduct = id => allProducts().find(p => p.id === id);
const imgOf = p => (p.images && p.images[0]) || p.image || PLACEHOLDERS[p.type] || PLACEHOLDERS.helmet;
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* приватный режим */ } },
};

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
}

const ICONS = {
  telegram: '<svg viewBox="0 0 24 24" class="fill"><path d="M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6.1 13.1l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6L20.5 2.7c.9-.3 1.7.2 1.4 1.6Z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24"><path d="M3.5 20.5 5 16.3A8.5 8.5 0 1 1 8 19.2l-4.5 1.3Z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8a4.5 4.5 0 0 1-2.2-2.2l.8-1-1-2L9.5 7c-.3.3-.5.9-.5 1.5Z"/></svg>',
  vk: '<svg viewBox="0 0 24 24" class="fill"><path d="M12.8 18C6.4 18 2.8 13.6 2.6 6.3h3.2c.1 5.4 2.5 7.6 4.4 8.1V6.3h3v4.6c1.9-.2 3.8-2.3 4.5-4.6h3a8.9 8.9 0 0 1-4.1 5.8 9.2 9.2 0 0 1 4.8 5.9h-3.3a5.8 5.8 0 0 0-4.9-4.2V18h-.4Z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".6" class="fill"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

// На сайте «catalog/» открывает catalog/index.html сам, а при открытии файла с диска — нет
function fixUrl(href) {
  const u = new URL(href, document.baseURI);
  if (u.protocol === 'file:' && u.pathname.endsWith('/')) u.pathname += 'index.html';
  return u.href;
}
function fixLocalLinks(root = document) {
  if (location.protocol !== 'file:') return;
  $$('a[href]', root).forEach(a => {
    const h = a.getAttribute('href');
    if (!h || h.startsWith('#') && !document.querySelector('base') || /^(https?:|mailto:|tel:)/.test(h)) return;
    a.href = fixUrl(h);
  });
}

/* =====================================================================
   Бегущая строка
   ===================================================================== */
function initTicker() {
  const track = $('#tickerTrack');
  const set = CONFIG.ticker.map(t => `<span class="ticker__item">${escapeHtml(t)}</span>`).join('');
  // Повторяем набор, пока он не станет шире экрана, затем дублируем — анимация сдвигает на -50%
  let html = set;
  track.innerHTML = html;
  while (track.scrollWidth < window.innerWidth * 1.2) { html += set; track.innerHTML = html; }
  track.innerHTML = html + html;
  const pxPerSec = 70;
  track.style.animationDuration = (track.scrollWidth / 2 / pxPerSec) + 's';
}

/* =====================================================================
   Шапка
   ===================================================================== */
function initHeader() {
  const header = $('#header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const menu = $('#mobileMenu');
  const burger = $('#burgerBtn');
  burger.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    header.classList.toggle('is-scrolled', !menu.hidden || window.scrollY > 10);
  });
  $$('a', menu).forEach(a => a.addEventListener('click', () => { menu.hidden = true; }));
}

/* =====================================================================
   Первый экран: видео один раз → матовый блок
   ===================================================================== */
function initHero() {
  const video = $('#heroVideo');
  if (!video) return;
  const offer = $('#offer');
  let shown = false, fellBack = false;
  const showOffer = () => { if (!shown) { shown = true; offer.classList.add('is-visible'); } };
  // Нет файла / ошибка — показываем заглушку со снегом и блок
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    video.hidden = true;
    startSnow($('#heroSnow'), $('#hero'), 0.6);
    setTimeout(showOffer, 700);
  };

  // Первый раз проигрывается целиком → показываем спецпредложение, дальше видео идёт по кругу
  video.addEventListener('ended', () => {
    showOffer();
    video.loop = true;
    video.currentTime = 0;
    video.play().catch(() => {});
  }, { once: true });
  video.addEventListener('error', fallback);
  video.src = window.innerWidth < 900 ? CONFIG.heroVideo.mobile : CONFIG.heroVideo.desktop;
  const p = video.play();
  // автозапуск запрещён (энергосбережение и т.п.) — остаётся постер, блок показываем сразу
  if (p && p.catch) p.catch(() => setTimeout(showOffer, 700));
  // Страховка: если видео зависло
  setTimeout(showOffer, 20000);
}

/* =====================================================================
   360° просмотр штанов (смена кадров при перетаскивании)
   ===================================================================== */
function initViewer() {
  const viewer = $('#viewer');
  if (!viewer) return;
  const img = $('#viewerFrame');
  const bar = $('#viewerProgress');
  const { path, count } = CONFIG.pants360;
  const src = i => path + String(i + 1).padStart(3, '0') + '.jpg';

  // Предзагрузка всех кадров, чтобы вращение было без подгрузок
  const frames = [];
  let loaded = 0;
  for (let i = 0; i < count; i++) {
    const im = new Image();
    im.onload = im.onerror = () => {
      loaded++;
      $('span', bar).style.width = (loaded / count * 100) + '%';
      if (loaded === count) bar.classList.add('is-done');
    };
    im.src = src(i);
    frames.push(im);
  }

  let pos = 0;                    // текущая позиция в кадрах (дробная)
  const show = () => {
    const i = ((Math.round(pos) % count) + count) % count;
    const want = frames[i].src;
    if (img.src !== want) img.src = want;
  };

  // Автоповорот, пока пользователь не взялся крутить: оборот за ~10 секунд
  let auto = !reducedMotion, last = 0;
  const spin = t => {
    if (!auto) return;
    if (last && loaded === count) { pos += (t - last) / 1000 * (count / 10); show(); }
    last = t;
    requestAnimationFrame(spin);
  };
  requestAnimationFrame(spin);
  const stopAuto = () => { auto = false; viewer.classList.add('is-touched'); };

  // протянуть на всю ширину блока = полный оборот
  let dragging = false, startX = 0, startPos = 0;
  viewer.addEventListener('pointerdown', e => {
    stopAuto();
    dragging = true;
    startX = e.clientX;
    startPos = pos;
    viewer.setPointerCapture(e.pointerId);
    viewer.classList.add('is-dragging');
  });
  viewer.addEventListener('pointermove', e => {
    if (!dragging) return;
    pos = startPos - (e.clientX - startX) / viewer.clientWidth * count;
    show();
  });
  const end = () => { dragging = false; viewer.classList.remove('is-dragging'); };
  viewer.addEventListener('pointerup', end);
  viewer.addEventListener('pointercancel', end);

  viewer.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    stopAuto();
    pos += e.key === 'ArrowRight' ? -count / 24 : count / 24;
    show();
  });
}

/* =====================================================================
   Размеры + заказ главного товара
   ===================================================================== */
let selectedSize = null;
function initSizes() {
  const wrap = $('.sizes');
  if (!$('#orderPantsBtn')) return;
  $$('.size').forEach(btn => btn.addEventListener('click', () => {
    selectedSize = btn.dataset.size;
    $$('.size').forEach(b => b.setAttribute('aria-checked', String(b === btn)));
    wrap.classList.remove('is-error');
    $('#sizeError').hidden = true;
  }));

  $('#orderPantsBtn').addEventListener('click', () => {
    if (!selectedSize) {
      wrap.classList.remove('is-error'); void wrap.offsetWidth; wrap.classList.add('is-error');
      $('#sizeError').hidden = false;
      return;
    }
    openOrder([{ id: CONFIG.pants.id, size: selectedSize, qty: 1 }]);
  });
}

/* =====================================================================
   Каталог (карточки)
   ===================================================================== */
let currentFilter = 'all';

function cardHtml(p) {
  const inCart = cart.some(i => i.id === p.id);
  const photo = !!(p.images && p.images.length);
  const img2 = photo && p.images[1] ? `<img class="card__img2" src="${p.images[1]}" alt="" loading="lazy">` : '';
  const sale = p.oldPrice ? `<span class="card__sale">−${Math.round((1 - p.price / p.oldPrice) * 100)}%</span>` : '';
  const badge = p.badge ? `<span class="card__badge">${escapeHtml(p.badge)}</span>` : '';
  return `
    <article class="card" id="card-${p.id}">
      <a class="card__main" href="${fixUrl(p.url || './')}">
        <div class="card__media${photo ? ' card__media--photo' : ''}${p.fit === 'contain' ? ' card__media--contain' : ''}">
          <img src="${imgOf(p)}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDERS[p.type] || PLACEHOLDERS.helmet}'">
          ${img2}${sale}${badge}
        </div>
        <div class="card__body">
          <h3 class="card__name">${escapeHtml(p.name)}</h3>
          <p class="card__price">${rub(p.price)}${p.oldPrice ? `<s>${rub(p.oldPrice)}</s>` : ''}${p.size ? `<span class="card__size">${escapeHtml(p.size)}</span>` : ''}</p>
        </div>
      </a>
      <button class="card__add ${inCart ? 'is-added' : ''}" data-add="${p.id}" aria-label="Добавить в корзину: ${escapeHtml(p.name)}">
        ${inCart ? ICONS.check : ICONS.plus}
      </button>
    </article>`;
}

function teaserHtml(t) {
  return `
    <article class="card card--teaser">
      <div class="card__media"><img src="${PLACEHOLDERS[t.type]}" alt="" loading="lazy"></div>
      <div class="card__body">
        <h3 class="card__name">${escapeHtml(t.name)}</h3>
        <p class="card__price">${escapeHtml(t.note)}</p>
      </div>
    </article>`;
}

function renderCatalog() {
  const track = $('#catalogTrack');
  if (!track) return;
  const match = p => currentFilter === 'all' || p.type === currentFilter;
  const items = catalogItems().filter(match);
  const teasers = CONFIG.teasers.filter(match);
  $('#catalogTitle').textContent = CATALOG_TITLES[currentFilter];
  track.innerHTML = items.map(cardHtml).join('') + teasers.map(teaserHtml).join('');
  if (!track.innerHTML.trim()) track.innerHTML = '<p class="catalog__empty">Скоро здесь появятся товары</p>';
  track.scrollLeft = 0;
  updateArrows();
}

// Перерисовать все карточки на странице (например, после изменения корзины)
function rerenderCards() {
  renderCatalog();
  renderCatalogPage();
  renderRelated();
}

function updateArrows() {
  const t = $('#catalogTrack');
  if (!t) return;
  $('#prevBtn').disabled = t.scrollLeft <= 2;
  $('#nextBtn').disabled = t.scrollLeft + t.clientWidth >= t.scrollWidth - 2;
}

function setFilter(f) {
  currentFilter = f;
  renderCatalog();
  $$('.cat-btn[data-filter]').forEach(b => b.classList.toggle('is-active', b.dataset.filter === f && f !== 'all'));
}

function initCatalog() {
  const track = $('#catalogTrack');
  if (!track) return;
  const page = dir => {
    const card = $('.card', track);
    const step = card ? card.getBoundingClientRect().width + 4 : track.clientWidth;
    track.scrollBy({ left: dir * step * Math.max(1, Math.floor(track.clientWidth / step)), behavior: 'smooth' });
  };
  $('#prevBtn').addEventListener('click', () => page(-1));
  $('#nextBtn').addEventListener('click', () => page(1));
  track.addEventListener('scroll', updateArrows, { passive: true });
  window.addEventListener('resize', updateArrows);

  // Любая ссылка с data-filter (шапка, категории, футер) фильтрует карточки
  $$('[data-filter]').forEach(a => a.addEventListener('click', () => setFilter(a.dataset.filter)));
  renderCatalog();
}

/* =====================================================================
   Страница «Каталог»
   ===================================================================== */
let pageFilter = 'all';
function renderCatalogPage() {
  const grid = $('#catalogGrid');
  if (!grid) return;
  const items = allProducts().filter(p => pageFilter === 'all' || p.type === pageFilter);
  grid.innerHTML = items.length ? items.map(cardHtml).join('')
    : '<p class="catalog__empty">В этой категории скоро появятся товары — <a href="#" data-social="telegram" target="_blank" rel="noopener">напишите нам</a>, подберём под заказ.</p>';
  $('#catalogPageTitle').textContent = pageFilter === 'all' ? 'Каталог' : CATALOG_TITLES[pageFilter];
  $$('.tab', $('#catalogTabs')).forEach(t => t.setAttribute('aria-selected', String(t.dataset.type === pageFilter)));
  initSocialLinks(grid);
}
function initCatalogPage() {
  const tabs = $('#catalogTabs');
  if (!tabs) return;
  const count = t => allProducts().filter(p => t === 'all' || p.type === t).length;
  tabs.innerHTML = TYPE_TABS.map(([t, label]) =>
    `<button class="tab" role="tab" data-type="${t}">${label}<span>${count(t)}</span></button>`).join('');
  const fromUrl = new URLSearchParams(location.search).get('type');
  if (TYPE_TABS.some(([t]) => t === fromUrl)) pageFilter = fromUrl;
  tabs.addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    pageFilter = t.dataset.type;
    const u = new URL(location.href);
    if (pageFilter === 'all') u.searchParams.delete('type'); else u.searchParams.set('type', pageFilter);
    history.replaceState(null, '', u);
    renderCatalogPage();
  });
  renderCatalogPage();
}

/* =====================================================================
   Страница товара: галерея, полноэкранный просмотр, заказ
   ===================================================================== */
function initSlider(track, { counter, thumbs, prev, next, onChange } = {}) {
  const slides = () => [...track.children];
  const index = () => Math.round(track.scrollLeft / track.clientWidth);
  const go = i => {
    const n = slides().length;
    i = (i + n) % n;
    track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  };
  let last = -1;
  const update = () => {
    const i = index();
    if (i === last) return;
    last = i;
    if (counter) counter.textContent = `${i + 1} / ${slides().length}`;
    if (thumbs) thumbs.forEach((t, k) => t.classList.toggle('is-active', k === i));
    if (onChange) onChange(i);
  };
  track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  prev && prev.addEventListener('click', e => { e.stopPropagation(); go(index() - 1); });
  next && next.addEventListener('click', e => { e.stopPropagation(); go(index() + 1); });
  update();
  return { go, index, jump: i => { track.scrollTo({ left: i * track.clientWidth }); update(); } };
}

function renderRelated() {
  const track = $('#relatedTrack');
  if (!track) return;
  const id = $('.pdp').dataset.product;
  const current = findProduct(id);
  const others = allProducts().filter(p => p.id !== id)
    .sort((a, b) => (b.type === current.type) - (a.type === current.type));
  $('#related').hidden = !others.length;
  track.innerHTML = others.map(cardHtml).join('');
}

function initProductPage() {
  const pdp = $('.pdp');
  if (!pdp) return;
  const p = findProduct(pdp.dataset.product);
  if (!p) return;

  const thumbs = $$('.gallery__thumb');
  const main = initSlider($('#galleryTrack'), {
    counter: $('#galleryCounter'), thumbs,
    prev: $('.gallery__main .gallery__arrow--prev'), next: $('.gallery__main .gallery__arrow--next'),
  });
  thumbs.forEach(t => t.addEventListener('click', () => main.go(Number(t.dataset.slide))));

  // Полноэкранный просмотр
  const lb = $('#lightbox');
  const lbSlider = initSlider($('#lightboxTrack'), {
    counter: $('#lightboxCounter'),
    prev: $('.gallery__arrow--prev', lb), next: $('.gallery__arrow--next', lb),
  });
  const openLightbox = () => { openLayer('#lightbox'); requestAnimationFrame(() => lbSlider.jump(main.index())); };
  $('#galleryTrack').addEventListener('click', openLightbox);
  $('#galleryZoom').addEventListener('click', openLightbox);
  lb.addEventListener('click', e => { if (e.target.closest('.lightbox__slide') && !e.target.closest('img')) closeLayer(lb); });
  lb.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') lbSlider.go(lbSlider.index() + 1);
    if (e.key === 'ArrowLeft') lbSlider.go(lbSlider.index() - 1);
  });
  document.addEventListener('keydown', e => {
    if (!lb.hidden || $$('.modal, .drawer, .search').some(l => !l.hidden)) return;
    if (e.key === 'ArrowRight') main.go(main.index() + 1);
    if (e.key === 'ArrowLeft') main.go(main.index() - 1);
  });

  $('#pdpOrder').addEventListener('click', () => openOrder([{ id: p.id, size: p.size || null, qty: 1 }]));
  $('#pdpCart').addEventListener('click', () => addToCart(p.id));
  renderRelated();
}

/* =====================================================================
   Корзина
   ===================================================================== */
let cart = store.get('coulair-cart', []).filter(i => findProduct(i.id));

function saveCart() { store.set('coulair-cart', cart); renderCart(); rerenderCards(); }
function cartCount(items = cart) { return items.reduce((s, i) => s + i.qty, 0); }
function cartSum(items = cart) { return items.reduce((s, i) => s + findProduct(i.id).price * i.qty, 0); }

function addToCart(id, size = null) {
  const p = findProduct(id);
  if (!p) return;
  size = size || p.size || null;
  const found = cart.find(i => i.id === id && i.size === size);
  const inCart = cart.filter(i => i.id === id).reduce((n, i) => n + i.qty, 0);
  if (p.stock && inCart >= p.stock) {
    toast(p.stock === 1 ? 'Это единственный экземпляр — он уже в корзине' : 'Больше нет в наличии');
    return;
  }
  if (found) found.qty += 1; else cart.push({ id, size, qty: 1 });
  saveCart();
  const left = CONFIG.freeShippingFrom - cartCount();
  toast(left > 0 ? `Добавлено. Ещё ${left} — и доставка бесплатно` : 'Добавлено. Доставка бесплатная!');
}

function renderCart() {
  const count = cartCount();
  const badge = $('#cartCount');
  badge.hidden = count === 0;
  badge.textContent = count;

  const list = $('#cartList');
  list.innerHTML = cart.length ? cart.map((i, idx) => {
    const p = findProduct(i.id);
    return `<li class="drawer__item">
      <img src="${imgOf(p)}" alt="" onerror="this.onerror=null;this.src='${PLACEHOLDERS[p.type]}'">
      <div>
        <p class="drawer__item-name">${escapeHtml(p.name)}</p>
        <p class="drawer__item-meta">${i.size ? 'Размер ' + i.size + ' · ' : ''}${i.qty} шт. · ${rub(p.price * i.qty)}</p>
      </div>
      <button class="drawer__remove" data-remove="${idx}">Убрать</button>
    </li>`;
  }).join('') : '<li class="drawer__empty">Корзина пока пустая</li>';

  $('#cartTotal').textContent = rub(cartSum());
  $('#checkoutBtn').disabled = !cart.length;
  $('#checkoutBtn').style.opacity = cart.length ? '' : '.4';

  const promo = $('#cartPromo');
  const left = CONFIG.freeShippingFrom - count;
  promo.hidden = count === 0;
  promo.classList.toggle('is-done', left <= 0);
  promo.textContent = left > 0 ? `Добавьте ещё ${left} поз. — доставка по РФ бесплатно` : 'Доставка по РФ — бесплатно 🎉';
}

function initCart() {
  $('#cartBtn').addEventListener('click', () => openLayer('#cartDrawer'));
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-add]');
    if (btn) { e.preventDefault(); addToCart(btn.dataset.add); }
  });
  $('#cartList').addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    cart.splice(Number(btn.dataset.remove), 1);
    saveCart();
  });
  $('#checkoutBtn').addEventListener('click', () => {
    if (!cart.length) return;
    closeLayer($('#cartDrawer'));
    openOrder(cart.map(i => ({ ...i })), true);
  });
  renderCart();
}

/* =====================================================================
   Модалки / слои
   ===================================================================== */
let lastFocus = null;
function openLayer(sel) {
  const layer = $(sel);
  lastFocus = document.activeElement;
  layer.hidden = false;
  document.body.style.overflow = 'hidden';
  const focusable = $('input:not([type=checkbox]), button:not([data-close]), [data-close]', layer);
  if (focusable) setTimeout(() => focusable.focus(), 50);
}
function closeLayer(layer) {
  layer.hidden = true;
  if (!$$('.modal, .drawer, .search, .lightbox').some(l => !l.hidden)) document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
function initLayers() {
  $$('.modal, .drawer, .search, .lightbox').forEach(layer => {
    layer.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeLayer(layer); });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = $$('.modal, .drawer, .search, .lightbox').filter(l => !l.hidden).pop();
    if (open) closeLayer(open);
    else if (!$('#chatPanel').hidden) toggleChat(false);
  });
  $('#accountBtn').addEventListener('click', () => openLayer('#accountModal'));
}

/* =====================================================================
   Заявка
   ===================================================================== */
let orderItems = [];
let orderFromCart = false;

function openOrder(items, fromCart = false) {
  orderItems = items;
  orderFromCart = fromCart;
  const rows = items.map(i => {
    const p = findProduct(i.id);
    return `<div class="order-summary__row"><span>${escapeHtml(p.name)}${i.size ? ', ' + i.size : ''}${i.qty > 1 ? ' × ' + i.qty : ''}</span><span>${rub(p.price * i.qty)}</span></div>`;
  }).join('');
  const free = cartCount(items) >= CONFIG.freeShippingFrom;
  $('#orderSummary').innerHTML = rows +
    `<div class="order-summary__row order-summary__total"><span>Итого</span><span>${rub(cartSum(items))}</span></div>` +
    (free ? '<div class="order-summary__promo">Доставка по РФ — бесплатно</div>' : '');

  $('#orderForm').hidden = false;
  $('#formDone').hidden = true;
  $('#formError').hidden = true;
  openLayer('#orderModal');
}

function formatPhone(value) {
  // Всё после «+7» — местный номер; иначе ведущие 8/7 считаем кодом страны
  let d;
  if (value.startsWith('+7')) {
    d = value.slice(2).replace(/\D/g, '');
    if (d.length === 11 && /^[78]/.test(d)) d = d.slice(1);   // вставили «8999…» после «+7»
  }
  else { d = value.replace(/\D/g, ''); if (d.length > 10 || d[0] === '8' || d[0] === '7') d = d.replace(/^[78]/, ''); }
  d = d.slice(0, 10);
  if (!d) return value.startsWith('+') ? '+7' : '';
  const p = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)];
  let out = '+7 (' + p[0];
  if (p[0].length === 3) out += ')';
  if (p[1]) out += ' ' + p[1];
  if (p[2]) out += '-' + p[2];
  if (p[3]) out += '-' + p[3];
  return out;
}

async function sendOrder(payload) {
  if (!CONFIG.orderEndpoint) {
    console.info('[Coulair] Заявка (orderEndpoint не задан):', payload);
    return;
  }
  const res = await fetch(CONFIG.orderEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
}

function initOrderForm() {
  const form = $('#orderForm');
  const phone = form.elements.phone;
  phone.addEventListener('input', () => { phone.value = formatPhone(phone.value); });
  phone.addEventListener('focus', () => { if (!phone.value) phone.value = '+7'; });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#formError');
    let bad = null;
    $$('.field', form).forEach(f => f.classList.remove('is-invalid'));
    const mark = name => { form.elements[name].closest('.field').classList.add('is-invalid'); bad = bad || form.elements[name]; };

    if (form.elements.name.value.trim().length < 2) mark('name');
    if (phone.value.replace(/\D/g, '').length !== 11) mark('phone');
    if (!form.elements.city.value.trim()) mark('city');

    if (bad) { err.textContent = 'Проверьте выделенные поля'; err.hidden = false; bad.focus(); return; }
    if (!form.elements.agree.checked) { err.textContent = 'Нужно согласие на обработку данных'; err.hidden = false; return; }
    err.hidden = true;

    const payload = {
      name: form.elements.name.value.trim(),
      phone: phone.value,
      telegram: form.elements.telegram.value.trim(),
      city: form.elements.city.value.trim(),
      comment: form.elements.comment.value.trim(),
      items: orderItems.map(i => ({ ...i, name: findProduct(i.id).name, price: findProduct(i.id).price })),
      total: cartSum(orderItems),
      freeShipping: cartCount(orderItems) >= CONFIG.freeShippingFrom,
      createdAt: new Date().toISOString(),
    };

    const submit = $('button[type=submit]', form);
    submit.disabled = true; submit.textContent = 'Отправляем…';
    try {
      await sendOrder(payload);
      form.hidden = true;
      $('#formDone').hidden = false;
      form.reset();
      if (orderFromCart) { cart = []; saveCart(); }
    } catch {
      err.textContent = 'Не получилось отправить. Попробуйте ещё раз или напишите нам в Telegram.';
      err.hidden = false;
    } finally {
      submit.disabled = false; submit.textContent = 'Отправить заявку';
    }
  });
}

/* =====================================================================
   Поиск
   ===================================================================== */
function initSearch() {
  const input = $('#searchInput');
  const results = $('#searchResults');
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.innerHTML = ''; return; }
    const keywords = { helmet: 'шлем шлемы', boots: 'ботинки ботинок обувь', pants: 'штаны брюки', other: '' };
    const found = allProducts().filter(p => (p.name + ' ' + (p.brand || '')).toLowerCase().includes(q) || (keywords[p.type] || '').includes(q));
    results.innerHTML = found.length
      ? found.map(p => `<li><button class="search__result" data-go="${p.id}">
          <img src="${imgOf(p)}" alt="" onerror="this.onerror=null;this.src='${PLACEHOLDERS[p.type]}'">
          <span>${escapeHtml(p.name)}</span><small>${rub(p.price)}</small></button></li>`).join('')
      : '<li class="search__none">Ничего не нашли — напишите нам, подберём</li>';
  };
  input.addEventListener('input', render);
  results.addEventListener('click', e => {
    const btn = e.target.closest('[data-go]');
    if (!btn) return;
    const p = findProduct(btn.dataset.go);
    closeLayer($('#searchModal'));
    if (p.id === 'pants' && $('#pants')) { $('#pants').scrollIntoView({ behavior: 'smooth' }); return; }
    location.href = fixUrl(p.url);
  });
  $('#searchBtn').addEventListener('click', () => { input.value = ''; render(); openLayer('#searchModal'); });
}

/* =====================================================================
   Соцсети + плавающая кнопка
   ===================================================================== */
function toggleChat(force) {
  const panel = $('#chatPanel');
  const open = force ?? panel.hidden;
  panel.hidden = !open;
  $('#chat').classList.toggle('is-open', open);
  $('#chatBtn').setAttribute('aria-expanded', String(open));
}

function initSocialLinks(root = document) {
  const tg = CONFIG.socials.find(s => s.id === 'telegram');
  $$('[data-social="telegram"], #headerTg', root).forEach(a => { a.href = tg && tg.url ? tg.url : '#'; });
}

function initSocials() {
  const active = CONFIG.socials.filter(s => s.url);
  $('#chatLinks').innerHTML = active.map(s =>
    `<a class="chat__link" href="${s.url}" target="_blank" rel="noopener">${ICONS[s.id] || ''}${escapeHtml(s.label)}</a>`).join('');

  initSocialLinks();

  const chat = $('#chat');
  const onScroll = () => {
    const visible = window.scrollY > 120;
    chat.classList.toggle('is-visible', visible);
    if (!visible) toggleChat(false);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  $('#chatBtn').addEventListener('click', () => toggleChat());
  document.addEventListener('click', e => { if (!e.target.closest('#chat')) toggleChat(false); });
}

/* =====================================================================
   Снег в футере
   ===================================================================== */
/* ---------- спрайты снежинок (рисуются один раз) ---------- */
function makeSprite(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  return c;
}
// мягкий пушистый комок — так выглядит большинство снежинок в полёте
const softFlake = makeSprite(64, (g, s) => {
  const r = s / 2, grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,.85)');
  grad.addColorStop(0.7, 'rgba(240,246,255,.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
});
// расфокусированное хлопье прямо перед «камерой»
const bokehFlake = makeSprite(64, (g, s) => {
  const r = s / 2, grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,.55)');
  grad.addColorStop(0.6, 'rgba(235,242,255,.35)');
  grad.addColorStop(0.85, 'rgba(255,255,255,.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
});
// шестилучевой кристалл с веточками
function crystalSprite(seed) {
  return makeSprite(96, (g, s) => {
    const r = s / 2;
    g.translate(r, r);
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.lineCap = 'round';
    g.shadowColor = 'rgba(200,225,255,.9)';
    g.shadowBlur = 4;
    const arm = r * 0.8, branches = 2 + (seed % 2);
    for (let k = 0; k < 6; k++) {
      g.save();
      g.rotate(k * Math.PI / 3);
      g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -arm); g.stroke();
      g.lineWidth = 1.8;
      for (let j = 1; j <= branches; j++) {
        const y = -arm * (0.3 + j * 0.55 / branches);
        const len = arm * (0.34 - j * 0.07) * (seed % 3 === 0 ? 1.2 : 1);
        g.beginPath();
        g.moveTo(0, y); g.lineTo(-len * 0.8, y - len * 0.6);
        g.moveTo(0, y); g.lineTo(len * 0.8, y - len * 0.6);
        g.stroke();
      }
      g.restore();
    }
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(0, 0, 3, 0, Math.PI * 2); g.fill();
  });
}
const crystals = [0, 1, 2, 3].map(crystalSprite);

function startSnow(canvas, area, density = 1) {
  const ctx = canvas.getContext('2d');
  let flakes = [], w = 0, h = 0, running = false, raf = 0, last = 0, time = 0;

  // z — глубина: 0 далеко (мелкие, медленные, тусклые), 1 у самой «камеры»
  const makeFlake = anywhere => {
    const z = Math.pow(Math.random(), 1.6);   // дальних больше, чем ближних
    const f = {
      z,
      x: Math.random() * (w + 200) - 100,
      y: anywhere ? Math.random() * h : -20 - Math.random() * 40,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.6 + Math.random() * 1.2,
      swayAmp: 6 + z * 22,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 1.4,
      flutter: Math.random() * Math.PI * 2,
    };
    if (z > 0.94) {                                   // крупное размытое хлопье
      f.sprite = bokehFlake; f.size = 18 + Math.random() * 22;
      f.alpha = 0.18 + Math.random() * 0.2; f.speed = 70 + Math.random() * 40;
    } else if (z > 0.6 && Math.random() < 0.35) {    // кристалл на ближнем плане
      f.sprite = crystals[(Math.random() * crystals.length) | 0];
      f.size = 12 + z * 16; f.alpha = 0.75 + Math.random() * 0.25;
      f.speed = 38 + z * 40; f.crystal = true;
    } else {                                          // обычные мягкие хлопья
      f.sprite = softFlake; f.size = 2.5 + z * z * 12;
      f.alpha = 0.3 + z * 0.65; f.speed = 16 + z * 60 + Math.random() * 10;
    }
    return f;
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(320, w * h / 3800) * density);
    flakes = Array.from({ length: count }, () => makeFlake(true));
  };

  const draw = dt => {
    time += dt;
    // ветер: медленная смена направления + редкие порывы
    const wind = Math.sin(time * 0.13) * 18 + Math.sin(time * 0.37 + 1.3) * 10
               + Math.max(0, Math.sin(time * 0.05)) ** 8 * 55;
    ctx.clearRect(0, 0, w, h);
    for (const f of flakes) {
      f.sway += f.swaySpeed * dt;
      f.y += f.speed * dt;
      f.x += (wind * (0.35 + f.z) + Math.cos(f.sway) * f.swayAmp * 0.9) * dt;
      if (f.y > h + 30 || f.x < -120 || f.x > w + 120) {
        Object.assign(f, makeFlake(false));
        f.x = Math.random() * (w + 160) - 80 - wind * 2;   // при ветре подсыпаем с наветренной стороны
        continue;
      }
      ctx.globalAlpha = f.alpha;
      const s = f.size;
      if (f.crystal) {
        f.rot += f.rotSpeed * dt;
        f.flutter += dt * 2.2;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(f.flutter)));   // кувыркается в полёте
        ctx.drawImage(f.sprite, -s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        ctx.drawImage(f.sprite, f.x - s / 2, f.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  };

  const loop = t => {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016;
    last = t;
    draw(dt);
    raf = requestAnimationFrame(loop);
  };

  resize();
  window.addEventListener('resize', resize);
  if (reducedMotion) { draw(0); return; }

  // крутим анимацию, только когда блок на экране
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !running) { running = true; last = 0; raf = requestAnimationFrame(loop); }
    else if (!entry.isIntersecting && running) { running = false; cancelAnimationFrame(raf); }
  }).observe(area);
}

/* ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  $('#year').textContent = new Date().getFullYear();
  initTicker();
  initHeader();
  initHero();
  initViewer();
  initSizes();
  initLayers();
  initCart();
  initCatalog();
  initCatalogPage();
  initProductPage();
  initOrderForm();
  initSearch();
  initSocials();
  startSnow($('#snow'), $('#footer'));
  fixLocalLinks();
});
