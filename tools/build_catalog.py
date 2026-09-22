#!/usr/bin/env python3
"""
Сборка каталога Coulair Club.

Каждый товар — папка в catalog/:
    catalog/<адрес-товара>/товар.txt   — название, цена, размер, описание
    catalog/<адрес-товара>/1.jpg, 2.jpg … — фото (первое — главное)

Запуск из корня сайта:
    python3 tools/build_catalog.py

Скрипт создаёт:
    catalog/catalog.js              — данные для карточек, поиска и корзины
    catalog/index.html              — страница «Каталог»
    catalog/<адрес-товара>/index.html — страница товара
Шапка, футер и окна (корзина, заявка, поиск) берутся из index.html,
поэтому на всех страницах они одинаковые.
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'catalog'
SITE_URL = 'https://coulair.ru/'

TYPES = {'шлем': 'helmet', 'шлемы': 'helmet', 'ботинки': 'boots', 'ботинок': 'boots',
         'штаны': 'pants', 'брюки': 'pants', 'аксессуар': 'other', 'аксессуары': 'other'}
TYPE_LABELS = {'helmet': 'Шлемы', 'boots': 'Ботинки', 'pants': 'Штаны', 'other': 'Аксессуары'}
IMAGE_RE = re.compile(r'^(\d+)\.(jpe?g|png|webp)$', re.I)

esc = html.escape


def rub(n):
    return f'{n:,}'.replace(',', ' ') + ' ₽'


def to_int(v):
    v = re.sub(r'[^\d]', '', v or '')
    return int(v) if v else None


def parse_product(folder: Path):
    text = (folder / 'товар.txt').read_text(encoding='utf-8')
    head, _, body = text.partition('\n---')
    meta, features, key = {}, [], None
    for line in head.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if line.lstrip().startswith('- ') and key == 'особенности':
            features.append(line.strip()[2:].strip())
            continue
        k, sep, v = line.partition(':')
        if not sep:
            continue
        key = k.strip().lower()
        meta[key] = v.strip()

    images = sorted((f for f in folder.iterdir() if IMAGE_RE.match(f.name)),
                    key=lambda f: int(IMAGE_RE.match(f.name).group(1)))
    if not images:
        sys.exit(f'В папке {folder.name} нет фото (ожидаются 1.jpg, 2.jpg …)')
    if 'название' not in meta or to_int(meta.get('цена')) is None:
        sys.exit(f'В {folder.name}/товар.txt обязательны «название» и «цена»')

    slug = folder.name
    paragraphs = [p.strip() for p in body.strip().split('\n\n') if p.strip()]
    return {
        'id': slug,
        'type': TYPES.get(meta.get('тип', '').lower(), 'other'),
        'name': meta['название'],
        'brand': meta.get('бренд', ''),
        'price': to_int(meta.get('цена')),
        'oldPrice': to_int(meta.get('старая цена')),
        'size': meta.get('размер', ''),
        'condition': meta.get('состояние', ''),
        'badge': meta.get('бейдж', ''),
        'stock': to_int(meta.get('в наличии')),
        'features': features,
        'description': paragraphs,
        'images': [f'catalog/{slug}/{f.name}' for f in images],
        'url': f'catalog/{slug}/',
    }


# ---------- общие части страниц из index.html ----------
def site_chrome():
    src = (ROOT / 'index.html').read_text(encoding='utf-8')
    head = src[:src.index('</head>')]
    top = src[src.index('  <!-- ========== Бегущая строка'):src.index('  <main id="top">')]
    bottom = src[src.index('  <!-- ========== Футер со снегом'):src.index('  <script src="catalog/catalog.js">')]
    return head, top, bottom


def page(head, top, bottom, *, base, title, description, main, extra_head=''):
    h = head
    h = h.replace('<meta charset="UTF-8">', f'<meta charset="UTF-8">\n  <base href="{base}">', 1)
    h = re.sub(r'<title>.*?</title>', f'<title>{esc(title)}</title>', h, flags=re.S)
    h = re.sub(r'<meta name="description" content=".*?">',
               f'<meta name="description" content="{esc(description)}">', h, flags=re.S)
    return (f'{h}{extra_head}</head>\n<body class="page-sub">\n\n{top}{main}\n\n{bottom}'
            '  <script src="catalog/catalog.js"></script>\n  <script src="js/main.js"></script>\n'
            '</body>\n</html>\n')


def crumbs(items):
    parts = []
    for label, href in items:
        parts.append(f'<a href="{href}">{esc(label)}</a>' if href else f'<span aria-current="page">{esc(label)}</span>')
    return '<nav class="crumbs" aria-label="Навигация">' + '<span class="crumbs__sep">/</span>'.join(parts) + '</nav>'


def product_main(p):
    slides = ''.join(f'''
            <figure class="gallery__slide">
              <img class="gallery__bg" src="{src}" alt="" aria-hidden="true">
              <img class="gallery__img" src="{src}" alt="{esc(p['name'])} — фото {i + 1}"{' loading="lazy"' if i else ''} draggable="false">
            </figure>''' for i, src in enumerate(p['images']))
    thumbs = ''.join(f'''
          <button class="gallery__thumb{' is-active' if i == 0 else ''}" data-slide="{i}" aria-label="Фото {i + 1}">
            <img src="{src}" alt="" loading="lazy">
          </button>''' for i, src in enumerate(p['images']))
    features = ''.join(f'<li>{esc(f)}</li>' for f in p['features'])
    desc = ''.join(f'<p>{esc(t)}</p>' for t in p['description'])
    old = (f'<s class="price__old">{rub(p["oldPrice"])}</s>'
           f'<span class="price__tag">−{round((1 - p["price"] / p["oldPrice"]) * 100)}%</span>') if p['oldPrice'] else ''
    specs = [('Бренд', p['brand']), ('Размер', p['size']), ('Состояние', p['condition']),
             ('Категория', TYPE_LABELS.get(p['type'], ''))]
    specs_html = ''.join(f'<div class="specs__row"><dt>{k}</dt><dd>{esc(v)}</dd></div>' for k, v in specs if v)
    stock = p['stock']
    stock_text = 'Единственный экземпляр' if stock == 1 else (f'В наличии: {stock} шт.' if stock else 'В наличии')
    type_label = TYPE_LABELS.get(p['type'], 'Каталог')

    return f'''  <main class="pdp" id="top" data-product="{p['id']}">
    <div class="container">
      {crumbs([('Главная', './'), ('Каталог', 'catalog/'), (type_label, f'catalog/?type={p["type"]}'), (p['name'], None)])}

      <div class="pdp__grid">
        <div class="gallery" id="gallery">
          <div class="gallery__main">
            <div class="gallery__track" id="galleryTrack">{slides}
            </div>
            <button class="gallery__arrow gallery__arrow--prev" data-dir="-1" aria-label="Предыдущее фото">
              <svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>
            </button>
            <button class="gallery__arrow gallery__arrow--next" data-dir="1" aria-label="Следующее фото">
              <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
            </button>
            <span class="gallery__counter" id="galleryCounter">1 / {len(p['images'])}</span>
            <button class="gallery__zoom" id="galleryZoom" aria-label="Открыть фото на весь экран">
              <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
            </button>
          </div>
          <div class="gallery__thumbs">{thumbs}
          </div>
        </div>

        <div class="pdp__info">
          {f'<p class="eyebrow">{esc(p["brand"])}</p>' if p['brand'] else ''}
          <h1 class="pdp__title">{esc(p['name'])}</h1>
          <div class="pdp__badges">
            {f'<span class="badge">{esc(p["badge"])}</span>' if p['badge'] else ''}
            <span class="badge badge--stock">{stock_text}</span>
          </div>

          <div class="price">
            <span class="price__new">{rub(p['price'])}</span>{old}
          </div>

          {f"""<div class="sizes">
            <p class="sizes__label">Размер</p>
            <div class="sizes__list"><span class="size size--static" aria-checked="true">{esc(p['size'])}</span></div>
          </div>""" if p['size'] else ''}

          <div class="pdp__actions">
            <button class="btn btn--dark" id="pdpOrder">Заказать</button>
            <button class="btn btn--outline" id="pdpCart">В корзину</button>
          </div>

          <ul class="perks">
            <li>Бесплатная доставка по РФ от 2 позиций</li>
            <li>Отправка в день заказа или на следующий</li>
            <li>Ответим в Telegram в течение часа</li>
          </ul>

          <div class="acc">
            <details open>
              <summary>Описание</summary>
              <div class="acc__body">{desc}</div>
            </details>
            <details{' open' if features else ''}>
              <summary>Характеристики</summary>
              <div class="acc__body">
                <dl class="specs">{specs_html}</dl>
                {f'<ul class="acc__list">{features}</ul>' if features else ''}
              </div>
            </details>
            <details>
              <summary>Доставка и оплата</summary>
              <div class="acc__body">
                <p>Отправляем СДЭК, Почтой России, Boxberry, Яндекс Доставкой и 5Post — в день заказа или на следующий. Упакуем надёжно, чтобы вещь доехала в целости.</p>
                <p>При заказе двух позиций доставка по России бесплатная.</p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>

    <section class="catalog related" id="related" hidden>
      <div class="catalog__head">
        <h2 class="catalog__title">Смотрите также</h2>
        <div class="catalog__arrows"><a class="catalog__all" href="catalog/">Весь каталог</a></div>
      </div>
      <div class="catalog__track" id="relatedTrack"></div>
    </section>
  </main>

  <!-- Просмотр фото на весь экран -->
  <div class="lightbox" id="lightbox" hidden>
    <button class="icon-btn lightbox__close" data-close aria-label="Закрыть">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
    <div class="lightbox__track" id="lightboxTrack">{''.join(f'<figure class="lightbox__slide"><img src="{src}" alt="" loading="lazy"></figure>' for src in p['images'])}</div>
    <button class="gallery__arrow gallery__arrow--prev" data-dir="-1" aria-label="Предыдущее фото"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>
    <button class="gallery__arrow gallery__arrow--next" data-dir="1" aria-label="Следующее фото"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button>
    <span class="gallery__counter" id="lightboxCounter"></span>
  </div>
'''


def product_head(p):
    ld = {
        '@context': 'https://schema.org', '@type': 'Product',
        'name': p['name'], 'image': [SITE_URL + i for i in p['images']],
        'description': ' '.join(p['description'])[:500],
        'brand': {'@type': 'Brand', 'name': p['brand'].split('·')[0].strip()} if p['brand'] else None,
        'offers': {'@type': 'Offer', 'priceCurrency': 'RUB', 'price': p['price'],
                   'availability': 'https://schema.org/InStock' if (p['stock'] or 1) > 0 else 'https://schema.org/OutOfStock',
                   'itemCondition': 'https://schema.org/UsedCondition' if 'б/у' in p['badge'].lower() else 'https://schema.org/NewCondition',
                   'url': SITE_URL + p['url']},
    }
    ld = {k: v for k, v in ld.items() if v}
    return (f'  <meta property="og:type" content="product">\n'
            f'  <meta property="og:title" content="{esc(p["name"])} — {rub(p["price"])}">\n'
            f'  <meta property="og:image" content="{SITE_URL}{p["images"][0]}">\n'
            f'  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>\n')


def catalog_main():
    return f'''  <main class="catalog-page" id="top">
    <div class="container">
      {crumbs([('Главная', './'), ('Каталог', None)])}
      <h1 class="page-title" id="catalogPageTitle">Каталог</h1>
      <div class="tabs" id="catalogTabs" role="tablist"></div>
      <div class="grid" id="catalogGrid"></div>
    </div>
  </main>
'''


def main():
    folders = sorted(f for f in CATALOG.iterdir() if f.is_dir() and (f / 'товар.txt').exists())
    products = [parse_product(f) for f in folders]
    head, top, bottom = site_chrome()

    (CATALOG / 'catalog.js').write_text(
        '/* Создаётся автоматически: python3 tools/build_catalog.py — руками не править */\n'
        'window.CATALOG = ' + json.dumps(products, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')

    (CATALOG / 'index.html').write_text(page(
        head, top, bottom, base='../', title='Каталог — Coulair Club',
        description='Горнолыжные шлемы, ботинки и штаны Coulair Club. Доставка по России.',
        main=catalog_main()), encoding='utf-8')

    for p in products:
        (CATALOG / p['id'] / 'index.html').write_text(page(
            head, top, bottom, base='../../', title=f'{p["name"]} — {rub(p["price"])} · Coulair Club',
            description=(p['description'][0] if p['description'] else p['name'])[:160],
            main=product_main(p), extra_head=product_head(p)), encoding='utf-8')
        print(f'  ✓ {p["name"]} — {rub(p["price"])}, фото: {len(p["images"])}  →  catalog/{p["id"]}/')
    print(f'Готово: товаров {len(products)}')


if __name__ == '__main__':
    main()
