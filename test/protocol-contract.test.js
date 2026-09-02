"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(name) {
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

function protocolVersion(text) {
  const match = text.match(/const CONTENT_PROTOCOL_VERSION = (\d+);/);
  return match ? Number(match[1]) : null;
}

test("background and content scripts share the stale-page recovery protocol", () => {
  const background = source("background.js");
  const content = source("content.js");
  const popup = source("popup.js");
  const manifest = JSON.parse(source("manifest.json"));
  const packageJson = JSON.parse(source("package.json"));
  assert.equal(protocolVersion(background), protocolVersion(content));
  assert.equal(protocolVersion(popup), protocolVersion(content));
  assert.ok(protocolVersion(content) > 0);
  assert.match(background, /pendingImmediateStart/);
  assert.match(background, /chrome\.tabs\.reload/);
  assert.match(content, /GET_PROTOCOL_VERSION/);
  assert.match(content, /protocolVersion: CONTENT_PROTOCOL_VERSION/);
  assert.match(popup, /chrome\.runtime\.reload/);
  assert.match(background, /refreshStaleBookingTabsAfterUpdate/);
  assert.equal(manifest.version, packageJson.version);
  assert.match(popup, new RegExp(`const BUILD_VERSION = "${manifest.version.replaceAll(".", "\\.")}";`));
});

test("content script leaves the daily booking limit to UCSD Recreation", () => {
  const content = source("content.js");
  assert.doesNotMatch(content, /UCSD_DAILY_BOOKING_LIMIT/);
  assert.doesNotMatch(content, /countBookingsForDate/);
  assert.match(content, /targetButton\.click\(\)/);
});

test("content script books only an acceptable verified two-slot pair", () => {
  const content = source("content.js");
  assert.match(content, /findConsecutiveSlotPair/);
  assert.match(content, /findSameAreaCourtPair/);
  assert.match(content, /bookTwoHourPair/);
  assert.match(content, /waitForBookingConfirmation/);
  assert.match(content, /first hour is confirmed, but the second hour was not booked/i);
  assert.doesNotMatch(content, /rankMatches\(/);
});
