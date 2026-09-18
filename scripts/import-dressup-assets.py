"""Reproducibly import approved offline dress-up catalogs, without executing JS.

Requires Pillow, numpy, scipy. Run from any directory:
  python3 scripts/import-dressup-assets.py SOURCE_DIR --output public/static/dressup
  python3 scripts/import-dressup-assets.py SOURCE_DIR --inspect /tmp/dressup-qa

Source contact sheets are converted with measured crops and a border-connected
pale-cyan matte, preserving their artwork. No generative edits/replacements.
C092's source balloon is cut off and overlapped by a caption; omit that strip.
"""
import argparse
import base64
import html
import io
import json
import os
import re
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

REPO = Path(__file__).resolve().parents[1]
COLS = ((14, 364), (370, 722), (728, 1080), (1086, 1437))
# Measured panel bounds, followed by the caption-free artwork Y range.
ROWS = (
    ((90, 390, 136, 389), (402, 713, 451, 712), (724, 1045, 776, 1045)),
    ((91, 403, 137, 403), (413, 725, 461, 725), (737, 1052, 784, 1052)),
    ((99, 415, 148, 415), (426, 741, 478, 741), (751, 1063, 800, 1063)),
    ((88, 414, 88, 369), (426, 738, 426, 688), (747, 1063, 747, 1008)),
    ((86, 409, 137, 409), (416, 731, 465, 731), (738, 1066, 786, 1066)),
    ((88, 401, 134, 401), (409, 727, 459, 727), (734, 1063, 784, 1063)),
    ((95, 395, 143, 395), (406, 727, 456, 727), (736, 1059, 790, 1059)),
    ((88, 401, 141, 401), (412, 727, 464, 727), (736, 1063, 786, 1063)),
    ((123, 432, 170, 432), (439, 749, 491, 749), (757, 1065, 808, 1065)),
    ((100, 412, 150, 412), (419, 730, 469, 730), (738, 1067, 786, 1067)),
)


def image_uri(uri):
    im = Image.open(io.BytesIO(base64.b64decode(uri.split(',', 1)[1])))
    im.load()
    return im.convert('RGBA')


def save_png(im, path):
    """Publish complete PNGs atomically, including on mounted workspaces."""
    encoded = io.BytesIO()
    im.save(encoded, format='PNG', optimize=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.asset-', delete=False) as stream:
        stream.write(encoded.getvalue())
        stream.flush()
        os.fsync(stream.fileno())
        temporary = stream.name
    os.replace(temporary, path)
    Image.open(path).load()


def catalogs(source):
    costume_html = (source / 'mochi-costume-catalog-120.html').read_text()
    sheets = []
    for section in re.findall(r'<section class="theme-card"[\s\S]*?</section>', costume_html):
        category = html.unescape(re.search(r'data-theme-name="([^"]+)"', section)[1])
        uri = re.search(r'<img src="([^"]+)"', section)[1]
        items = re.findall(r'data-id="(\d+)" data-name="([^"]+)"', section)
        assert len(items) == 12, 'A costume sheet must contain exactly 12 designs'
        sheets.append((category, uri, [(n, html.unescape(name)) for n, name in items]))
    background_html = (source / 'mochi-background-catalog-30.html').read_text()
    data_match = re.search(r'\[\{"id":"BG001"[\s\S]*?\}\]', background_html)
    backgrounds = json.loads(data_match[0])
    assert len(sheets) == 10 and len(backgrounds) == 30
    return sheets, backgrounds


def cutout(tile, art_top=0, art_bottom=None, omit_top=0, caption_right=None):
    """Remove exterior cyan, preserving enclosed pale costume details.

    Caption components are excluded by location; isolated artwork details
    (beans, string, sparkles) inside the art area are retained.
    """
    arr = np.asarray(tile).copy()
    rgb = arr[:, :, :3].astype(np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    art_bottom = art_bottom or arr.shape[0]
    bg = (r >= 219) & (g >= 234) & (b >= 237) & (b-r >= 2) & (b-r <= 46) & (b-g >= -2)
    bg |= (r >= 249) & (g >= 249) & (b >= 249)
    # A color match alone would punch holes in pale towels and white hats.
    # Background gradients are smooth; costume outlines/texture provide a
    # barrier that stops the exterior flood even where their colors coincide.
    spread = ndimage.maximum_filter(rgb, size=(3, 3, 1))-ndimage.minimum_filter(rgb, size=(3, 3, 1))
    bg &= np.max(spread, axis=2) <= 5
    yy, xx = np.indices(bg.shape)
    seeds = np.zeros(bg.shape, bool)
    seeds[0] = bg[0]
    seeds[-1] = bg[-1]
    seeds[:, 0] = bg[:, 0]
    seeds[:, -1] = bg[:, -1]
    # Some panel outlines fully enclose their background; seed just inside them.
    seeds |= bg & ((xx < 18) | (xx >= arr.shape[1]-18) | (yy < 18) | (yy >= arr.shape[0]-18))
    exterior = ndimage.binary_propagation(seeds, mask=bg)
    foreground = ~exterior
    # Sheet borders sometimes touch a wide prop and become one component.
    # Strip only their cyan ink near the panel perimeter, not warm mascot fur.
    perimeter = (xx < 8) | (xx >= arr.shape[1]-8) | (yy < 12) | (yy >= arr.shape[0]-8)
    perimeter |= ((xx < 27) | (xx >= arr.shape[1]-27)) & ((yy < 27) | (yy >= arr.shape[0]-27))
    cyan_ink = (r > 155) & (g > 210) & (b > 220) & (b-r > 5) & (b-g >= -2)
    foreground[perimeter & cyan_ink] = False
    if art_top:
        navy_caption = (r < 100) & (g < 155) & (b > 75) & (b > r*1.3) & (yy < art_top)
        if caption_right is not None:
            navy_caption &= xx < caption_right
        foreground[ndimage.binary_dilation(navy_caption, iterations=3) & (yy < art_top)] = False
        # Number pills are cyan and can touch a tall accessory (e.g. the brush).
        index_pill = (r < 80) & (g > 100) & (b > 180) & (xx < 105) & (yy < art_top)
        foreground[ndimage.binary_dilation(index_pill, iterations=3) & (yy < art_top)] = False
    if omit_top:
        foreground[:omit_top] = False
    labels, count = ndimage.label(foreground)
    objects = ndimage.find_objects(labels)
    sizes = np.bincount(labels.ravel())
    center = np.zeros_like(foreground)
    center[max(art_top, arr.shape[0]//3):art_bottom, arr.shape[1]//5:arr.shape[1]*4//5] = True
    central = np.bincount(labels[center].ravel(), minlength=count+1)
    central[0] = 0
    main = int(central.argmax())
    keep = labels == main
    for index, bounds in enumerate(objects, 1):
        if bounds is None or index == main or sizes[index] < 80:
            continue
        ys, xs = bounds
        cy = (ys.start + ys.stop) / 2
        at_border = xs.start < 5 or xs.stop > arr.shape[1]-5
        thin_border = (at_border and (xs.stop-xs.start < 9 or sizes[index] < 1000)) or min(xs.stop-xs.start, ys.stop-ys.start) < 10
        if art_top <= cy < art_bottom and not thin_border and xs.stop-xs.start < arr.shape[1]-5 and ys.stop-ys.start < arr.shape[0]-5:
            keep |= labels == index
    keep[art_bottom:] = False
    alpha = np.asarray(Image.fromarray((keep*255).astype('uint8')).filter(ImageFilter.GaussianBlur(.45))).copy()
    alpha[~ndimage.binary_dilation(keep)] = 0
    arr[:, :, 3] = alpha
    result = Image.fromarray(arr)
    bbox = result.getbbox()
    if not bbox:
        raise ValueError('Empty costume after background removal')
    result = result.crop(bbox)
    canvas = Image.new('RGBA', (384, 384))
    result.thumbnail((368, 350), Image.Resampling.LANCZOS)
    canvas.alpha_composite(result, ((384-result.width)//2, 374-result.height))
    return canvas


def contact_sheet(images, path, cols=6, cell=(200, 222)):
    rows = (len(images)+cols-1)//cols
    sheet = Image.new('RGB', (cols*cell[0], rows*cell[1]), '#d7e6f0')
    draw = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(images):
        x, y = (i % cols)*cell[0], (i // cols)*cell[1]
        draw.rectangle((x+2, y+2, x+cell[0]-3, y+cell[1]-3), fill='#9facbd')
        thumb = im.copy()
        thumb.thumbnail((cell[0]-12, cell[1]-28), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (x+(cell[0]-thumb.width)//2, y+5), thumb if thumb.mode == 'RGBA' else None)
        draw.text((x+10, y+cell[1]-20), name, fill='#152b43')
    save_png(sheet, path)


def write_catalog(items, path):
    defaults = [
        {'id': 'C000', 'name': 'いつものもち', 'kind': 'costume', 'category': '初期', 'imagePath': '/static/dressup/C000.png'},
        {'id': 'BG000', 'name': 'そらいろ', 'kind': 'background', 'category': '初期', 'imagePath': '/static/dressup/BG000.png'},
    ]
    code = '''// Generated by scripts/import-dressup-assets.py from the approved catalogs.
export interface Cosmetic {
  id: string
  name: string
  kind: 'costume' | 'background'
  category: string
  imagePath: string
}
'''
    code += 'export const DEFAULT_COSTUME: Cosmetic = '+json.dumps(defaults[0], ensure_ascii=False)+'\n'
    code += 'export const DEFAULT_BACKGROUND: Cosmetic = '+json.dumps(defaults[1], ensure_ascii=False)+'\n'
    code += 'export const COSMETICS: readonly Cosmetic[] = '+json.dumps(items, ensure_ascii=False, indent=2)+'\n'
    code += '''
const byId = new Map<string, Cosmetic>(
  [DEFAULT_COSTUME, DEFAULT_BACKGROUND, ...COSMETICS].map(item => [item.id, item]),
)
export function getCosmetic(id: string): Cosmetic | undefined {
  return byId.get(id)
}
'''
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(code)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=REPO/'public/static/dressup')
    parser.add_argument('--catalog', type=Path, default=REPO/'src/features/dressup/catalog.ts')
    parser.add_argument('--inspect', type=Path, help='Optional source/QA contact sheets; outside the repo recommended')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.inspect:
        args.inspect.mkdir(parents=True, exist_ok=True)
    sheets, backgrounds = catalogs(args.source)
    items, costumes, scenes = [], [], []
    for si, (category, uri, source_items) in enumerate(sheets):
        sheet = image_uri(uri)
        if sheet.size != (1448, 1086):
            raise ValueError(f'Unexpected costume sheet dimensions: {sheet.size}')
        if args.inspect:
            save_png(sheet, args.inspect/f'sheet-{si+1:02}.png')
        for j, (number, name) in enumerate(source_items):
            cid = f'C{int(number):03}'
            x0, x1 = COLS[j % 4]
            y0, y1, top, bottom = ROWS[si][j//4]
            tile = sheet.crop((x0, y0, x1, y1))
            sprite = cutout(tile, top-y0, bottom-y0, 50 if cid == 'C092' else 0, 250 if cid == 'C091' else None)
            save_png(sprite, args.output/f'{cid}.png')
            costumes.append((cid, sprite))
            items.append({'id': cid, 'name': name, 'kind': 'costume', 'category': category, 'imagePath': f'/static/dressup/{cid}.png'})
    for entry in backgrounds:
        bid, name = entry['id'], entry['name']
        bg = image_uri(entry['uri'])
        bg.thumbnail((768, 512), Image.Resampling.LANCZOS)
        save_png(bg.convert('RGB'), args.output/f'{bid}.png')
        scenes.append((bid, bg))
        items.append({'id': bid, 'name': name, 'kind': 'background', 'category': entry.get('category', '背景'), 'imagePath': f'/static/dressup/{bid}.png'})
    default = cutout(Image.open(REPO/'public/static/happamochi-e061df69.jpg').convert('RGBA'))
    save_png(default, args.output/'C000.png')
    sky = np.zeros((512, 768, 3), dtype=np.uint8)
    for y in range(512):
        t = y/511
        sky[y, :, :] = np.array([226, 246, 255])*(1-t)+np.array([246, 253, 255])*t
    save_png(Image.fromarray(sky), args.output/'BG000.png')
    preview = Image.new('RGBA', (768, 440), '#ffffff')
    for i, cid in enumerate(('C001', 'C038', 'C049', 'C061', 'C076')):
        im = dict(costumes)[cid].copy()
        im.thumbnail((218, 210), Image.Resampling.LANCZOS)
        x = (54+i*226) if i < 3 else (166+(i-3)*226)
        preview.alpha_composite(im, (x, 4 if i < 3 else 224))
    save_png(preview.convert('RGB'), args.output/'gacha-preview.png')
    assert len(items) == 150 and len({item['id'] for item in items}) == 150
    write_catalog(items, args.catalog)
    if args.inspect:
        for i in range(10):
            contact_sheet(costumes[i*12:(i+1)*12], args.inspect/f'cutouts-{i+1:02}.png', 4, (260, 282))
        contact_sheet(scenes, args.inspect/'backgrounds.png', 5, (256, 195))
        contact_sheet([('C000', default)], args.inspect/'default.png', 1, (400, 422))
    print(json.dumps({'costumes': len(costumes), 'backgrounds': len(scenes), 'assets': str(args.output), 'catalog': str(args.catalog)}))


if __name__ == '__main__':
    main()
