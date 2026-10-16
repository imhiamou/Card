const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Create Lobby submits the Play form without a second setup window", () => {
  const index = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /id="lobbyPlay"/);
  assert.match(html, /id="lobbyUpdates"/);
  assert.match(html, />Play</);
  assert.match(html, />Updates</);
  assert.equal(html.includes('id="lobbySetup"'), false);
  assert.equal(html.includes("lobbySetupConfirm"), false);
  assert.match(html, /id="gameSelect"/);
  assert.match(html, /id="createCode"/);
  assert.match(html, /id="roomCode"/);
  assert.match(html, /id="dominoMaxPlayers"/);
  assert.match(html, /id="gamewebCheckUpdate"/);
  const createAt = index.indexOf('document.getElementById("createBtn").onclick');
  assert.ok(createAt > 0);
  const createFn = index.slice(createAt, createAt + 180);
  assert.match(createFn, /submitCreateLobby\(\)/);
  assert.doesNotMatch(createFn, /openLobbySetup/);
  const submitAt = index.indexOf("function submitCreateLobby");
  const submit = index.slice(submitAt, createAt);
  assert.match(submit, /socket\.emit\("createLobby"/);
  assert.match(index, /socket\.emit\("joinLobby"/);
  assert.equal(index.includes("function openLobbySetup"), false);
  assert.equal(index.includes('data-app-tab="room"'), false);
});

test("the lobby Updates button reuses the Android updater", () => {
  const updater = fs.readFileSync(path.join(__dirname, "../assets/android-update.js"), "utf8");
  assert.match(updater, /gamewebCheckUpdate/);
  assert.match(updater, /Checking…/);
  assert.match(updater, /downloadAndInstall/);
  assert.doesNotMatch(updater, /api\.github\.com\/repos\/imhiamou\/Card\/releases\/latest/);
});
