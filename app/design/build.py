"""Builds brief.html: inlines ../src/ui/tokens.css into brief.template.html and
injects tokens.meta.json (token -> purpose). Run after any token change:
    python3 app/design/build.py
"""
import json, re, pathlib
S = pathlib.Path(__file__).parent
ROOT = S.parent
tok = (ROOT / 'src/ui/tokens.css').read_text()

def block(name):
    m = re.search(rf'/\* {name}-begin \*/(.*?)/\* {name}-end \*/', tok, re.S)
    return '\n'.join(l.strip() for l in m.group(1).strip().splitlines() if l.strip())

light = block('light'); dark = block('dark')
shared = tok.split('/* light-begin */')[0].split(':root {', 1)[1]
shared = '\n'.join(l for l in shared.splitlines() if l.strip())

css = f""":root, .t-light {{
{shared}
{light}
}}
.t-dark {{
{dark}
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
{dark}
  }}
}}
:root[data-theme="dark"] {{
{dark}
}}
@media (prefers-reduced-motion: reduce) {{
  :root {{ --pal-dur-fast: 0ms; --pal-dur-base: 0ms; --pal-dur-slow: 0ms; }}
}}"""

META = json.loads((S / 'tokens.meta.json').read_text())
names = set(re.findall(r'(--pal-[a-z0-9-]+)\s*:', tok))
missing = names - {n for n, _ in META}; extra = {n for n, _ in META} - names
assert not missing and not extra, (missing, extra)

html = (S / 'brief.template.html').read_text().replace('__TOKENS_CSS__', css).replace('__TOKENS_JSON__', json.dumps(META))
bad = chr(0x2014)
assert bad not in html and bad not in tok
(ROOT / 'design/brief.html').write_text(html)
print('ok', len(html), 'bytes;', len(META), 'tokens')
