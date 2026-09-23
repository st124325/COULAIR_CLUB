#!/usr/bin/env python3
"""
Проставляет версию (?v=…) к css/js во всех html собранного сайта, чтобы после
обновления браузеры сразу брали свежие файлы, а не копии из кэша.
Запускается в GitHub Actions после сборки:  python tools/stamp_assets.py _site
"""
import hashlib
import re
import sys
from pathlib import Path

site = Path(sys.argv[1] if len(sys.argv) > 1 else '_site')
assets = ['css/style.css', 'css/game.css', 'js/main.js', 'js/game.js', 'js/game3d.js', 'catalog/catalog.js']
h = hashlib.sha1()
for a in assets:
    f = site / a
    if f.exists():
        h.update(f.read_bytes())
version = h.hexdigest()[:10]

pattern = re.compile(r'(\b(?:src|href)=")(' + '|'.join(re.escape(a) for a in assets) + r')(")')
count = 0
for page in site.rglob('*.html'):
    text = page.read_text(encoding='utf-8')
    new, n = pattern.subn(rf'\g<1>\g<2>?v={version}\g<3>', text)
    if n:
        page.write_text(new, encoding='utf-8')
        count += 1
print(f'Версия файлов {version} проставлена в {count} страниц')
