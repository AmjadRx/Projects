"""
The site's font files and their stylesheet, made from the full files in app/fonts/ (both fonts are
SIL OFL 1.1 with no Reserved Font Name, so subsets may be made and served; licenses/ says so).

The full files stay in app/fonts/ unchanged: the Open Graph images (lib/og/fonts.ts) draw from
Archivo-Variable.woff2 and B612Mono-Regular.woff2 at build time, and this script reads all three.
No page loads them.

It writes:
- public/fonts/<face>-<part>.<hash>.woff2: for each face two files, split by Unicode range:
  `core`, the characters the pages use (Basic Latin, the Latin-1 signs and punctuation, General
  Punctuation, and the few symbols in CORE below), and `ext`, every other character of the full
  file, which a browser fetches only when some text holds one (unicode-range), so a word typed in
  the admin never loses a glyph. The hash (the first 10 hex digits of the file's SHA-256) names
  each version, so the files can be cached for good (next.config.mjs);
- app/fonts.css: the @font-face rules for those files (font-display swap, each with its
  unicode-range), the variables tokens.css reads (--font-archivo, --font-b612-mono), and the
  fallback faces (FALLBACKS below);
- lib/fontFiles.ts: the files app/layout.tsx preloads (PRELOAD below): Archivo's core file and
  B612 Mono's regular core file, which first views set text in.

Archivo keeps its whole weight axis (100 to 900; the stylesheets set 400 to 700, and `bolder`
inside text set at 600 or more asks for 900) and the part of its width axis the stylesheets use,
100 to 125 (font-variation-settings and font-stretch set 100, 112, 118 and 125): the variations
toward the narrow widths (62 to 100) are dropped, and nothing else in the file is recomputed, so
every glyph draws exactly as in the full file at every width from 100 to 125 (fontTools' instancer
would also limit the axis, but it rounds the deltas it re-encodes, which moves outlines by up to
half a unit). Each file keeps only the OpenType features a page can turn on: the ones Chrome applies
by default to Latin text, and tnum (font-variant-numeric: tabular-nums). Hinting, where the full
file has it (B612 Mono), is kept.

Run it again after changing a source file, CORE, FEATURES, PRELOAD or FALLBACKS
(tests/fonts-subset.test.ts checks the files and the stylesheet against each other):

    py -3 -m venv <a folder outside the repository>
    <that folder>/Scripts/python -m pip install fonttools==4.68.0 brotli==1.2.1
    <that folder>/Scripts/python scripts/subset-fonts.py

(On macOS or Linux: python3 -m venv, and <folder>/bin/python.) The same inputs and tool versions
give the same bytes.
"""

import hashlib
import io
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'app', 'fonts')
OUT = os.path.join(ROOT, 'public', 'fonts')
URL = '/fonts/'
CSS = os.path.join(ROOT, 'app', 'fonts.css')
TS = os.path.join(ROOT, 'lib', 'fontFiles.ts')

# The characters the site's pages use, and the common English typography around them.
CORE = [
    (0x0000, 0x007E),  # Basic Latin (with the control characters a file maps, such as a carriage return)
    (0x00A0, 0x00BF),  # Latin-1 signs and punctuation: no-break space, copyright, degree, middle dot
    (0x00D7, 0x00D7),  # multiplication sign
    (0x00F7, 0x00F7),  # division sign
    (0x2000, 0x206F),  # General Punctuation: spaces, quotation marks, bullets, ellipsis, primes
    (0x20AC, 0x20AC),  # euro sign
    (0x2122, 0x2122),  # trade mark sign
    (0x2190, 0x2193),  # the four arrows (the command palette's key hints use two)
    (0x2212, 0x2212),  # minus sign
    (0x2248, 0x2248),  # almost equal to
    (0x2264, 0x2265),  # less than or equal to, greater than or equal to
    (0xFEFF, 0xFEFF),  # zero width no-break space
]

# The OpenType features Chrome applies to horizontal Latin text by default, and tnum.
FEATURES = ['abvm', 'blwm', 'calt', 'ccmp', 'clig', 'curs', 'dist', 'kern', 'liga', 'locl', 'mark', 'mkmk', 'rclt', 'rlig', 'rvrn', 'tnum']

# Archivo's width axis keeps 100 (its default) to 125.
WDTH_MIN = 100.0

# (source file, file name, family, CSS descriptors, whether to drop the narrow widths)
FACES = [
    ('Archivo-Variable.woff2', 'archivo', 'Archivo Site', 'font-weight: 100 900; font-stretch: 100% 125%;', True),
    ('B612Mono-Regular.woff2', 'b612-mono-regular', 'B612 Mono Site', 'font-weight: 400;', False),
    ('B612Mono-Bold.woff2', 'b612-mono-bold', 'B612 Mono Site', 'font-weight: 700;', False),
]

# The files every page preloads: first views set text in both.
PRELOAD = ['archivo-core', 'b612-mono-regular-core']

# The fallback faces: local fonts sized so text set in them takes Archivo's and B612 Mono's room.
# Archivo: Arial (regular below weight 550, bold from 550), two faces for each width the stylesheets
# set and each weight band. The zero (U+30) has a face of its own, sized so Arial's zero is as wide
# as Archivo's: a browser takes the ch unit from the zero, and the stylesheets set measures in ch
# (--measure is 68ch), so a box sized in ch keeps its width when the font swaps. The other face's
# size-adjust is Archivo's width over Arial's on every content string (about 29,000 characters), the
# zeros counted at their own size. Both measured in Chrome. Ascent and descent are Archivo's (0.878
# and 0.210 em), divided by size-adjust, which scales them too. B612 Mono: its 0.65 em advance over
# Courier New's 0.6 (every character, the zero too), with its ascent and descent as most systems
# read them (hhea: 0.965 and 0.25 em).
ARIAL = 'local("Arial"), local("ArialMT"), local("Liberation Sans"), local("Arimo")'
ARIAL_BOLD = 'local("Arial Bold"), local("Arial-BoldMT"), local("Liberation Sans Bold"), local("Arimo Bold")'
WEIGHT_BANDS = {400: '100 449', 500: '450 549', 600: '550 624', 650: '625 674', 700: '675 900'}
# size-adjust, in percent, by width, then weight band: (every character but the zero, the zero)
ARCHIVO_SIZE = {
    100: {400: (98.62, 103.03), 500: (100.30, 103.21), 600: (95.19, 103.39), 650: (96.82, 105.19), 700: (98.42, 106.99)},
    112: {400: (111.78, 117.41), 500: (113.88, 118.13), 600: (108.31, 119.03), 650: (109.74, 120.47), 700: (111.19, 121.91)},
    118: {400: (118.34, 124.61), 500: (120.65, 125.68), 600: (114.86, 126.94), 650: (116.18, 128.20), 700: (117.53, 129.46)},
    125: {400: (126.04, 133.06), 500: (128.58, 134.50), 600: (122.51, 136.11), 650: (123.76, 137.19), 700: (124.99, 138.27)},
}
ZERO_RANGE, OTHER_RANGE = 'U+30', 'U+0-2F, U+31-10FFFF'
ARCHIVO_ASCENT, ARCHIVO_DESCENT = 87.8, 21.0
MONO_SIZE, MONO_ASCENT, MONO_DESCENT = 108.32, 96.5, 25.0
COURIER = 'local("Courier New"), local("CourierNewPSMT"), local("Liberation Mono"), local("Cousine")'
COURIER_BOLD = 'local("Courier New Bold"), local("CourierNewPS-BoldMT"), local("Liberation Mono Bold"), local("Cousine Bold")'


def in_core(cp):
    return any(lo <= cp <= hi for lo, hi in CORE)


def ranges(cps):
    """Code points as the shortest unicode-range list: U+20-7E, U+A0, ..."""
    out = []
    for cp in sorted(cps):
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return ', '.join(f'U+{lo:X}' if lo == hi else f'U+{lo:X}-{hi:X}' for lo, hi in out)


def drop_narrow_widths(font):
    """
    Limits the wdth axis to WDTH_MIN (the default) and up. With the default at the new minimum,
    every normalized wdth coordinate is 0 or more, so a glyph variation whose region peaks below 0
    never applies; those are removed and every other one is kept as it is. fvar's axis and named
    instances follow. The HVAR, GDEF and avar data for the narrow side stay (they never apply and
    are small).
    """
    axis = next(a for a in font['fvar'].axes if a.axisTag == 'wdth')
    if axis.defaultValue != WDTH_MIN:
        sys.exit(f'wdth default is {axis.defaultValue}, not {WDTH_MIN}: dropping the narrow side would move the default.')
    gvar = font['gvar']
    for glyph in list(gvar.variations.keys()):
        gvar.variations[glyph] = [v for v in gvar.variations[glyph] if not ('wdth' in v.axes and v.axes['wdth'][1] < 0)]
    axis.minValue = WDTH_MIN
    font['fvar'].instances = [i for i in font['fvar'].instances if i.coordinates.get('wdth', WDTH_MIN) >= WDTH_MIN]


def make(source, narrow, unicodes):
    # recalcTimestamp=False keeps the source's own timestamps, so the same inputs give the same bytes.
    font = TTFont(os.path.join(SOURCE, source), recalcTimestamp=False)
    if narrow:
        drop_narrow_widths(font)
    options = subset.Options()
    options.layout_features = FEATURES
    # The copyright and the licence's description and address (name IDs 0, 13 and 14) stay in the file.
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.name_languages = ['*']
    options.notdef_outline = True
    options.hinting = True
    options.flavor = 'woff2'
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=sorted(unicodes))
    subsetter.subset(font)
    font.flavor = 'woff2'
    data = io.BytesIO()
    font.save(data, reorderTables=True)
    return data.getvalue()


def pct(value):
    return f'{value:.2f}%'


def fallback_css():
    lines = []
    for width, bands in ARCHIVO_SIZE.items():
        for weight, sizes in bands.items():
            for size, unicode_range in zip(sizes, (OTHER_RANGE, ZERO_RANGE)):
                lines.append(
                    '@font-face { font-family: "Archivo Fallback"; '
                    f'src: {ARIAL if weight < 550 else ARIAL_BOLD}; font-weight: {WEIGHT_BANDS[weight]}; font-stretch: {width}%; '
                    f'size-adjust: {pct(size)}; ascent-override: {pct(ARCHIVO_ASCENT * 100 / size)}; '
                    f'descent-override: {pct(ARCHIVO_DESCENT * 100 / size)}; line-gap-override: 0%; unicode-range: {unicode_range}; }}'
                )
    for weights, src in (('100 549', COURIER), ('550 900', COURIER_BOLD)):
        lines.append(
            '@font-face { font-family: "B612 Mono Fallback"; '
            f'src: {src}; font-weight: {weights}; size-adjust: {pct(MONO_SIZE)}; '
            f'ascent-override: {pct(MONO_ASCENT * 100 / MONO_SIZE)}; descent-override: {pct(MONO_DESCENT * 100 / MONO_SIZE)}; line-gap-override: 0%; }}'
        )
    return '\n'.join(lines)


CSS_HEAD = """/*
 * The site's fonts. Written by scripts/subset-fonts.py: change that script, not this file.
 *
 * Archivo and B612 Mono (SIL Open Font License 1.1; licenses/), as subsets of the full files in
 * app/fonts/, served from public/fonts/: for each face a core file with every character the pages
 * use and an extended file with the rest, each named by its unicode-range, so a browser fetches a
 * file only for a character in it. app/layout.tsx preloads the core files of Archivo and of B612
 * Mono's regular weight (lib/fontFiles.ts). tokens.css reads --font-archivo and --font-b612-mono.
 *
 * After each face, its fallback: local fonts sized so text set in them takes the room the web font
 * takes, until it arrives, so the swap moves nothing (ARCHITECTURE.md 9: CLS under 0.02). Archivo
 * Fallback is Arial (Liberation Sans or Arimo where Arial is not installed; both have its widths),
 * regular below weight 550 and bold from 550, for each width the stylesheets set (font-stretch
 * 100%, 112%, 118% and 125%, beside font-variation-settings "wdth") and each weight band; size-adjust
 * is Archivo's width over Arial's, measured in Chrome on the site's own text, with a face of its own
 * for the zero, as wide as Archivo's, since the ch unit is the zero's width and the measures are set
 * in ch; the overrides give Arial Archivo's ascent and descent. B612 Mono Fallback is Courier New
 * (Liberation Mono or Cousine elsewhere), scaled to B612 Mono's advance, so each character takes
 * exactly its room. scripts/subset-fonts.py says how they were measured.
 */
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.endswith('.woff2'):
            os.remove(os.path.join(OUT, name))
    faces = []
    files = {}
    for source, name, family, descriptors, narrow in FACES:
        cmap = set(TTFont(os.path.join(SOURCE, source)).getBestCmap())
        core = {cp for cp in cmap if in_core(cp)}
        ext = cmap - core
        for part, cps in (('core', core), ('ext', ext)):
            data = make(source, narrow, cps)
            made = set(TTFont(io.BytesIO(data)).getBestCmap())
            if made != cps:
                sys.exit(f'{name}-{part}: the file maps {len(made)} characters, not the {len(cps)} asked for.')
            file = f'{name}-{part}.{hashlib.sha256(data).hexdigest()[:10]}.woff2'
            with open(os.path.join(OUT, file), 'wb') as handle:
                handle.write(data)
            files[f'{name}-{part}'] = file
            faces.append(
                f'@font-face {{ font-family: "{family}"; src: url("{URL}{file}") format("woff2"); {descriptors} '
                f'font-style: normal; font-display: swap; unicode-range: {ranges(cps)}; }}'
            )
            print(f'{file}: {len(data)} bytes, {len(cps)} characters')
    css = (
        CSS_HEAD
        + '\n'.join(faces[:2])
        + '\n'
        + '\n'.join(faces[2:])
        + '\n\n:root {\n  --font-archivo: "Archivo Site", "Archivo Fallback";\n  --font-b612-mono: "B612 Mono Site", "B612 Mono Fallback";\n}\n\n'
        + fallback_css()
        + '\n'
    )
    with open(CSS, 'w', newline='\n') as handle:
        handle.write(css)
    preloads = ',\n'.join(f"  '{URL}{files[key]}'" for key in PRELOAD)
    ts = (
        '/**\n'
        ' * The font files every page preloads (app/layout.tsx): Archivo\'s core file and B612 Mono\'s regular\n'
        ' * core file, which first views set text in. Written by scripts/subset-fonts.py with the files in\n'
        ' * public/fonts/ and the @font-face rules in app/fonts.css: change that script, not this file.\n'
        ' */\n'
        f'export const FONT_PRELOADS = [\n{preloads},\n] as const;\n'
    )
    with open(TS, 'w', newline='\n') as handle:
        handle.write(ts)


if __name__ == '__main__':
    main()
