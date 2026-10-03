#!/usr/bin/env python3
"""Build assets/carts/catalog.json from local Carts images.

Source PNGs are read only. Sprites stay inside their sheets and are
described with rectangles. Reference sheets, palettes, and the cart
registry folder are not offered as map tiles.
"""

import hashlib
import json
import os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BASE = os.path.join(ROOT, "assets", "carts")
OUT = os.path.join(BASE, "catalog.json")

SKIP_DIR = {"carts"}
SKIP_NAME = {
    "arrow_up.png",
    "harvest-bg.png",
    "titel.png",
    "text.png",
}


def rel_of(path):
    return os.path.relpath(path, BASE).replace(os.sep, "/")


def skip_file(rel):
    name = os.path.basename(rel).lower()
    folder = rel.split("/")[0] if "/" in rel else ""
    if folder in SKIP_DIR:
        return True
    if name in SKIP_NAME:
        return True
    hay = rel.lower()
    for word in ("bitmask", "palette", "pallet", "readme", "read_me", "reference", "license", "aseprite"):
        if word in hay:
            return True
    return False


def islands(im, min_side=8):
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    seen = bytearray(w * h)
    found = []
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if seen[i] or px[x, y][3] <= 12:
                continue
            stack = [(x, y)]
            seen[i] = 1
            minx = maxx = x
            miny = maxy = y
            while stack:
                cx, cy = stack.pop()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    j = ny * w + nx
                    if seen[j] or px[nx, ny][3] <= 12:
                        continue
                    seen[j] = 1
                    stack.append((nx, ny))
                    if nx < minx:
                        minx = nx
                    if nx > maxx:
                        maxx = nx
                    if ny < miny:
                        miny = ny
                    if ny > maxy:
                        maxy = ny
            bw, bh = maxx - minx + 1, maxy - miny + 1
            if bw >= min_side and bh >= min_side:
                found.append((minx, miny, bw, bh))
    return found


def merge_boxes(boxes, pad=3):
    items = [list(box) for box in boxes]
    changed = True
    while changed:
        changed = False
        next_items = []
        used = [False] * len(items)
        for i, a in enumerate(items):
            if used[i]:
                continue
            ax, ay, aw, ah = a
            for j in range(i + 1, len(items)):
                if used[j]:
                    continue
                bx, by, bw, bh = items[j]
                if ax - pad < bx + bw and bx - pad < ax + aw and ay - pad < by + bh and by - pad < ay + ah:
                    nx = min(ax, bx)
                    ny = min(ay, by)
                    aw = max(ax + aw, bx + bw) - nx
                    ah = max(ay + ah, by + bh) - ny
                    ax, ay = nx, ny
                    used[j] = True
                    changed = True
            next_items.append([ax, ay, aw, ah])
        items = next_items
    return [tuple(box) for box in items]


def grid_cells(im, cell):
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    cells = []
    for row, y in enumerate(range(0, h - cell + 1, cell)):
        for col, x in enumerate(range(0, w - cell + 1, cell)):
            opaque = 0
            for yy in range(y, y + cell):
                for xx in range(x, x + cell):
                    if px[xx, yy][3] > 12:
                        opaque += 1
                        if opaque >= 4:
                            break
                if opaque >= 4:
                    break
            if opaque >= 4:
                cells.append((x, y, cell, cell, col, row))
    return cells


def classify(rel, rect):
    low = rel.lower()
    name = os.path.basename(low)
    width = rect[2] if rect else 0
    height = rect[3] if rect else 0
    small = bool(rect) and width <= 32 and height <= 32
    if "chicken" in name or "cow" in name or "farm animals" in low or name.startswith("egg"):
        return "Characters/Animals", "character", "object"
    if "/characters/" in low or "/character/" in low or name.startswith("idle") or name.startswith("walk"):
        if "tool" in name:
            return "Decorations/Props", "decoration", "object"
        return "Characters/Player", "character", "object"
    if "chest" in name:
        return "Decorations/Chests", "decoration", "object"
    if "furniture" in name:
        return "Decorations/Furniture", "decoration", "object"
    if "fence" in low:
        return "Decorations/Fences", "decoration", "object" if not small else "tile"
    if "bridge" in name:
        return "Structures/Bridges", "building", "tile" if small else "object"
    if "door" in name:
        return "Structures/Doors", "tile", "tile"
    if "interior" in name:
        return "Decorations/Furniture", "decoration", "object" if not small else "tile"
    if "house" in name or "roof" in name or "wall" in name or "village/" in low:
        if small or (rect is None and "tileset" in low):
            return "Structures/Buildings", "tile", "tile"
        if rect is None:
            return "Structures/Buildings", "building", "object"
        return "Structures/Buildings", "building" if not small else "tile", "object" if not small else "tile"
    if "tree" in low or "maple" in name:
        return "Nature/Trees", "nature", "object"
    if "plant" in name or "crop" in name or "grass biom" in name:
        return "Nature/Plants", "nature", "object" if not small else "tile"
    if "falling-leaf" in low or "frames" in name:
        return "Decorations/Props", "decoration", "object"
    if "water" in name:
        return "Tiles/Water", "tile", "tile"
    if "dirt" in name or "till" in name:
        return "Tiles/Dirt", "tile", "tile"
    if "path" in name or "road" in name or "/transitions/" in low:
        return "Tiles/Paths", "road", "tile"
    if "grass" in name:
        return "Tiles/Grass", "tile", "tile"
    if "hill" in name:
        return "Tiles/Terrain", "tile", "tile"
    if "tool" in name or "material" in name or "meterial" in name:
        return "Decorations/Props", "decoration", "object"
    if rect and width <= 32 and height <= 32 and "tileset" in low:
        return "Tiles/Terrain", "tile", "tile"
    if "tileset" in low:
        return "Tiles/Terrain", "tile", "tile"
    if small:
        return "Decorations/Props", "decoration", "tile"
    return "Decorations/Props", "decoration", "object"


def pretty(rel, suffix):
    base = os.path.splitext(os.path.basename(rel))[0].replace("_", " ").replace("-", " ")
    return (base + " " + suffix).strip()


def entry(rel, im, rect, suffix):
    category, role, kind = classify(rel, rect)
    src = "assets/carts/" + rel
    item = {
        "id": rel if not rect else rel + "#%d,%d,%d,%d" % rect,
        "name": pretty(rel, suffix),
        "category": category,
        "role": role,
        "kind": kind,
        "src": src,
    }
    if rect:
        item["rect"] = {"x": rect[0], "y": rect[1], "width": rect[2], "height": rect[3]}
        item["sheet"] = rel
        item["sheetWidth"] = im.size[0]
        item["sheetHeight"] = im.size[1]
    return item


def pieces(path, rel):
    im = Image.open(path)
    w, h = im.size
    if w * h > 1400000:
        return []
    boxes = merge_boxes(islands(im), 1)
    area = w * h
    largest = max((bw * bh for _, _, bw, bh in boxes), default=0)
    touching = largest > area * 0.4
    low = rel.lower()
    name = os.path.basename(low)
    tilesheet = ("/tilesets/" in low or "/tileset/" in low) and w % 16 == 0 and h % 16 == 0
    if not tilesheet and ("path" in name or "road" in name) and max(w, h) <= 96 and w % 16 == 0 and h % 16 == 0:
        cells = grid_cells(im, 16)
        if len(cells) >= 4 and len(boxes) * 2 < len(cells):
            tilesheet = True
    if tilesheet:
        cells = grid_cells(im, 16)
        if len(cells) >= 2:
            return [entry(rel, im, (x, y, cw, ch), "r%d c%d" % (row + 1, col + 1)) for x, y, cw, ch, col, row in cells]
    if len(boxes) >= 2 and not touching:
        out = []
        for index, box in enumerate(boxes, 1):
            out.append(entry(rel, im, box, str(index)))
        return out
    return [entry(rel, im, None, "")]


def main():
    assets = []
    seen_twins = set()
    for dirpath, dirnames, filenames in os.walk(BASE):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIR and not name.startswith(".")]
        for name in sorted(filenames):
            if not name.lower().endswith(".png"):
                continue
            path = os.path.join(dirpath, name)
            rel = rel_of(path)
            if skip_file(rel):
                continue
            stem = os.path.splitext(name)[0].replace("_", " ").replace("-", " ").lower()
            digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
            twin = (os.path.dirname(rel).lower(), stem, digest)
            if twin in seen_twins:
                continue
            seen_twins.add(twin)
            assets.extend(pieces(path, rel))
    assets.sort(key=lambda item: (item["category"], item["name"], item["id"]))
    payload = {"version": 2, "assets": assets}
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    print("assets", len(assets), "categories", len({item["category"] for item in assets}))


if __name__ == "__main__":
    main()
