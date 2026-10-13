const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Create Lobby opens setup and confirms on the second action", () => {
  const index = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /id="lobbySetup"/);
  assert.match(html, /id="lobbySetupCancel"/);
  assert.match(html, /id="lobbySetupConfirm"/);
  const createAt = index.indexOf('document.getElementById("createBtn").onclick');
  const confirmAt = index.indexOf("function submitCreateLobby");
  assert.ok(createAt > 0 && confirmAt > 0);
  const createFn = index.slice(createAt, index.indexOf("const lobbySetupCancel"));
  assert.match(createFn, /openLobbySetup\(\)/);
  assert.doesNotMatch(createFn, /createLobby/);
  const submit = index.slice(confirmAt, createAt);
  assert.match(submit, /socket\.emit\("createLobby"/);
  assert.match(index, /function closeLobbySetup/);
  assert.match(index, /closeLobbySetup\(\)/);
});

test("the lobby Updates button reuses the Android updater", () => {
  const updater = fs.readFileSync(path.join(__dirname, "../assets/android-update.js"), "utf8");
  assert.match(updater, /gamewebCheckUpdate/);
  assert.match(updater, /Checking…/);
  assert.match(updater, /downloadAndInstall/);
  assert.doesNotMatch(updater, /api\.github\.com\/repos\/imhiamou\/Card\/releases\/latest/);
});
