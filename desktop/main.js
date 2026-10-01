/*
 * Hidden Hunter desktop shell.
 *
 * Serves the existing frontend on 127.0.0.1 and opens it in a window.
 * Multiplayer stays on https://cardb-2uys.onrender.com. This process does
 * not start Express, Socket.IO, or PostgreSQL.
 */

const { app, BrowserWindow, Menu, dialog } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");
const { startStaticServer } = require("./staticServer");
const { createUpdateController } = require("./updater");

function frontendRoot() {
  // Development serves the repository root. The installer copies that same
  // frontend to resources/frontend so the static server is not reading file://
  // or the asar archive.
  if (app.isPackaged) return path.join(process.resourcesPath, "frontend");
  return path.resolve(__dirname, "..");
}

let staticServer = null;

function attachGuards(win, origin) {
  function allow(target) {
    try {
      return new URL(target).origin === origin;
    } catch (err) {
      return false;
    }
  }
  win.webContents.on("will-navigate", (event, target) => {
    if (!allow(target)) event.preventDefault();
  });
  win.webContents.on("will-redirect", (event, target) => {
    if (!allow(target)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: "Hidden Hunter",
    backgroundColor: "#181c24",
    fullscreen: false,
    fullscreenable: true,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  win.on("page-title-updated", (event) => {
    event.preventDefault();
  });
  win.setTitle("Hidden Hunter");
  attachGuards(win, new URL(url).origin);
  win.loadURL(url);
  return win;
}

app.whenReady().then(async () => {
  staticServer = await startStaticServer({ root: frontendRoot() });
  const url = "http://" + staticServer.host + ":" + staticServer.port + "/index.html";
  console.log("Hidden Hunter desktop frontend: " + url);
  const win = createWindow(url);
  createUpdateController({
    autoUpdater,
    dialog,
    getWindow: () => win,
    isPackaged: app.isPackaged
  }).start();
});

app.on("window-all-closed", () => {
  if (staticServer) staticServer.close();
  app.quit();
});
