"""Extract the approved reference-sheet artwork; do not generate a map image."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / 'docs/art-direction/2026-11-buildings'
OUTPUT = ROOT / 'assets/scenery'
OUTPUT.mkdir(parents=True, exist_ok=True)
SHEETS = {
    'buildings-reference.png': {
        'hq': (30, 112, 502, 494), 'barracks': (536, 180, 985, 493),
        'workshop': (1038, 117, 1503, 495), 'mine': (35, 575, 495, 925),
        'fort': (570, 594, 985, 929), 'round-fort': (1055, 601, 1500, 933),
    },
    'terrain-reference.png': {
        'peak': (31, 143, 477, 335), 'ridge': (498, 175, 1009, 331),
        'mountains': (1022, 97, 1515, 336), 'hills': (24, 424, 497, 615),
        'rocks': (518, 420, 1007, 615), 'pines': (1019, 383, 1517, 615),
        'trees': (15, 692, 496, 946), 'coast': (507, 714, 1014, 949),
        'stream': (1027, 721, 1517, 951),
    },
}

manifest = {}
for sheet, crops in SHEETS.items():
    source = Image.open(SOURCE / sheet).convert('RGB')
    for name, box in crops.items():
        rgb = np.asarray(source.crop(box), dtype=np.float32)
        height, width = rgb.shape[:2]
        corners = [np.median(patch.reshape(-1, 3), axis=0) for patch in
                   [rgb[:12, :12], rgb[:12, -12:], rgb[-12:, :12], rgb[-12:, -12:]]]
        x = np.linspace(0, 1, width)[None, :, None]
        y = np.linspace(0, 1, height)[:, None, None]
        background = (corners[0] * (1-x) + corners[1] * x) * (1-y) + (corners[2] * (1-x) + corners[3] * x) * y
        distance = np.linalg.norm(rgb - background, axis=2)
        # Only remove background reachable from the sheet edge, preserving pale details inside objects.
        eligible = np.pad((distance < (30 if sheet.startswith('buildings') else 23)).astype('uint8') * 255, 1, constant_values=255)
        flood = Image.fromarray(eligible).copy()
        ImageDraw.floodfill(flood, (0, 0), 128)
        outside = np.asarray(flood)[1:-1, 1:-1] == 128
        alpha = Image.fromarray(np.where(outside, 0, 255).astype('uint8')).filter(ImageFilter.GaussianBlur(.55))
        assert np.count_nonzero(outside) > width * height * .03, f'{name}: sheet background was not removed'
        result = Image.fromarray(rgb.astype('uint8')).convert('RGBA')
        result.putalpha(alpha)
        bounds = alpha.getbbox()
        assert bounds and np.count_nonzero(np.asarray(alpha) > 127) > width * height * .04, name
        result = result.crop(bounds)
        result.save(OUTPUT / f'{name}.png')
        manifest[name] = {'sheet': sheet, 'crop': box, 'trim': bounds, 'size': result.size}
        print(name, result.size)
(OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
