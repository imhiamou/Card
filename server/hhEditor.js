/*
 * Hidden Hunter map-editor socket API.
 * Listing, previews, load, and save are available to every connected player.
 * Saved maps are validated on the server. The client cannot mark a map saved
 * unless this handler accepts it.
 */

const maps = require("./hhMapStore");

function register(socket) {
  socket.on("hhListMaps", () => {
    socket.emit("hhMapList", { maps: maps.listMaps() });
  });

  socket.on("hhMapPreview", (data) => {
    const id = data && typeof data.id === "string" ? data.id : "default";
    const map = maps.previewOf(id);
    if (!map) {
      socket.emit("hhMapPreview", { ok: false, error: "That map is not available." });
      return;
    }
    socket.emit("hhMapPreview", { ok: true, map });
  });

  socket.on("hhEditorOpen", () => {
    socket.emit("hhEditorOpen", {
      ok: true,
      catalog: maps.ASSETS,
      maps: maps.listMaps()
    });
  });

  socket.on("hhEditorLoad", (data) => {
    const result = maps.loadForEditor(data && data.id);
    socket.emit("hhEditorLoad", result.ok
      ? { ok: true, map: result.map }
      : { ok: false, error: result.error || "That map could not be loaded." });
  });

  socket.on("hhEditorSave", async (data) => {
    const result = await maps.saveMap(data && data.map);
    if (!result.ok) {
      socket.emit("hhEditorSave", { ok: false, error: result.error || "Cannot save map." });
      return;
    }
    socket.emit("hhEditorSave", {
      ok: true,
      map: result.map,
      maps: maps.listMaps()
    });
    socket.broadcast.emit("hhMapList", { maps: maps.listMaps() });
  });
}

module.exports = { register };
