"""Find where the original square Pal portrait sits inside an edited frame.

The image model returns a wider frame (1280x720) around a 512 square master,
and it may zoom: the Pal can come back larger than it was. So the edit cannot
be laid over the original until we know the square (x, y, size) in the edit
that, scaled to the original's size, matches it best. The edit is padded so
that square may run past its edges, and the match is scored on the face (the
middle band, eyes and nose), which is where the mouth overlay must line up.

Run: python3 scripts/pubpal/align_edit.py ORIGINAL.png EDITED.png OUT.png
Writes the aligned square crop of the edit, at the original's size, and prints
the crop and its mean difference (0-255) over the scored region.
"""

import sys

import numpy as np
from PIL import Image, ImageOps

original_path, edited_path, out_path = sys.argv[1:4]
original = Image.open(original_path).convert("RGB")
edited = Image.open(edited_path).convert("RGB")
side = original.width

PAD = max(edited.size) // 2
padded = ImageOps.expand(edited, border=PAD, fill=(0, 0, 0))
W, H = padded.size

SMALL = 96
target = np.asarray(original.convert("L").resize((SMALL, SMALL), Image.BILINEAR), dtype=np.float32)
# The face: rows 20%-62%, columns 22%-78%.
rows = slice(int(SMALL * 0.20), int(SMALL * 0.62))
cols = slice(int(SMALL * 0.22), int(SMALL * 0.78))
gray = padded.convert("L")


def score(x, y, size):
    crop = gray.crop((x, y, x + size, y + size)).resize((SMALL, SMALL), Image.BILINEAR)
    diff = np.abs(np.asarray(crop, dtype=np.float32)[rows, cols] - target[rows, cols])
    return float(diff.mean())


short = min(edited.size)
best = None
for size in range(int(short * 0.5), int(short * 1.3) + 1, 12):
    for y in range(PAD - size // 2, PAD + edited.height - size // 2, 12):
        for x in range(PAD - size // 2, PAD + edited.width - size // 2, 12):
            s = score(x, y, size)
            if best is None or s < best[0]:
                best = (s, x, y, size)
for step in (4, 1):
    _, bx, by, bsize = best
    span = step * 4
    for size in range(bsize - span, bsize + span + 1, step):
        for y in range(by - span, by + span + 1, step):
            for x in range(bx - span, bx + span + 1, step):
                s = score(x, y, size)
                if s < best[0]:
                    best = (s, x, y, size)

s, x, y, size = best
padded.crop((x, y, x + size, y + size)).resize((side, side), Image.LANCZOS).save(out_path)
print(f"crop x={x - PAD} y={y - PAD} size={size} diff={s:.2f}")
