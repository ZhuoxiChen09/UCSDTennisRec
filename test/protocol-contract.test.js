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
  assert.match(content, /findAnyConsecutivePair/);
  assert.match(content, /bookTwoHourPair/);
  assert.match(content, /recoverMissingSecondHour/);
  assert.match(content, /scanExactHourFallback/);
  assert.match(content, /Continuing the all-court search/);
  assert.match(content, /waitForBookingConfirmation/);
  assert.match(content, /Core\.courtNamesMatch\(booking\.court, match\.court\)/);
  assert.match(content, /first hour is confirmed, but the second hour was not booked/i);
  assert.doesNotMatch(content, /rankMatches\(/);
});

test("actual extension distinguishes live UCSD from verified simulator test cases", () => {
  const background = source("background.js");
  const content = source("content.js");
  const popup = source("popup.js");
  assert.match(content, /function pageRunContext\(/);
  assert.match(content, /environment: "production"/);
  assert.match(content, /environment: "simulator"/);
  assert.match(content, /dataset\.ucsdEnvironment === "simulator"/);
  assert.match(content, /not the verified UCSD Tennis simulator/);
  assert.match(background, /TEST ·/);
  assert.match(background, /LIVE UCSD ·/);
  assert.match(popup, /function renderEnvironment\(/);
  assert.match(popup, /TEST SIMULATOR/);
  assert.match(popup, /LIVE UCSD/);
});

test("popup provides a direct entry button for the local test simulator", () => {
  const popupHtml = source("popup.html");
  const popup = source("popup.js");
  assert.match(popupHtml, /id="openSimulator"/);
  assert.match(popupHtml, /Open Test Simulator/);
  assert.match(popup, /const TEST_SIMULATOR_URL = "http:\/\/127\.0\.0\.1:4173\/booking\//);
  assert.match(popup, /const TEST_SIMULATOR_HEALTH_URL = "http:\/\/127\.0\.0\.1:4173\/api\/state"/);
  assert.match(popup, /fetch\(TEST_SIMULATOR_HEALTH_URL, \{ cache: "no-store" \}\)/);
  assert.match(popup, /Test simulator is offline\. Run npm run simulator/);
  assert.match(popup, /chrome\.tabs\.create\(\{ url: TEST_SIMULATOR_URL \}\)/);
  assert.match(popup, /elements\.openSimulator\.addEventListener\("click", openTestSimulator\)/);
});

test("popup always derives the next release choice from the latest released date", () => {
  const popup = source("popup.js");
  assert.match(popup, /const latestReleasedDate = dates\.map/);
  assert.match(popup, /Core\.addDaysToDateKey\(latestReleasedDate, 1\)/);
  assert.match(popup, /choices\.set\(nextReleaseDate, `Next release/);
  assert.doesNotMatch(popup, /choices\.set\(savedDate/);
  assert.match(popup, /simulatorLimitReached/);
  assert.match(popup, /daily test limit reached/);
});

test("live watcher uses a bounded one-second release window with server backoff", () => {
  const core = source("lib/booking-core.js");
  const content = source("content.js");
  const popupHtml = source("popup.html");
  assert.match(core, /MIN_POLL_SECONDS = 1/);
  assert.match(core, /MAX_WINDOW_END_SECONDS = 5 \* 60/);
  assert.match(content, /response\.status === 429/);
  assert.match(content, /Retry-After/);
  assert.match(popupHtml, /12:05 AM/);
});

test("a newly released live date refreshes before using UCSD's Book Now controls", () => {
  const background = source("background.js");
  const content = source("content.js");
  assert.match(content, /context\.environment === "production" && !findDateButton\(selectedDate\)/);
  assert.match(content, /type: "REFRESH_FOR_RELEASE"/);
  assert.match(content, /if \(!dateButton\) return null/);
  assert.match(background, /message\.type === "REFRESH_FOR_RELEASE"/);
  assert.match(background, /chrome\.tabs\.reload\(tab\.id, \{ bypassCache: true \}\)/);
  assert.match(content, /if \(options\.releaseRefreshAttempted\)/);
  assert.match(background, /releaseRefreshTargetDate === settings\?\.targetDate/);
});

test("the live start button arms midnight without starting an early polling loop", () => {
  const background = source("background.js");
  const popup = source("popup.js");
  const popupHtml = source("popup.html");
  assert.match(popup, /pageInfo\?\.environment === "production"/);
  assert.match(popup, /await armNextRelease\(\)/);
  assert.match(popup, /elements\.start\.addEventListener\("click", startWatcher\)/);
  assert.match(popup, /No availability checks will run before midnight/);
  assert.match(background, /chrome\.alarms\.create\(ALARM_NAME, \{ when: message\.when \}\)/);
  assert.match(background, /No availability checks will run before midnight/);
  assert.match(popupHtml, /without polling until 12:00:00 AM/);
});

test("simulator exposes a weighted virtual competitor race", () => {
  const server = source("simulator/server.js");
  const simulator = source("simulator/simulator.js");
  assert.match(server, /competitorSlotWeight/);
  assert.match(server, /\/api\/competitor-claim/);
  assert.match(server, /\/api\/competitor-split/);
  assert.match(server, /race-recovery/);
  assert.match(simulator, /startCompetitors/);
  assert.match(simulator, /startSplitRush/);
  assert.match(simulator, /race-recovery/);
  assert.match(simulator, /releaseDateWithRush/);
  assert.match(simulator, /runCompetitorClaims\(result\.dateKey, total, runId, status, true\)/);
  assert.match(server, /18 \* 60, 19 \* 60, 20 \* 60/);
});
