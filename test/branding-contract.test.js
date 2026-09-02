"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function pngDimensions(filePath) {
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test("manifest assigns custom icons at every Chrome extension size", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const expected = { 16: "icons/icon16.png", 32: "icons/icon32.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
  assert.deepEqual(manifest.icons, expected);
  assert.deepEqual(manifest.action.default_icon, {
    16: expected[16], 32: expected[32], 48: expected[48]
  });
  for (const [size, relativePath] of Object.entries(expected)) {
    assert.deepEqual(pngDimensions(path.join(root, relativePath)), {
      width: Number(size), height: Number(size)
    });
  }
});

test("popup and notifications use the custom Court Watcher mark", () => {
  const popup = fs.readFileSync(path.join(root, "popup.html"), "utf8");
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  assert.match(popup, /class="brand-mark" src="icons\/icon48\.png"/);
  assert.match(background, /icons\/icon128\.png/);
});
