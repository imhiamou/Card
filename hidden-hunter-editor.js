/*
 * Hidden Hunter map editor. Edits stay in the browser until Save.
 * The server checks the editor name on every load and save.
 */
(function () {
  const PROP_SRC = {
    barrel: "assets/hidden-hunter/environment/props/barrels/barrel-orange.png",
    barrelTan: "assets/hidden-hunter/environment/props/barrels/barrel-tan.png",
    barrelMetal: "assets/hidden-hunter/environment/props/barrels/barrel-metal.png",
    crate: "assets/hidden-hunter/environment/props/crates/crate.png",
    crateSide: "assets/hidden-hunter/environment/props/crates/crate-side.png",
    table: "assets/hidden-hunter/environment/props/furniture/table.png",
    shelf: "assets/hidden-hunter/environment/props/furniture/shelf.png",
    machine: "assets/hidden-hunter/environment/props/industrial/machine.png",
    console: "assets/hidden-hunter/environment/props/industrial/console.png",
    container: "assets/hidden-hunter/environment/props/industrial/container.png",
    pillar: "assets/hidden-hunter/environment/props/industrial/pillar.png",
    post: "assets/hidden-hunter/environment/props/industrial/post.png",
    door: "assets/hidden-hunter/environment/props/industrial/door.png",
    window: "assets/hidden-hunter/environment/props/industrial/window.png",
    forklift: "assets/hidden-hunter/environment/props/industrial/forklift.png",
    vehicle: "assets/hidden-hunter/environment/props/industrial/vehicle.png",
    pallet: "assets/hidden-hunter/environment/props/industrial/pallet.png",
    grate: "assets/hidden-hunter/environment/props/industrial/grate.png",
    debris: "assets/hidden-hunter/environment/props/industrial/debris.png"
  };
  const PROP_LAYOUT = {
    barrels: [["barrel", 0.02, 0.04, 0.48, 0.92], ["barrel", 0.5, 0.04, 0.48, 0.92]],
    barrelsGreen: [["barrelTan", 0.02, 0.04, 0.48, 0.92], ["barrelTan", 0.5, 0.04, 0.48, 0.92]],
    barrelsBlack: [["barrelMetal", 0.02, 0.04, 0.48, 0.92], ["barrelMetal", 0.5, 0.04, 0.48, 0.92]],
    crates: [["crate", 0.02, 0.02, 0.48, 0.48], ["crateSide", 0.5, 0.02, 0.48, 0.48], ["crateSide", 0.02, 0.5, 0.48, 0.48], ["crate", 0.5, 0.5, 0.48, 0.48]],
    boxes: [["crate", 0.04, 0.06, 0.55, 0.88], ["crateSide", 0.42, 0.2, 0.54, 0.74]],
    table: [["table", 0.04, 0.02, 0.92, 0.96]],
    shelves: [["shelf", 0, 0, 0.34, 1], ["shelf", 0.33, 0, 0.34, 1], ["shelf", 0.66, 0, 0.34, 1]],
    machine: [["machine", 0.02, 0.02, 0.48, 0.48], ["console", 0.5, 0.02, 0.48, 0.48], ["machine", 0.02, 0.5, 0.48, 0.48], ["machine", 0.5, 0.5, 0.48, 0.48]],
    generator: [["console", 0.06, 0.04, 0.88, 0.62], ["machine", 0.1, 0.58, 0.8, 0.38]],
    container: [["container", 0.02, 0.08, 0.48, 0.84], ["container", 0.5, 0.08, 0.48, 0.84]],
    door: [["door", 0, 0, 1, 1]],
    window: [["window", 0, 0, 1, 1]],
    pillar: [["pillar", 0, 0, 1, 1]],
    pillarWood: [["post", 0.08, 0, 0.84, 1]],
    vehicle: [["vehicle", 0.02, 0.02, 0.96, 0.96]],
    forklift: [["forklift", 0.02, 0.02, 0.96, 0.96]],
    vehicleDark: [["vehicle", 0.02, 0.02, 0.96, 0.96]],
    vehicleGreen: [["forklift", 0.02, 0.02, 0.96, 0.96]],
    pallet: [["pallet", 0.02, 0.08, 0.96, 0.84]],
    conveyor: [["grate", 0, 0.15, 1, 0.7]],
    sandbag: [["debris", 0.05, 0.05, 0.9, 0.9]]
  };
  const KIND_COLOR = {
    shelves: "#5a4630", crates: "#8a6232", boxes: "#7a5a2e", pallet: "#c4843a",
    container: "#b8bcc0", machine: "#3a4658", generator: "#3a6a88", conveyor: "#6a6a70",
    table: "#6e4b2a", forklift: "#d07028", vehicle: "#c9a227", vehicleDark: "#8a7020",
    vehicleGreen: "#d07028", barrels: "#9a2b2b", barrelsGreen: "#a08040", barrelsBlack: "#5a6268",
    pillar: "#8b939c", pillarWood: "#8a6232", door: "#4a3020", window: "#2a3344", sandbag: "#5a5040"
  };
  const SPAWN_R = { hunter: 22, tracker: 22, monster: 26 };
  const PAGE_SIZE = 48;
  const CHIPS = [
    ["all", "ALL"], ["favorites", "FAVORITES"], ["recent", "RECENT"],
    ["wall", "WALLS"], ["floor", "FLOORS"], ["shelf", "SHELVES"], ["table", "TABLES"],
    ["chair", "CHAIRS"], ["crate", "CRATES"], ["barrel", "BARRELS"], ["pallet", "PALLETS"],
    ["container", "CONTAINERS"], ["machine", "MACHINES"], ["vehicle", "VEHICLES"],
    ["pillar", "PILLARS"], ["pipe", "PIPES"], ["door", "DOORS"], ["furniture", "FURNITURE"],
    ["decoration", "DECORATION"], ["industrial", "INDUSTRIAL"], ["terrain", "TERRAIN"],
    ["tile", "TILES"], ["other", "OTHER"]
  ];
  const PRESET_PREVIEW = {
    door: PROP_SRC.door, window: PROP_SRC.window, pillar: PROP_SRC.pillar, pillarWood: PROP_SRC.post,
    shelves: PROP_SRC.shelf, crates: PROP_SRC.crate, boxes: PROP_SRC.crate, pallet: PROP_SRC.pallet,
    container: PROP_SRC.container, machine: PROP_SRC.machine, generator: PROP_SRC.console,
    conveyor: PROP_SRC.grate, table: PROP_SRC.table, forklift: PROP_SRC.forklift,
    vehicle: PROP_SRC.vehicle, vehicleDark: PROP_SRC.vehicle, vehicleGreen: PROP_SRC.forklift,
    barrels: PROP_SRC.barrel, barrelsGreen: PROP_SRC.barrelTan, barrelsBlack: PROP_SRC.barrelMetal,
    sandbag: PROP_SRC.debris
  };
  const PRESET_CAT = {
    door: "door", window: "window", pillar: "pillar", pillarWood: "pillar",
    shelves: "shelf", crates: "crate", boxes: "crate", pallet: "pallet", container: "container",
    machine: "machine", generator: "machine", conveyor: "pipe", table: "table",
    forklift: "vehicle", vehicle: "vehicle", vehicleDark: "vehicle", vehicleGreen: "vehicle",
    barrels: "barrel", barrelsGreen: "barrel", barrelsBlack: "barrel", sandbag: "decoration"
  };
  const GROUP_NAME = {
    Structures: "Structure", Storage: "Storage", Industrial: "Industrial",
    Furniture: "Furniture", Vehicles: "Vehicle", Decoration: "Decoration"
  };

  const IMG = Object.create(null);
  let socket = null;
  let accessName = "";
  let catalog = [];
  let library = [];
  let libraryById = Object.create(null);
  let libraryReady = null;
  let query = "";
  let chip = "all";
  let sourceFilter = "all";
  let styleFilter = "all";
  let groupFilter = "all";
  let licenseFilter = "all";
  let warehouseOnly = true;
  let page = 0;
  let mapList = [];
  let selectedMapId = "default";
  let doc = null;
  let tool = "select";
  let armedKind = "";
  let textDraft = "LOADING BAY";
  let gridOn = false;
  let snapOn = false;
  let gridSize = 32;
  let zoom = 0.5;
  let panX = 20;
  let panY = 20;
  let selection = null;
  let undo = [];
  let redo = [];
  let drag = null;
  let raf = 0;
  let built = false;
  let filling = false;
  let editArmed = false;
  let ui = {};

  function $(id) { return document.getElementById(id); }

  function loadImg(src) {
    if (IMG[src]) return IMG[src];
    const im = new Image();
    im.src = src;
    IMG[src] = im;
    return im;
  }

  function ready(im) { return im && im.complete && im.naturalWidth > 0; }

  function loadLibrary() {
    if (libraryReady) return libraryReady;
    libraryReady = fetch("assets/map-editor/catalog.json")
      .then((response) => response.json())
      .then((data) => {
        library = data.assets || [];
        libraryById = Object.create(null);
        library.forEach((item) => { libraryById[item.id] = item; });
      })
      .catch(() => { library = []; });
    return libraryReady;
  }

  function readStore(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
    } catch (err) {
      return [];
    }
  }

  function favorites() { return readStore("hhEditorFavorites"); }

  function recentIds() { return readStore("hhEditorRecent"); }

  function toggleFavorite(id) {
    const list = favorites().filter((item) => item !== id);
    if (list.length === favorites().length) list.unshift(id);
    localStorage.setItem("hhEditorFavorites", JSON.stringify(list.slice(0, 200)));
  }

  function rememberRecent(id) {
    const list = [id].concat(recentIds().filter((item) => item !== id)).slice(0, 24);
    localStorage.setItem("hhEditorRecent", JSON.stringify(list));
  }

  function presetEntries() {
    return catalog.map((item) => ({
      id: "kind:" + item.kind,
      kind: item.kind,
      preset: true,
      name: item.name + " set",
      family: "Existing set",
      source: "Kenney",
      pack: "Kenney Top-down Shooter",
      sourceUrl: "https://kenney.nl/assets/top-down-shooter",
      license: "CC0",
      category: PRESET_CAT[item.kind] || "other",
      group: GROUP_NAME[item.category] || "Decoration",
      style: ["top-down", "clean-2d", "industrial"],
      perspective: "top-down",
      recommend: true,
      tags: [item.kind, item.name.toLowerCase(), PRESET_CAT[item.kind] || ""],
      width: item.w,
      height: item.h,
      file: PRESET_PREVIEW[item.kind] || "",
      solid: item.solid !== false,
      layer: item.layer
    }));
  }

  function allEntries() {
    return presetEntries().concat(library);
  }

  function entryById(id) {
    if (!id) return null;
    if (id.indexOf("kind:") === 0) return presetEntries().find((item) => item.id === id) || null;
    return libraryById[id] || null;
  }

  function placeSize(spec) {
    if (spec.preset) return { w: spec.width, h: spec.height };
    const longest = Math.max(spec.width, spec.height);
    if (longest >= 48) return { w: spec.width, h: spec.height };
    const scale = 48 / longest;
    return {
      w: Math.max(8, Math.round(spec.width * scale)),
      h: Math.max(8, Math.round(spec.height * scale))
    };
  }

  function chipMatch(item) {
    if (chip === "all" || chip === "favorites" || chip === "recent") return true;
    if (chip === "furniture") return item.group === "Furniture" || item.category === "furniture" || (item.tags || []).indexOf("furniture") !== -1;
    if (chip === "industrial") return item.group === "Industrial" || (item.tags || []).indexOf("industrial") !== -1;
    if (item.category === chip) return true;
    return (item.tags || []).indexOf(chip) !== -1;
  }

  function filteredEntries() {
    const fav = Object.create(null);
    favorites().forEach((id) => { fav[id] = true; });
    const recent = recentIds();
    const recentOrder = Object.create(null);
    recent.forEach((id, index) => { recentOrder[id] = index; });
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let list = allEntries().filter((item) => {
      if (warehouseOnly && !item.recommend) return false;
      if (chip === "favorites" && !fav[item.id]) return false;
      if (chip === "recent" && recentOrder[item.id] == null) return false;
      if (!chipMatch(item)) return false;
      if (sourceFilter === "other" && (item.source === "Kenney" || item.source === "OpenGameArt" || item.source === "itch.io")) return false;
      if (sourceFilter !== "all" && sourceFilter !== "other" && item.source !== sourceFilter) return false;
      if (licenseFilter !== "all" && item.license !== licenseFilter) return false;
      if (styleFilter !== "all" && (item.style || []).indexOf(styleFilter) === -1) return false;
      if (groupFilter !== "all" && item.group !== groupFilter) return false;
      if (!terms.length) return true;
      const hay = [item.name, item.family, item.category, item.group, item.pack, item.source, item.license, (item.tags || []).join(" ")].join(" ").toLowerCase();
      return terms.every((term) => hay.indexOf(term) !== -1);
    });
    if (chip === "recent") list.sort((a, b) => recentOrder[a.id] - recentOrder[b.id]);
    else list.sort((a, b) => (a.family || "").localeCompare(b.family || "") || (a.name || "").localeCompare(b.name || ""));
    return list;
  }

  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function blankMap(width, height) {
    const w = width || 2000;
    const h = height || 1500;
    return {
      id: "new",
      isNew: true,
      name: "Untitled",
      version: 0,
      width: w,
      height: h,
      ground: "procedural",
      spawns: {
        tracker: { x: 240, y: 280 },
        hunter: { x: 240, y: 520 },
        monster: { x: Math.min(980, w - 80), y: Math.min(480, h - 80) }
      },
      objects: [],
      texts: []
    };
  }

  function cloneDoc(source) {
    const copy = JSON.parse(JSON.stringify(source));
    copy.isNew = !!source.isNew;
    return copy;
  }

  function pushUndo() {
    if (!doc) return;
    undo.push(JSON.stringify(doc));
    if (undo.length > 60) undo.shift();
    redo = [];
  }

  function restore(raw) {
    const parsed = JSON.parse(raw);
    doc = parsed;
    selection = null;
    fillProps();
    setStatus(doc.name + "  " + doc.width + "×" + doc.height);
  }

  function undoEdit() {
    if (!undo.length || !doc) return;
    redo.push(JSON.stringify(doc));
    restore(undo.pop());
  }

  function redoEdit() {
    if (!redo.length || !doc) return;
    undo.push(JSON.stringify(doc));
    restore(redo.pop());
  }

  function setStatus(text) {
    if (ui.status) ui.status.textContent = text;
  }

  function scaleOf(o) { return o.scale > 0 ? o.scale : 1; }

  function center(o) { return { x: o.x + o.w / 2, y: o.y + o.h / 2 }; }

  function snap(v) {
    if (!snapOn) return Math.round(v);
    return Math.round(v / gridSize) * gridSize;
  }

  function rotPoint(lx, ly, deg) {
    const rad = deg * Math.PI / 180;
    return {
      x: lx * Math.cos(rad) - ly * Math.sin(rad),
      y: lx * Math.sin(rad) + ly * Math.cos(rad)
    };
  }

  function worldFromLocal(o, lx, ly) {
    const p = rotPoint(lx, ly, o.rotation || 0);
    const c = center(o);
    return { x: c.x + p.x, y: c.y + p.y };
  }

  function localFromWorld(o, wx, wy) {
    const c = center(o);
    return rotPoint(wx - c.x, wy - c.y, -(o.rotation || 0));
  }

  function hitObject(o, wx, wy) {
    const s = scaleOf(o);
    const local = localFromWorld(o, wx, wy);
    return Math.abs(local.x) <= (o.w * s) / 2 && Math.abs(local.y) <= (o.h * s) / 2;
  }

  function hitText(t, wx, wy) {
    const local = rotPoint(wx - t.x, wy - t.y, -(t.rotation || 0));
    const hw = Math.max(24, (t.text || "").length * (t.size || 18) * 0.32);
    const hh = (t.size || 18) * 0.7;
    return Math.abs(local.x) <= hw && Math.abs(local.y) <= hh;
  }

  function topObjectAt(wx, wy) {
    const list = doc.objects.slice().sort((a, b) => (a.layer || 0) - (b.layer || 0));
    for (let i = list.length - 1; i >= 0; i--) {
      if (hitObject(list[i], wx, wy)) return list[i];
    }
    return null;
  }

  function topTextAt(wx, wy) {
    const list = doc.texts.slice().sort((a, b) => (a.layer || 0) - (b.layer || 0));
    for (let i = list.length - 1; i >= 0; i--) {
      if (hitText(list[i], wx, wy)) return list[i];
    }
    return null;
  }

  function spawnAt(wx, wy) {
    const names = ["hunter", "tracker", "monster"];
    for (let i = 0; i < names.length; i++) {
      const s = doc.spawns[names[i]];
      if (Math.hypot(s.x - wx, s.y - wy) < 22) return names[i];
    }
    return "";
  }

  function selectedObject() {
    if (!selection || selection.type !== "object") return null;
    return doc.objects.find((o) => o.id === selection.id) || null;
  }

  function selectedText() {
    if (!selection || selection.type !== "text") return null;
    return doc.texts.find((t) => t.id === selection.id) || null;
  }

  function eventWorld(e) {
    const rect = ui.canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (ui.canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (ui.canvas.height / rect.height);
    return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
  }

  function placeObject(id, world) {
    const spec = entryById(id);
    if (!spec || !doc) return;
    const size = placeSize(spec);
    pushUndo();
    const obj = {
      id: newId("o"),
      x: snap(world.x - size.w / 2),
      y: snap(world.y - size.h / 2),
      w: size.w,
      h: size.h,
      rotation: 0,
      scale: 1,
      layer: spec.layer,
      solid: spec.solid !== false,
      label: ""
    };
    if (spec.preset) obj.kind = spec.kind;
    else obj.assetId = spec.id;
    doc.objects.push(obj);
    selection = { type: "object", id: obj.id };
    tool = "select";
    armedKind = "";
    rememberRecent(spec.id);
    fillProps();
    renderLibrary();
    setStatus("Placed " + spec.name);
  }

  function placeText(world) {
    const text = (textDraft || "").trim().slice(0, 40);
    if (!text) {
      setStatus("Type the label, then click the map.");
      if (ui.textInput) ui.textInput.focus();
      return;
    }
    pushUndo();
    const item = {
      id: newId("t"),
      text,
      x: snap(world.x),
      y: snap(world.y),
      size: 28,
      rotation: 0,
      opacity: 1,
      layer: 8
    };
    doc.texts.push(item);
    selection = { type: "text", id: item.id };
    tool = "select";
    fillProps();
    setStatus("Placed text");
  }

  function placeSpawn(which, world) {
    pushUndo();
    doc.spawns[which] = { x: Math.round(world.x), y: Math.round(world.y) };
    selection = { type: "spawn", id: which };
    tool = "select";
    fillProps();
    setStatus(which + " spawn moved");
  }

  function duplicateSelection() {
    const obj = selectedObject();
    const text = selectedText();
    if (!obj && !text) return;
    pushUndo();
    if (obj) {
      const copy = JSON.parse(JSON.stringify(obj));
      copy.id = newId("o");
      copy.x += snapOn ? gridSize : 24;
      copy.y += snapOn ? gridSize : 24;
      doc.objects.push(copy);
      selection = { type: "object", id: copy.id };
    } else {
      const copy = JSON.parse(JSON.stringify(text));
      copy.id = newId("t");
      copy.x += 24;
      copy.y += 24;
      doc.texts.push(copy);
      selection = { type: "text", id: copy.id };
    }
    fillProps();
  }

  function deleteSelection() {
    if (!doc || !selection) return;
    if (selection.type === "spawn") {
      setStatus("Spawn points stay on the map. Drag a spawn to move it.");
      return;
    }
    pushUndo();
    if (selection.type === "object") doc.objects = doc.objects.filter((o) => o.id !== selection.id);
    if (selection.type === "text") doc.texts = doc.texts.filter((t) => t.id !== selection.id);
    selection = null;
    fillProps();
  }

  function outsideItems(width, height) {
    const names = [];
    doc.objects.forEach((o) => {
      const s = scaleOf(o);
      const hw = (o.w * s) / 2;
      const hh = (o.h * s) / 2;
      const c = center(o);
      const rad = ((o.rotation || 0) * Math.PI) / 180;
      const aw = hw * Math.abs(Math.cos(rad)) + hh * Math.abs(Math.sin(rad));
      const ah = hw * Math.abs(Math.sin(rad)) + hh * Math.abs(Math.cos(rad));
      if (c.x - aw < 0 || c.y - ah < 0 || c.x + aw > width || c.y + ah > height) names.push(o.assetId || o.kind);
    });
    doc.texts.forEach((t) => {
      if (t.x < 0 || t.y < 0 || t.x > width || t.y > height) names.push("text");
    });
    ["hunter", "tracker", "monster"].forEach((name) => {
      const s = doc.spawns[name];
      const r = SPAWN_R[name] + 18;
      if (s.x < r || s.y < r || s.x > width - r || s.y > height - r) names.push(name + " spawn");
    });
    return names;
  }

  function resizeMap() {
    const width = Math.round(Number(ui.width.value));
    const height = Math.round(Number(ui.height.value));
    if (!width || !height || width < 800 || height < 800 || width > 4000 || height > 4000) {
      setStatus("Width and height must be between 800 and 4000.");
      return;
    }
    const outside = outsideItems(width, height);
    if ((width < doc.width || height < doc.height) && outside.length) {
      const ok = window.confirm("Shrinking the map leaves " + outside.length + " item(s) outside the new boundaries. They will be kept so you can move them back. Continue?");
      if (!ok) return;
    }
    pushUndo();
    doc.width = width;
    doc.height = height;
    setStatus("Map is " + width + "×" + height);
  }

  function fitMap() {
    if (!doc || !ui.canvas) return;
    const z = Math.min(ui.canvas.width / doc.width, ui.canvas.height / doc.height) * 0.94;
    zoom = Math.max(0.08, z);
    panX = (ui.canvas.width - doc.width * zoom) / 2;
    panY = (ui.canvas.height - doc.height * zoom) / 2;
  }

  function drawContained(ctx, im, x, y, w, h) {
    if (!ready(im) || !im.naturalWidth || !im.naturalHeight) return false;
    const sc = Math.min(w / im.naturalWidth, h / im.naturalHeight);
    const dw = im.naturalWidth * sc;
    const dh = im.naturalHeight * sc;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }

  function drawSprite(ctx, key, x, y, w, h) {
    const im = loadImg(PROP_SRC[key]);
    if (!ready(im)) return false;
    const sc = Math.min(w / im.naturalWidth, h / im.naturalHeight);
    const dw = im.naturalWidth * sc;
    const dh = im.naturalHeight * sc;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }

  function drawProp(ctx, o) {
    const s = scaleOf(o);
    const dw = o.w * s;
    const dh = o.h * s;
    if (o.assetId) {
      const spec = libraryById[o.assetId];
      const im = spec && spec.file ? loadImg(spec.file) : null;
      if (!im || !drawContained(ctx, im, -dw / 2, -dh / 2, dw, dh)) {
        ctx.fillStyle = "#667";
        ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
      }
      if (o.label) {
        ctx.fillStyle = "rgba(255,240,210,.9)";
        ctx.font = "10px Arial";
        ctx.textAlign = "center";
        ctx.fillText(o.label, 0, -dh / 2 - 4);
      }
      return;
    }
    const layout = PROP_LAYOUT[o.kind];
    let drew = false;
    if (layout) {
      drew = layout.every((cell) => ready(loadImg(PROP_SRC[cell[0]])));
      if (drew) {
        layout.forEach((cell) => drawSprite(ctx, cell[0], -dw / 2 + cell[1] * dw, -dh / 2 + cell[2] * dh, cell[3] * dw, cell[4] * dh));
      }
    }
    if (!drew) {
      ctx.fillStyle = KIND_COLOR[o.kind] || "#445";
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    }
    if (o.label) {
      ctx.fillStyle = "rgba(255,240,210,.9)";
      ctx.font = "10px Arial";
      ctx.textAlign = "center";
      ctx.fillText(o.label, 0, -dh / 2 - 4);
    }
  }

  function drawGround(ctx, width, height, view) {
    ctx.fillStyle = "#1a1510";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#2a2218";
    const x0 = Math.max(0, Math.floor(view.x0 / 70) * 70);
    const y0 = Math.max(0, Math.floor(view.y0 / 70) * 70);
    const x1 = Math.min(width, view.x1 + 70);
    const y1 = Math.min(height, view.y1 + 70);
    for (let x = x0; x < x1; x += 70) {
      for (let y = y0; y < y1; y += 70) ctx.fillRect(x, y, 68, 68);
    }
    ctx.strokeStyle = "rgba(196,160,60,.18)";
    ctx.lineWidth = 4;
    for (let x = 140; x < width; x += 280) {
      if (x < view.x0 - 20 || x > view.x1 + 20) continue;
      ctx.strokeRect(x, 40, 8, height - 80);
    }
    ctx.strokeStyle = "#3d2f22";
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, width - 16, height - 16);
  }

  function drawMap(ctx, map, showSpawns, highlight) {
    const view = {
      x0: -panX / zoom,
      y0: -panY / zoom,
      x1: (-panX + ctx.canvas.width) / zoom,
      y1: (-panY + ctx.canvas.height) / zoom
    };
    drawGround(ctx, map.width, map.height, view);
    if (gridOn) {
      ctx.strokeStyle = "rgba(255,255,255,.08)";
      ctx.lineWidth = 1 / zoom;
      const gs = gridSize;
      const gx0 = Math.max(0, Math.floor(view.x0 / gs) * gs);
      const gy0 = Math.max(0, Math.floor(view.y0 / gs) * gs);
      for (let x = gx0; x <= Math.min(map.width, view.x1); x += gs) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, map.height); ctx.stroke();
      }
      for (let y = gy0; y <= Math.min(map.height, view.y1); y += gs) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(map.width, y); ctx.stroke();
      }
    }
    const props = (map.objects || []).slice().sort((a, b) => (a.layer || 0) - (b.layer || 0));
    props.forEach((o) => {
      const c = center(o);
      ctx.save();
      ctx.translate(c.x, c.y);
      if (o.rotation) ctx.rotate((o.rotation * Math.PI) / 180);
      drawProp(ctx, o);
      if (highlight && highlight.type === "object" && highlight.id === o.id) {
        const s = scaleOf(o);
        ctx.strokeStyle = "#ffd866";
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect((-o.w * s) / 2, (-o.h * s) / 2, o.w * s, o.h * s);
      }
      ctx.restore();
    });
    (map.texts || []).forEach((t) => {
      ctx.save();
      ctx.translate(t.x, t.y);
      if (t.rotation) ctx.rotate((t.rotation * Math.PI) / 180);
      ctx.globalAlpha = t.opacity == null ? 1 : t.opacity;
      ctx.fillStyle = "#fff0d2";
      ctx.font = "bold " + (t.size || 18) + "px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t.text, 0, 0);
      if (highlight && highlight.type === "text" && highlight.id === t.id) {
        const hw = Math.max(20, t.text.length * (t.size || 18) * 0.32);
        ctx.strokeStyle = "#ffd866";
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(-hw, -(t.size || 18) * 0.6, hw * 2, (t.size || 18) * 1.2);
      }
      ctx.restore();
    });
    if (showSpawns && map.spawns) {
      const marks = [
        ["hunter", "#50b4ff", "H"],
        ["tracker", "#ffd866", "T"],
        ["monster", "#e05050", "M"]
      ];
      marks.forEach((mark) => {
        const s = map.spawns[mark[0]];
        if (!s) return;
        ctx.beginPath();
        ctx.fillStyle = mark[1];
        ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.font = "bold 14px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(mark[2], s.x, s.y);
        ctx.fillStyle = mark[1];
        ctx.font = "11px Arial";
        ctx.fillText(mark[0].toUpperCase() + " SPAWN", s.x, s.y - 26);
      });
    }
  }

  function paint() {
    if (!ui.canvas || !doc || $("hhEditorScreen").classList.contains("hidden")) return;
    const ctx = ui.canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#100e0c";
    ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
    ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
    drawMap(ctx, doc, true, selection);
    const obj = selectedObject();
    if (obj) {
      const s = scaleOf(obj);
      const scaleAt = worldFromLocal(obj, (obj.w * s) / 2, (obj.h * s) / 2);
      const rotAt = worldFromLocal(obj, 0, -(obj.h * s) / 2 - 22);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      [[scaleAt, "#7cf0ff"], [rotAt, "#ffd866"]].forEach((handle) => {
        const sx = handle[0].x * zoom + panX;
        const sy = handle[0].y * zoom + panY;
        ctx.fillStyle = handle[1];
        ctx.fillRect(sx - 5, sy - 5, 10, 10);
      });
    }
  }

  function loop() {
    paint();
    raf = requestAnimationFrame(loop);
  }

  function sizeCanvas() {
    if (!ui.stage || !ui.canvas) return;
    const rect = ui.stage.getBoundingClientRect();
    ui.canvas.width = Math.max(320, Math.floor(rect.width));
    ui.canvas.height = Math.max(240, Math.floor(rect.height));
  }

  function fillProps() {
    if (!ui.props) return;
    filling = true;
    const obj = selectedObject();
    const text = selectedText();
    const spawnName = selection && selection.type === "spawn" ? selection.id : "";
    if (!obj && !text && !spawnName) {
      ui.props.innerHTML = "<h4>PROPERTIES</h4><p class=\"hheNote\">Select an object, a text label, or a spawn.</p>";
      filling = false;
      return;
    }
    if (spawnName) {
      const s = doc.spawns[spawnName];
      ui.props.innerHTML = "<h4>SPAWN</h4><p>" + spawnName + "</p>"
        + field("X", "hheX", s.x) + field("Y", "hheY", s.y)
        + "<p class=\"hheNote\">Spawn markers are visible here only. Players do not see them in a match.</p>";
    } else if (text) {
      ui.props.innerHTML = "<h4>TEXT</h4>"
        + field("Text", "hheText", text.text, "text")
        + "<div class=\"row\">" + field("X", "hheX", Math.round(text.x)) + field("Y", "hheY", Math.round(text.y)) + "</div>"
        + "<div class=\"row\">" + field("Size", "hheSize", text.size) + field("Rotation", "hheRot", Math.round(text.rotation || 0)) + "</div>"
        + "<div class=\"row\">" + field("Opacity", "hheOp", text.opacity) + field("Layer", "hheLayer", text.layer) + "</div>"
        + "<button type=\"button\" id=\"hheDup\">Duplicate</button> <button type=\"button\" id=\"hheDel\">Delete</button>";
    } else {
      const spec = obj.assetId ? libraryById[obj.assetId] : catalog.find((item) => item.kind === obj.kind);
      const s = scaleOf(obj);
      const cw = obj.cw || obj.w;
      const ch = obj.ch || obj.h;
      const meta = spec && spec.pack
        ? "<p class=\"hheNote\">Source: " + spec.source + "<br>Pack: " + spec.pack + "<br>Style: " + (spec.style || []).join(", ") + "<br>License: " + spec.license + "<br>Category: " + spec.category + "</p>"
        : (obj.kind ? "<p class=\"hheNote\">Source: Kenney<br>Pack: Kenney Top-down Shooter<br>License: CC0</p>" : "");
      ui.props.innerHTML = "<h4>OBJECT</h4><p>Asset: " + (spec ? spec.name : (obj.assetId || obj.kind)) + "</p>" + meta
        + "<div class=\"row\">" + field("X", "hheX", Math.round(obj.x)) + field("Y", "hheY", Math.round(obj.y)) + "</div>"
        + "<div class=\"row\">" + field("Rotation", "hheRot", Math.round(obj.rotation || 0)) + field("Scale", "hheScale", s) + "</div>"
        + "<label class=\"hheCheck\"><input id=\"hheSolid\" type=\"checkbox\"" + (obj.solid !== false ? " checked" : "") + "> Collision</label>"
        + "<div class=\"row\">" + field("Collision W", "hheCw", Math.round(cw)) + field("Collision H", "hheCh", Math.round(ch)) + "</div>"
        + field("Layer", "hheLayer", obj.layer)
        + field("Label", "hheLabel", obj.label || "", "text")
        + "<p class=\"hheNote\">Drag to move. The blue handle scales. The gold handle rotates. Q and E rotate. [ and ] scale.</p>"
        + "<button type=\"button\" id=\"hheRotL\">Rotate −15</button> <button type=\"button\" id=\"hheRotR\">Rotate +15</button><br><br>"
        + "<button type=\"button\" id=\"hheDup\">Duplicate</button> <button type=\"button\" id=\"hheDel\">Delete</button>";
    }
    filling = false;
    bindPropInputs();
  }

  function field(label, id, value, type) {
    const kind = type === "text" ? "text" : "number";
    const step = kind === "number" ? " step=\"any\"" : "";
    return "<label>" + label + "<input id=\"" + id + "\" type=\"" + kind + "\"" + step + " value=\"" + String(value).replace(/\"/g, "&quot;") + "\"></label>";
  }

  function bindPropInputs() {
    const apply = () => {
      if (filling) return;
      const obj = selectedObject();
      const text = selectedText();
      const num = (id) => Number($(id) && $(id).value);
      if (selection && selection.type === "spawn") {
        doc.spawns[selection.id].x = num("hheX");
        doc.spawns[selection.id].y = num("hheY");
        return;
      }
      if (text) {
        text.text = (($("hheText").value) || "").slice(0, 40);
        text.x = num("hheX");
        text.y = num("hheY");
        text.size = Math.max(10, Math.min(72, num("hheSize") || text.size));
        text.rotation = num("hheRot") || 0;
        text.opacity = Math.max(0, Math.min(1, num("hheOp")));
        text.layer = Math.round(num("hheLayer") || 0);
        return;
      }
      if (!obj) return;
      obj.x = num("hheX");
      obj.y = num("hheY");
      obj.rotation = num("hheRot") || 0;
      const nextScale = num("hheScale");
      if (nextScale > 0) obj.scale = Math.max(0.2, Math.min(6, nextScale));
      obj.solid = $("hheSolid").checked;
      const cw = num("hheCw");
      const ch = num("hheCh");
      if (cw > 0) obj.cw = cw;
      if (ch > 0) obj.ch = ch;
      obj.layer = Math.max(0, Math.min(30, Math.round(num("hheLayer") || 0)));
      obj.label = ($("hheLabel").value || "").slice(0, 32);
    };
    ui.props.querySelectorAll("input").forEach((input) => {
      input.addEventListener("focus", () => {
        if (!editArmed) { pushUndo(); editArmed = true; }
      });
      input.addEventListener("input", apply);
      input.addEventListener("change", apply);
      input.addEventListener("blur", () => { editArmed = false; });
    });
    const dup = $("hheDup");
    const del = $("hheDel");
    const left = $("hheRotL");
    const right = $("hheRotR");
    if (dup) dup.onclick = duplicateSelection;
    if (del) del.onclick = deleteSelection;
    if (left) left.onclick = () => nudgeRotation(-15);
    if (right) right.onclick = () => nudgeRotation(15);
  }

  function nudgeRotation(delta) {
    const obj = selectedObject();
    const text = selectedText();
    if (!obj && !text) return;
    pushUndo();
    if (obj) obj.rotation = (obj.rotation || 0) + delta;
    if (text) text.rotation = (text.rotation || 0) + delta;
    fillProps();
  }

  function nudgeScale(factor) {
    const obj = selectedObject();
    if (!obj) return;
    pushUndo();
    obj.scale = Math.max(0.2, Math.min(6, scaleOf(obj) * factor));
    fillProps();
  }

  function handleAt(obj, which) {
    const s = scaleOf(obj);
    if (which === "scale") return worldFromLocal(obj, (obj.w * s) / 2, (obj.h * s) / 2);
    return worldFromLocal(obj, 0, -(obj.h * s) / 2 - 22);
  }

  function near(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) < 12 / zoom;
  }

  function onPointerDown(e) {
    if (!doc) return;
    if (e.button === 1 || e.button === 2) {
      drag = { mode: "pan", x: e.clientX, y: e.clientY, panX, panY };
      return;
    }
    if (e.button !== 0) return;
    const world = eventWorld(e);
    const obj = selectedObject();
    if (obj) {
      if (near(world, handleAt(obj, "scale"))) {
        pushUndo();
        drag = { mode: "scale", id: obj.id, start: scaleOf(obj), dist: Math.max(8, Math.hypot(world.x - center(obj).x, world.y - center(obj).y)) };
        return;
      }
      if (near(world, handleAt(obj, "rotate"))) {
        pushUndo();
        drag = { mode: "rotate", id: obj.id };
        return;
      }
    }
    if (tool === "text") { placeText(world); return; }
    if (tool.indexOf("spawn-") === 0) { placeSpawn(tool.slice(6), world); renderLibrary(); return; }
    if (tool === "place" && armedKind) { placeObject(armedKind, world); return; }
    const spawn = spawnAt(world.x, world.y);
    if (spawn) {
      selection = { type: "spawn", id: spawn };
      pushUndo();
      drag = { mode: "spawn", id: spawn, dx: world.x - doc.spawns[spawn].x, dy: world.y - doc.spawns[spawn].y };
      fillProps();
      return;
    }
    const hit = topObjectAt(world.x, world.y) || null;
    const hitT = hit ? null : topTextAt(world.x, world.y);
    if (hit) {
      selection = { type: "object", id: hit.id };
      pushUndo();
      drag = { mode: "move", id: hit.id, dx: world.x - hit.x, dy: world.y - hit.y };
    } else if (hitT) {
      selection = { type: "text", id: hitT.id };
      pushUndo();
      drag = { mode: "movetext", id: hitT.id, dx: world.x - hitT.x, dy: world.y - hitT.y };
    } else {
      selection = null;
    }
    fillProps();
  }

  function onPointerMove(e) {
    if (!drag || !doc) return;
    if (drag.mode === "pan") {
      panX = drag.panX + (e.clientX - drag.x);
      panY = drag.panY + (e.clientY - drag.y);
      return;
    }
    const world = eventWorld(e);
    if (drag.mode === "move") {
      const obj = doc.objects.find((o) => o.id === drag.id);
      if (!obj) return;
      obj.x = snap(world.x - drag.dx);
      obj.y = snap(world.y - drag.dy);
    } else if (drag.mode === "movetext") {
      const text = doc.texts.find((t) => t.id === drag.id);
      if (!text) return;
      text.x = snap(world.x - drag.dx);
      text.y = snap(world.y - drag.dy);
    } else if (drag.mode === "spawn") {
      doc.spawns[drag.id].x = Math.round(world.x - drag.dx);
      doc.spawns[drag.id].y = Math.round(world.y - drag.dy);
    } else if (drag.mode === "scale") {
      const obj = doc.objects.find((o) => o.id === drag.id);
      if (!obj) return;
      const c = center(obj);
      const dist = Math.max(8, Math.hypot(world.x - c.x, world.y - c.y));
      obj.scale = Math.max(0.2, Math.min(6, drag.start * (dist / drag.dist)));
    } else if (drag.mode === "rotate") {
      const obj = doc.objects.find((o) => o.id === drag.id);
      if (!obj) return;
      const c = center(obj);
      obj.rotation = Math.atan2(world.y - c.y, world.x - c.x) * 180 / Math.PI + 90;
    }
  }

  function onPointerUp() {
    if (drag && (drag.mode === "move" || drag.mode === "scale" || drag.mode === "rotate" || drag.mode === "spawn" || drag.mode === "movetext")) fillProps();
    drag = null;
  }

  function onWheel(e) {
    if (!ui.canvas) return;
    e.preventDefault();
    const world = eventWorld(e);
    const next = Math.max(0.08, Math.min(3, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    panX = e.offsetX - world.x * next;
    panY = e.offsetY - world.y * next;
    zoom = next;
  }

  function renderLibrary() {
    if (!ui.libScroll) return;
    const kept = ui.libScroll.scrollTop;
    const fav = Object.create(null);
    favorites().forEach((id) => { fav[id] = true; });
    if (ui.chips) {
      ui.chips.querySelectorAll("button").forEach((btn) => {
        btn.classList.toggle("armed", btn.getAttribute("data-chip") === chip);
      });
    }
    const list = filteredEntries();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page >= pages) page = pages - 1;
    if (page < 0) page = 0;
    const slice = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const counts = Object.create(null);
    list.forEach((item) => {
      const key = (item.pack || "") + ":" + (item.family || "");
      counts[key] = (counts[key] || 0) + 1;
    });
    ui.libScroll.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "hheGrid";
    let lastFamily = "";
    if (!slice.length) {
      const empty = document.createElement("p");
      empty.className = "hheNote";
      empty.textContent = library.length ? "No assets match these filters." : "The asset library is still loading.";
      grid.appendChild(empty);
    }
    slice.forEach((item) => {
      const familyKey = (item.pack || "") + ":" + (item.family || "");
      if (item.family && item.family !== lastFamily && counts[familyKey] > 1) {
        const heading = document.createElement("h4");
        heading.className = "hheFamily";
        heading.textContent = item.family.toUpperCase();
        grid.appendChild(heading);
      }
      lastFamily = item.family || "";
      const card = document.createElement("button");
      card.type = "button";
      card.className = "hheCard" + (tool === "place" && armedKind === item.id ? " armed" : "");
      card.draggable = true;
      const img = document.createElement("img");
      img.alt = item.name;
      img.src = item.file || "";
      const name = document.createElement("span");
      name.className = "hheCardName";
      name.textContent = item.name;
      const meta = document.createElement("span");
      meta.className = "hheCardMeta";
      meta.textContent = item.source + " · " + item.license;
      const favBtn = document.createElement("span");
      favBtn.className = "hheFav" + (fav[item.id] ? " on" : "");
      favBtn.textContent = fav[item.id] ? "★" : "☆";
      favBtn.title = "Favorite";
      favBtn.onclick = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        toggleFavorite(item.id);
        renderLibrary();
      };
      card.appendChild(img);
      card.appendChild(favBtn);
      card.appendChild(name);
      card.appendChild(meta);
      card.onclick = () => {
        tool = "place";
        armedKind = item.id;
        setStatus("Click the map to place " + item.name);
        renderLibrary();
      };
      card.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", item.id);
        tool = "place";
        armedKind = item.id;
      });
      grid.appendChild(card);
    });
    ui.libScroll.appendChild(grid);
    const pager = document.createElement("div");
    pager.className = "hhePager";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "Prev";
    prev.disabled = page <= 0;
    prev.onclick = () => { page -= 1; ui.libScroll.scrollTop = 0; renderLibrary(); };
    const label = document.createElement("span");
    const from = list.length ? page * PAGE_SIZE + 1 : 0;
    const to = Math.min(list.length, (page + 1) * PAGE_SIZE);
    label.textContent = from + "–" + to + " of " + list.length;
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    next.disabled = page >= pages - 1;
    next.onclick = () => { page += 1; ui.libScroll.scrollTop = 0; renderLibrary(); };
    pager.appendChild(prev);
    pager.appendChild(label);
    pager.appendChild(next);
    ui.libScroll.appendChild(pager);
    const title = document.createElement("h4");
    title.textContent = "SPAWNS";
    ui.libScroll.appendChild(title);
    [["hunter", "Hunter spawn"], ["tracker", "Tracker spawn"], ["monster", "Monster spawn"]].forEach((pair) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hheSpawn" + (tool === "spawn-" + pair[0] ? " armed" : "");
      btn.textContent = pair[1];
      btn.onclick = () => {
        tool = "spawn-" + pair[0];
        armedKind = "";
        setStatus("Click the map to move the " + pair[1].toLowerCase());
        renderLibrary();
      };
      ui.libScroll.appendChild(btn);
    });
    const note = document.createElement("p");
    note.className = "hheNote";
    note.textContent = "Warehouse style shows Kenney sprites that match the current map. Turn it off to browse other CC0 packs. Nothing here is placed until you click the map. Saved maps store the asset id, not the image. On Render, saved maps last until the service restarts unless MAP_STORE_DIR is a persistent disk.";
    ui.libScroll.appendChild(note);
    ui.libScroll.scrollTop = kept;
  }

  function showModal(html) {
    ui.modal.classList.remove("hidden");
    ui.modal.innerHTML = "<div class=\"hheDialog\">" + html + "</div>";
  }

  function hideModal() {
    ui.modal.classList.add("hidden");
    ui.modal.innerHTML = "";
  }

  function openSave() {
    showModal(
      "<h3>Save map</h3><label>Map name</label><input id=\"hheSaveName\" maxlength=\"40\" value=\"" + (doc.name || "").replace(/\"/g, "&quot;") + "\">"
      + "<button type=\"button\" class=\"primary\" id=\"hheSaveConfirm\">Save</button> <button type=\"button\" id=\"hheSaveCancel\">Cancel</button>"
      + "<p id=\"hheSaveErr\" class=\"hheNote\"></p>"
    );
    $("hheSaveCancel").onclick = hideModal;
    $("hheSaveConfirm").onclick = () => {
      const name = $("hheSaveName").value.trim();
      if (!name) { $("hheSaveErr").textContent = "Enter a map name."; return; }
      doc.name = name.slice(0, 40);
      socket.emit("hhEditorSave", {
        editorName: accessName,
        map: {
          id: doc.isNew ? "new" : doc.id,
          baseVersion: doc.version,
          name: doc.name,
          width: doc.width,
          height: doc.height,
          ground: "procedural",
          spawns: doc.spawns,
          objects: doc.objects,
          texts: doc.texts
        }
      });
    };
  }

  function openExisting() {
    if (socket) socket.emit("hhListMaps");
    showOpenList();
  }

  function showOpenList() {
    const buttons = mapList.map((map) => {
      return "<button type=\"button\" data-id=\"" + map.id + "\">" + map.name + " — " + map.width + "×" + map.height + "</button>";
    }).join("");
    showModal("<h3>Edit existing map</h3><div class=\"hheList\">" + (buttons || "<p>No maps yet.</p>") + "</div><button type=\"button\" id=\"hheOpenCancel\">Cancel</button>");
    $("hheOpenCancel").onclick = hideModal;
    ui.modal.querySelectorAll("[data-id]").forEach((btn) => {
      btn.onclick = () => {
        socket.emit("hhEditorLoad", { editorName: accessName, id: btn.getAttribute("data-id") });
      };
    });
  }

  function adoptMap(map, isNew) {
    doc = {
      id: map.id,
      isNew: !!isNew,
      name: map.name,
      version: map.version || 1,
      width: map.width,
      height: map.height,
      ground: "procedural",
      spawns: map.spawns,
      objects: map.objects || [],
      texts: map.texts || []
    };
    selection = null;
    undo = [];
    redo = [];
    ui.width.value = doc.width;
    ui.height.value = doc.height;
    fillProps();
    fitMap();
    setStatus(doc.name + "  " + doc.width + "×" + doc.height);
  }

  function build() {
    const root = $("hhEditorScreen");
    root.innerHTML = ""
      + "<div class=\"hheTop\">"
      + "<button type=\"button\" id=\"hheNew\">New map</button>"
      + "<button type=\"button\" id=\"hheOpen\">Edit existing</button>"
      + "<button type=\"button\" class=\"primary\" id=\"hheSave\">Save map</button>"
      + "<button type=\"button\" id=\"hheClose\">Close</button>"
      + "<label>Width<input id=\"hheW\" type=\"number\" value=\"2000\"></label>"
      + "<label>Height<input id=\"hheH\" type=\"number\" value=\"1500\"></label>"
      + "<button type=\"button\" id=\"hheResize\">Resize map</button>"
      + "<label class=\"hheCheck\"><input id=\"hheGrid\" type=\"checkbox\"> Grid</label>"
      + "<label class=\"hheCheck\"><input id=\"hheSnap\" type=\"checkbox\"> Snap</label>"
      + "<label>Grid<select id=\"hheGridSize\"><option>16</option><option selected>32</option><option>64</option></select></label>"
      + "<button type=\"button\" id=\"hheFit\">Fit</button>"
      + "<button type=\"button\" id=\"hheResetZoom\">Reset zoom</button>"
      + "<label>Text<input id=\"hheTextTool\" type=\"text\" value=\"LOADING BAY\"></label>"
      + "<button type=\"button\" id=\"hheTextBtn\">Text tool</button>"
      + "<span class=\"hheStatus\" id=\"hheStatus\"></span>"
      + "</div>"
      + "<div class=\"hheBody\"><aside class=\"hheLib\" id=\"hheLib\">"
      + "<div class=\"hheLibHead\"><input id=\"hheSearch\" type=\"search\" placeholder=\"Search assets...\">"
      + "<div id=\"hheChips\" class=\"hheChips\"></div>"
      + "<div class=\"hheFilters\">"
      + "<label>Source<select id=\"hheSource\"><option value=\"all\">All</option><option value=\"Kenney\">Kenney</option><option value=\"OpenGameArt\">OpenGameArt</option><option value=\"itch.io\">itch.io</option><option value=\"other\">Other</option></select></label>"
      + "<label>License<select id=\"hheLicense\"><option value=\"all\">All</option><option value=\"CC0\">CC0</option></select></label>"
      + "<label>Style<select id=\"hheStyle\"><option value=\"all\">All</option><option value=\"pixel\">Pixel</option><option value=\"clean-2d\">Clean 2D</option><option value=\"top-down\">Top-down</option><option value=\"industrial\">Industrial</option><option value=\"generic\">Generic</option></select></label>"
      + "<label>Category<select id=\"hheGroup\"><option value=\"all\">All</option><option value=\"Furniture\">Furniture</option><option value=\"Industrial\">Industrial</option><option value=\"Storage\">Storage</option><option value=\"Vehicle\">Vehicle</option><option value=\"Structure\">Structure</option><option value=\"Decoration\">Decoration</option></select></label>"
      + "<label class=\"hheCheck\"><input id=\"hheWarehouse\" type=\"checkbox\" checked> Warehouse style</label>"
      + "</div></div><div class=\"hheLibScroll\" id=\"hheLibScroll\"></div></aside>"
      + "<div class=\"hheStage\" id=\"hheStage\"><canvas id=\"hheCanvas\"></canvas></div><aside class=\"hheProps\" id=\"hheProps\"></aside></div>"
      + "<div class=\"hheModal hidden\" id=\"hheModal\"></div>";
    ui = {
      status: $("hheStatus"),
      width: $("hheW"),
      height: $("hheH"),
      lib: $("hheLib"),
      libScroll: $("hheLibScroll"),
      chips: $("hheChips"),
      props: $("hheProps"),
      stage: $("hheStage"),
      canvas: $("hheCanvas"),
      modal: $("hheModal"),
      textInput: $("hheTextTool")
    };
    $("hheNew").onclick = () => {
      if (doc && doc.objects.length && !window.confirm("Start a new map? Unsaved changes on this map stay only in this editor until you save.")) return;
      const w = Math.round(Number(ui.width.value)) || 2000;
      const h = Math.round(Number(ui.height.value)) || 1500;
      adoptMap(blankMap(w, h), true);
      doc.isNew = true;
      doc.version = 0;
      setStatus("New map " + doc.width + "×" + doc.height);
    };
    $("hheOpen").onclick = openExisting;
    $("hheSave").onclick = openSave;
    $("hheClose").onclick = closeEditor;
    $("hheResize").onclick = resizeMap;
    $("hheGrid").onchange = () => { gridOn = $("hheGrid").checked; };
    $("hheSnap").onchange = () => { snapOn = $("hheSnap").checked; };
    $("hheGridSize").onchange = () => { gridSize = Number($("hheGridSize").value) || 32; };
    $("hheFit").onclick = fitMap;
    $("hheResetZoom").onclick = () => { zoom = 1; panX = 20; panY = 20; };
    $("hheTextBtn").onclick = () => {
      textDraft = ui.textInput.value;
      tool = "text";
      armedKind = "";
      setStatus("Click the map to place text");
      renderLibrary();
    };
    ui.textInput.addEventListener("input", () => { textDraft = ui.textInput.value; });
    CHIPS.forEach((pair) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = pair[1];
      btn.setAttribute("data-chip", pair[0]);
      btn.onclick = () => { chip = pair[0]; page = 0; renderLibrary(); };
      ui.chips.appendChild(btn);
    });
    const resetPage = () => { page = 0; renderLibrary(); };
    $("hheSearch").addEventListener("input", () => { query = $("hheSearch").value; resetPage(); });
    $("hheSource").onchange = () => { sourceFilter = $("hheSource").value; resetPage(); };
    $("hheLicense").onchange = () => { licenseFilter = $("hheLicense").value; resetPage(); };
    $("hheStyle").onchange = () => { styleFilter = $("hheStyle").value; resetPage(); };
    $("hheGroup").onchange = () => { groupFilter = $("hheGroup").value; resetPage(); };
    $("hheWarehouse").onchange = () => { warehouseOnly = $("hheWarehouse").checked; resetPage(); };
    ui.canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    ui.canvas.addEventListener("wheel", onWheel, { passive: false });
    ui.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    ui.canvas.addEventListener("dragover", (e) => e.preventDefault());
    ui.canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      if (id) placeObject(id, eventWorld(e));
    });
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", sizeCanvas);
    built = true;
  }

  function typingTarget(e) {
    const tag = e.target && e.target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function onKey(e) {
    if (!doc || $("hhEditorScreen").classList.contains("hidden")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); if (!typingTarget(e)) undoEdit(); return; }
    if (mod && (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))) { e.preventDefault(); if (!typingTarget(e)) redoEdit(); return; }
    if (typingTarget(e)) return;
    if (e.code === "Delete" || e.code === "Backspace") { e.preventDefault(); deleteSelection(); }
    else if (mod && e.code === "KeyD") { e.preventDefault(); duplicateSelection(); }
    else if (e.code === "KeyQ") nudgeRotation(-15);
    else if (e.code === "KeyE") nudgeRotation(15);
    else if (e.code === "BracketLeft") nudgeScale(0.9);
    else if (e.code === "BracketRight") nudgeScale(1.1);
  }

  function closeEditor() {
    $("hhEditorScreen").classList.add("hidden");
    const lobby = $("lobbyScreen");
    if (lobby) lobby.classList.remove("hidden");
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    accessName = "";
    doc = null;
  }

  function openEditor(data, editorName) {
    accessName = editorName;
    catalog = data.catalog || [];
    mapList = data.maps || mapList;
    if (!built) build();
    $("lobbyScreen").classList.add("hidden");
    $("hhEditorScreen").classList.remove("hidden");
    renderLibrary();
    adoptMap(blankMap(2000, 1500), true);
    sizeCanvas();
    fitMap();
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    setStatus("Loading asset library…");
    loadLibrary().then(() => {
      renderLibrary();
      setStatus("New map. " + library.length + " library sprites. Warehouse style shows the matching Kenney set.");
    });
  }

  function renderChoices() {
    const box = $("hhMapChoices");
    const meta = $("hhMapMeta");
    if (!box) return;
    box.innerHTML = "";
    mapList.forEach((map) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = map.name;
      btn.className = map.id === selectedMapId ? "selected" : "";
      btn.onclick = () => {
        selectedMapId = map.id;
        renderChoices();
        if (socket) socket.emit("hhMapPreview", { id: map.id });
      };
      box.appendChild(btn);
    });
    const current = mapList.find((map) => map.id === selectedMapId) || mapList[0];
    if (current && meta) {
      const when = current.updatedAt ? " · updated " + current.updatedAt.slice(0, 10) : "";
      meta.textContent = current.name + " — " + current.width + "×" + current.height + when;
    }
  }

  function drawPreview(canvas, map) {
    if (!canvas || !map) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const z = Math.min(w / map.w, h / map.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#100e0c";
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(z, 0, 0, z, (w - map.w * z) / 2, (h - map.h * z) / 2);
    const view = { x0: 0, y0: 0, x1: map.w, y1: map.h };
    drawGround(ctx, map.w, map.h, view);
    (map.obstacles || []).forEach((o) => {
      const s = o.scale > 0 ? o.scale : 1;
      ctx.save();
      ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
      if (o.rotation) ctx.rotate((o.rotation * Math.PI) / 180);
      const im = o.src ? loadImg(o.src) : null;
      if (!im || !drawContained(ctx, im, (-o.w * s) / 2, (-o.h * s) / 2, o.w * s, o.h * s)) {
        ctx.fillStyle = KIND_COLOR[o.kind] || "#667";
        ctx.fillRect((-o.w * s) / 2, (-o.h * s) / 2, o.w * s, o.h * s);
      }
      ctx.restore();
    });
    (map.texts || []).forEach((t) => {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.fillStyle = "rgba(255,240,210,.8)";
      ctx.font = "bold " + (t.size || 18) + "px Arial";
      ctx.textAlign = "center";
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    });
  }

  function init(shared) {
    socket = shared;
    loadLibrary();
    const enter = $("hhEditorEnter");
    const nameInput = $("hhEditorName");
    const msg = $("hhEditorMsg");
    let pendingName = "";
    if (enter && nameInput) {
      const submit = () => {
        pendingName = nameInput.value;
        if (msg) msg.textContent = "";
        socket.emit("hhEditorOpen", { editorName: pendingName });
      };
      enter.onclick = submit;
      nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    }
    socket.on("hhMapList", (data) => {
      mapList = (data && data.maps) || [];
      if (!mapList.some((map) => map.id === selectedMapId)) selectedMapId = "default";
      renderChoices();
      if (ui.modal && !ui.modal.classList.contains("hidden") && ui.modal.querySelector("#hheOpenCancel")) showOpenList();
      const preview = $("hhMapPreview");
      if (preview && socket) socket.emit("hhMapPreview", { id: selectedMapId });
    });
    socket.on("hhMapPreview", (data) => {
      if (!data || !data.ok) return;
      drawPreview($("hhMapPreview"), data.map);
    });
    socket.on("hhEditorOpen", (data) => {
      if (!data || !data.ok) {
        if (msg) msg.textContent = (data && data.error) || "That name cannot open the editor.";
        return;
      }
      openEditor(data, pendingName);
    });
    socket.on("hhEditorLoad", (data) => {
      if (!data || !data.ok) {
        setStatus((data && data.error) || "Could not open that map.");
        return;
      }
      hideModal();
      adoptMap(data.map, false);
    });
    socket.on("hhEditorSave", (data) => {
      const err = $("hheSaveErr");
      if (!data || !data.ok) {
        if (err) err.textContent = (data && data.error) || "Cannot save map.";
        else setStatus((data && data.error) || "Cannot save map.");
        return;
      }
      hideModal();
      adoptMap(data.map, false);
      if (data.maps) {
        mapList = data.maps;
        renderChoices();
      }
      setStatus("Saved " + data.map.name + " (version " + data.map.version + ")");
    });
  }

  window.HiddenHunterEditor = {
    init,
    refreshMaps: function () { if (socket) socket.emit("hhListMaps"); },
    selectedMapId: function () { return selectedMapId || "default"; },
    drawPreview
  };
})();
