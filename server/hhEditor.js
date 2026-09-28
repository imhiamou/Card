/*
 * Hidden Hunter map-editor socket API.
 * Listing, previews, load, and save are available to every connected player.
 * A save succeeds only after the map is stored in Postgres.
 */

const maps = require("./hhMapStore");

function register(socket) {
  socket.on("hhListMaps", async () => {
    try {
      socket.emit("hhMapList", await maps.listMaps());
    } catch (err) {
      socket.emit("hhMapList", { ok: false, error: maps.LOAD_FAIL, maps: [] });
    }
  });

  socket.on("hhMapPreview", async (data) => {
    const id = data && typeof data.id === "string" ? data.id : "default";
    const map = await maps.previewOf(id);
    if (!map) {
      socket.emit("hhMapPreview", { ok: false, error: "That map is not available." });
      return;
    }
    socket.emit("hhMapPreview", { ok: true, map });
  });

  socket.on("hhEditorOpen", async () => {
    const listed = await maps.listMaps();
    socket.emit("hhEditorOpen", {
      ok: true,
      catalog: maps.ASSETS,
      maps: listed.maps,
      error: listed.ok ? "" : listed.error
    });
  });

  socket.on("hhEditorLoad", async (data) => {
    const result = await maps.loadForEditor(data && data.id);
    socket.emit("hhEditorLoad", result.ok
      ? { ok: true, map: result.map }
      : { ok: false, error: result.error || "That map could not be loaded." });
  });

  socket.on("hhEditorSave", async (data) => {
    try {
      const result = await maps.saveMap(data && data.map);
      if (!result.ok) {
        socket.emit("hhEditorSave", { ok: false, error: result.error || maps.PERSIST_FAIL });
        return;
      }
      const listed = await maps.listMaps();
      socket.emit("hhEditorSave", {
        ok: true,
        map: result.map,
        maps: listed.maps,
        error: listed.ok ? "" : listed.error
      });
      socket.broadcast.emit("hhMapList", listed);
    } catch (err) {
      socket.emit("hhEditorSave", { ok: false, error: maps.PERSIST_FAIL });
    }
  });
}

module.exports = { register };
