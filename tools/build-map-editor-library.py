#!/usr/bin/env python3
"""Copy verified CC0 sprites into assets/map-editor and write catalog.json.

Reads packs already downloaded under /tmp/hh-lib. Does not fetch from the
network and does not change the Hidden Hunter ground or characters.
"""

import io
import json
import os
import zipfile
from collections import defaultdict
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "assets", "map-editor")
SRC = "/tmp/hh-lib"

SHOOTER_URL = "https://kenney.nl/assets/top-down-shooter"
TANKS_URL = "https://kenney.nl/assets/top-down-tanks-remastered"
MAP_URL = "https://kenney.nl/assets/map-pack"
OGA_SCIFI_URL = "https://opengameart.org/content/sci-fi-interior-tiles"
OGA_HOME_URL = "https://opengameart.org/content/home-objects"
SBS_TOP_URL = "https://screamingbrainstudios.itch.io/tiny-top-down-pack"
SBS_PLAT_URL = "https://screamingbrainstudios.itch.io/tiny-platformer-pack"


def ensure(path):
    os.makedirs(path, exist_ok=True)
    return path


def save_png(im, rel):
    dest = os.path.join(OUT, rel)
    ensure(os.path.dirname(dest))
    im.convert("RGBA").save(dest, "PNG")
    return "assets/map-editor/" + rel.replace("\\", "/")


def coverage(im):
    px = list(im.convert("RGBA").getdata())
    if not px:
        return 0
    return sum(1 for p in px if p[3] > 40) / len(px)


def mae(a, b):
    pa = list(a.convert("RGBA").getdata())
    pb = list(b.convert("RGBA").getdata())
    if len(pa) != len(pb):
        return 999
    total = 0
    for x, y in zip(pa, pb):
        total += abs(x[0] - y[0]) + abs(x[1] - y[1]) + abs(x[2] - y[2]) + abs(x[3] - y[3])
    return total / (len(pa) * 4)


def asset(**kwargs):
    kwargs.setdefault("license", "CC0")
    kwargs.setdefault("recommend", False)
    kwargs.setdefault("solid", True)
    kwargs.setdefault("layer", 4)
    kwargs.setdefault("perspective", "top-down")
    kwargs.setdefault("tags", [])
    return kwargs


def letter_names(items, family):
    items = sorted(items, key=lambda item: item["id"])
    if len(items) == 1:
        items[0]["name"] = family
        items[0]["family"] = family
        return
    for index, item in enumerate(items):
        if index < 26:
            suffix = chr(ord("A") + index)
        else:
            suffix = str(index + 1)
        item["name"] = family + " " + suffix
        item["family"] = family


def classify_shooter(tiles):
    """Name tiles that match the sprites already used in the warehouse."""
    named = {
        197: ("barrel", "Barrel", ["barrel", "orange"], "Storage", 3, True),
        206: ("barrel", "Barrel", ["barrel", "tan"], "Storage", 3, True),
        359: ("barrel", "Barrel", ["barrel", "metal"], "Storage", 3, True),
        171: ("crate", "Crate", ["crate"], "Storage", 4, True),
        224: ("crate", "Crate", ["crate"], "Storage", 4, True),
        180: ("table", "Table", ["table", "furniture"], "Furniture", 4, True),
        166: ("shelf", "Shelf", ["shelf", "furniture"], "Furniture", 6, True),
        342: ("machine", "Machine", ["machine", "industrial"], "Industrial", 6, True),
        333: ("machine", "Machine", ["machine", "generator", "console", "industrial"], "Industrial", 6, True),
        386: ("container", "Container", ["container"], "Storage", 6, True),
        492: ("pillar", "Pillar", ["pillar"], "Structure", 6, True),
        436: ("door", "Door", ["door"], "Structure", 6, True),
        433: ("window", "Window", ["window"], "Structure", 6, True),
        476: ("vehicle", "Forklift", ["forklift", "vehicle"], "Vehicle", 6, True),
        474: ("vehicle", "Vehicle", ["vehicle"], "Vehicle", 6, True),
        456: ("pallet", "Pallet", ["pallet"], "Storage", 2, True),
        465: ("pipe", "Pipe", ["pipe", "grate"], "Industrial", 4, True),
        289: ("decoration", "Debris", ["debris", "decoration"], "Decoration", 1, False),
    }
    exemplars = {num: tiles[num] for num in named if num in tiles}
    labels = {}
    for num, im in tiles.items():
        if num in named:
            labels[num] = named[num]
            continue
        best = None
        for anchor, spec in named.items():
            if anchor not in exemplars:
                continue
            # The shelf tile fills its square, so a loose match labels floors as shelves.
            limit = 2.0 if spec[0] == "shelf" else 6.0
            dist = mae(im, exemplars[anchor])
            if dist <= limit and (best is None or dist < best[0]):
                best = (dist, spec)
        if best:
            labels[num] = best[1]
    return labels


def dominant_terrain(im):
    px = [p for p in im.convert("RGBA").getdata() if p[3] > 40]
    if not px:
        return "terrain"
    r = sum(p[0] for p in px) / len(px)
    g = sum(p[1] for p in px) / len(px)
    b = sum(p[2] for p in px) / len(px)
    if g > r + 12 and g > b + 8:
        return "grass"
    if b > r + 12 and b > g + 8:
        return "water"
    if r > b + 15 and g > 70 and r > 90:
        return "sand"
    return "stone"


def components(im, min_pixels=40):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    bg = px[0, 0]
    seen = [[False] * w for _ in range(h)]

    def is_bg(x, y):
        r, g, b, a = px[x, y]
        if a < 20:
            return True
        return abs(r - bg[0]) < 12 and abs(g - bg[1]) < 12 and abs(b - bg[2]) < 12 and abs(a - bg[3]) < 12

    found = []
    for y in range(h):
        for x in range(w):
            if seen[y][x] or is_bg(x, y):
                seen[y][x] = True
                continue
            stack = [(x, y)]
            seen[y][x] = True
            cells = []
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h or seen[ny][nx]:
                        continue
                    seen[ny][nx] = True
                    if not is_bg(nx, ny):
                        stack.append((nx, ny))
            if len(cells) < min_pixels:
                continue
            xs = [c[0] for c in cells]
            ys = [c[1] for c in cells]
            crop = im.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1)).copy()
            found.append(crop)
    return found


def build():
    if os.path.isdir(OUT):
        for dirpath, _, files in os.walk(OUT, topdown=False):
            for name in files:
                if name.endswith(".png") or name == "catalog.json":
                    os.remove(os.path.join(dirpath, name))
    assets = []

    shooter = zipfile.ZipFile(os.path.join(SRC, "shooter.zip"))
    shooter_names = set(shooter.namelist())
    tiles = {}
    for num in range(1, 560):
        cand = "PNG/Tiles/tile_%02d.png" % num if num < 10 else "PNG/Tiles/tile_%d.png" % num
        if cand not in shooter_names:
            continue
        tiles[num] = Image.open(io.BytesIO(shooter.read(cand))).convert("RGBA")
    labels = classify_shooter(tiles)
    shooter_style = ["top-down", "clean-2d", "industrial"]
    for num in sorted(tiles):
        im = tiles[num]
        rel = "kenney/top-down-shooter/tile_%d.png" % num
        file_rel = save_png(im, rel)
        if num in labels:
            category, family, tags, group, layer, solid = labels[num]
            entry = asset(
                id="kenney_tds_%d" % num,
                family=family,
                source="Kenney",
                pack="Kenney Top-down Shooter",
                sourceUrl=SHOOTER_URL,
                category=category,
                group=group,
                style=shooter_style,
                recommend=True,
                tags=list(tags) + ["kenney", "top-down", "shooter"],
                width=im.size[0],
                height=im.size[1],
                file=file_rel,
                solid=solid,
                layer=layer,
            )
        else:
            full = coverage(im) >= 0.985
            entry = asset(
                id="kenney_tds_%d" % num,
                family="Floor" if full else "Prop",
                source="Kenney",
                pack="Kenney Top-down Shooter",
                sourceUrl=SHOOTER_URL,
                category="floor" if full else "other",
                group="Structure" if full else "Decoration",
                style=shooter_style,
                recommend=True,
                tags=(["floor", "tile"] if full else ["prop"]) + ["kenney", "top-down", "shooter"],
                width=im.size[0],
                height=im.size[1],
                file=file_rel,
                solid=False if full else True,
                layer=1 if full else 4,
            )
        assets.append(entry)

    tanks = zipfile.ZipFile(os.path.join(SRC, "tanks.zip"))
    tank_files = [
        name for name in tanks.namelist()
        if name.endswith(".png") and "Default size/" in name
    ]
    for name in sorted(tank_files):
        base = os.path.basename(name)
        low = base.lower()
        if any(part in low for part in ("bullet", "explosion", "outline", "terraintiles", "shot")):
            continue
        if low.endswith("_side.png") or "_side" in low:
            continue
        im = Image.open(io.BytesIO(tanks.read(name))).convert("RGBA")
        stem = os.path.splitext(base)[0]
        rel = "kenney/top-down-tanks/%s.png" % stem
        file_rel = save_png(im, rel)
        category, group, layer, solid = "other", "Decoration", 4, True
        family = stem
        tags = ["kenney", "tanks", "top-down"]
        recommend = True
        style = ["top-down", "clean-2d"]
        if low.startswith("barrel") and low.endswith("_top.png"):
            category, group, family, layer = "barrel", "Storage", "Barrel", 3
            tags += ["barrel"]
        elif low.startswith("specialbarrel"):
            category, group, family, layer = "barrel", "Storage", "Barrel", 3
            tags += ["barrel"]
        elif low.startswith("barricade"):
            category, group, family, layer = "wall", "Structure", "Barricade", 6
            tags += ["wall", "barricade"]
        elif low.startswith("crate"):
            category, group, family, layer = "crate", "Storage", "Crate", 4
            tags += ["crate"]
        elif low.startswith("fence"):
            category, group, family, layer = "wall", "Structure", "Fence", 6
            tags += ["wall", "fence"]
        elif low.startswith("sandbag"):
            category, group, family, layer, solid = "decoration", "Decoration", "Sandbag", 2, False
            tags += ["sandbag", "decoration"]
        elif low.startswith("oil"):
            category, group, family, layer, solid = "decoration", "Decoration", "Oil spill", 1, False
            tags += ["oil", "decoration"]
        elif low.startswith("wire"):
            category, group, family, layer = "pipe", "Industrial", "Wire", 3
            tags += ["pipe", "wire"]
        elif low.startswith("tank"):
            category, group, family, layer = "vehicle", "Vehicle", "Tank", 6
            tags += ["vehicle", "tank"]
            if "barrel" in low:
                family = "Tank cannon"
                tags += ["cannon"]
        elif low.startswith("tilegrass") or low.startswith("tilesand"):
            category, group, family, layer, solid = "floor", "Structure", "Outdoor floor", 1, False
            recommend = False
            style = ["top-down", "generic"]
            tags += ["floor", "outdoor"]
        elif low.startswith("tree"):
            category, group, family, layer = "decoration", "Decoration", "Tree", 6, 
            recommend = False
            style = ["top-down", "generic"]
            tags += ["tree", "decoration"]
            solid = True
        elif low.startswith("tracks"):
            category, group, family, layer, solid = "decoration", "Decoration", "Tracks", 1, False
            recommend = False
            tags += ["tracks", "decoration"]
        else:
            recommend = False
            tags += ["prop"]
        ident = "kenney_tdt_" + "".join(ch.lower() if ch.isalnum() else "_" for ch in stem)
        assets.append(asset(
            id=ident[:80],
            family=family,
            source="Kenney",
            pack="Kenney Top-down Tanks Remastered",
            sourceUrl=TANKS_URL,
            category=category,
            group=group,
            style=style,
            recommend=recommend,
            tags=tags,
            width=im.size[0],
            height=im.size[1],
            file=file_rel,
            solid=solid,
            layer=layer,
        ))

    mappack = zipfile.ZipFile(os.path.join(SRC, "mappack.zip"))
    map_names = sorted(n for n in mappack.namelist() if n.endswith(".png") and "mapTile_" in n)
    for name in map_names:
        im = Image.open(io.BytesIO(mappack.read(name))).convert("RGBA")
        base = os.path.basename(name)
        num = int(base.replace("mapTile_", "").replace(".png", ""))
        kind = dominant_terrain(im)
        rel = "kenney/map-pack/mapTile_%03d.png" % num
        file_rel = save_png(im, rel)
        assets.append(asset(
            id="kenney_map_%03d" % num,
            family=kind.capitalize(),
            source="Kenney",
            pack="Kenney Map Pack",
            sourceUrl=MAP_URL,
            category="terrain",
            group="Structure",
            style=["top-down", "generic"],
            recommend=False,
            tags=["terrain", kind, "map", "kenney"],
            width=im.size[0],
            height=im.size[1],
            file=file_rel,
            solid=False,
            layer=1,
        ))

    top_sheet = Image.open(os.path.join(SRC, "sbs-top/tiny-top-down/Tiny Top Down 32x32.png")).convert("RGBA")
    tw, th = top_sheet.size
    index = 1
    for y in range(0, th, 32):
        for x in range(0, tw, 32):
            crop = top_sheet.crop((x, y, x + 32, y + 32))
            rel = "screaming-brain/tiny-top-down/tile_%02d.png" % index
            file_rel = save_png(crop, rel)
            assets.append(asset(
                id="sbs_ttd_%02d" % index,
                family="Tiny tile",
                source="itch.io",
                pack="Tiny Top Down Pack",
                sourceUrl=SBS_TOP_URL,
                category="tile",
                group="Structure",
                style=["top-down", "pixel"],
                recommend=False,
                tags=["tile", "pixel", "top-down"],
                width=32,
                height=32,
                file=file_rel,
                solid=False,
                layer=1,
                note="32px pixel tiles. Different scale from the Kenney warehouse sprites.",
            ))
            index += 1

    scifi = Image.open(os.path.join(SRC, "oga/scifi.png")).convert("RGBA")
    sw, sh = scifi.size
    cell = 16
    sindex = 1
    for y in range(0, sh, cell):
        for x in range(0, sw, cell):
            crop = scifi.crop((x, y, min(x + cell, sw), min(y + cell, sh)))
            if crop.size != (cell, cell) or coverage(crop) < 0.08:
                continue
            rel = "opengameart/sci-fi-interior/tile_%03d.png" % sindex
            file_rel = save_png(crop, rel)
            assets.append(asset(
                id="oga_scifi_%03d" % sindex,
                family="Sci-fi tile",
                source="OpenGameArt",
                pack="Sci-fi Interior tiles",
                sourceUrl=OGA_SCIFI_URL,
                category="tile",
                group="Structure",
                style=["top-down", "pixel", "industrial"],
                recommend=False,
                tags=["tile", "pixel", "sci-fi", "industrial", "interior"],
                width=cell,
                height=cell,
                file=file_rel,
                solid=False,
                layer=1,
                note="16px connected interior tiles. Different pixel scale from the Kenney warehouse sprites.",
            ))
            sindex += 1

    # Home Objects is CC0, but the sheet is one unseparated picture and the
    # pieces do not come apart into clean top-down sprites. It is recorded
    # in the excluded list instead of being imported.

    families = defaultdict(list)
    for item in assets:
        families[(item["pack"], item["family"])].append(item)
    for (_pack, family), items in families.items():
        if family in ("Floor", "Prop", "Tiny tile", "Sci-fi tile", "Home object", "Grass", "Water", "Sand", "Stone", "Outdoor floor"):
            items.sort(key=lambda item: item["id"])
            for index, item in enumerate(items, start=1):
                item["name"] = "%s %02d" % (family, index)
                item["family"] = family
        else:
            letter_names(items, family)

    # Tiny top-down tiles are walls, floors, and doors in one sheet. Keep those
    # words on the tags so search can find the pack, and say so in the name.
    for item in assets:
        if item["id"].startswith("kenney_tds_") and item["category"] == "vehicle" and "forklift" in item["tags"]:
            item["name"] = "Forklift" if item["name"].startswith("Forklift") or item["name"] == "Vehicle" else item["name"]

    assets.sort(key=lambda item: (item["pack"], item["family"], item["name"], item["id"]))
    catalog = {
        "version": 1,
        "assets": assets,
        "excluded": [
            {
                "pack": "Tiny Platformer Pack",
                "creator": "Screaming Brain Studios",
                "website": SBS_PLAT_URL,
                "license": "CC0",
                "reason": "Side-view platformer tiles. Not imported because they do not match the top-down warehouse view."
            },
            {
                "pack": "Factory tileset",
                "creator": "KeyserEX",
                "website": "https://opengameart.org/content/factory-tileset",
                "license": "CC0",
                "reason": "Side-view factory tiles. Not imported."
            },
            {
                "pack": "Modern city extension",
                "creator": "Snabisch",
                "website": "https://opengameart.org/content/modern-city-extension",
                "license": "CC0",
                "reason": "Single unseparated town sheet in a different style. Not imported."
            },
            {
                "pack": "Home Objects",
                "creator": "Curt",
                "website": OGA_HOME_URL,
                "license": "CC0",
                "reason": "One unseparated object sheet. Individual sprites could not be cut out cleanly, so the pack was not imported."
            }
        ]
    }
    dest = os.path.join(OUT, "catalog.json")
    with open(dest, "w", encoding="utf-8") as handle:
        json.dump(catalog, handle, separators=(",", ":"))
    print("assets", len(assets))
    from collections import Counter
    print(Counter(item["source"] for item in assets))
    print(Counter(item["category"] for item in assets))
    print("recommend", sum(1 for item in assets if item["recommend"]))


if __name__ == "__main__":
    build()
