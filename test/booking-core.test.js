"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../lib/booking-core.js");

test("normalizes court names from the UCSD page", () => {
  assert.equal(Core.normalizeCourtName(" Tennis |    North 10 "), "Tennis | North 10");
});

test("parses AM and PM booking start times", () => {
  assert.equal(Core.parseStartMinutes("7:00 - 8:00 AM"), 420);
  assert.equal(Core.parseStartMinutes("11:00 AM - 12:00 PM"), 660);
  assert.equal(Core.parseStartMinutes("12:00 - 1:00 PM"), 720);
  assert.equal(Core.parseStartMinutes("9:00 - 10:00 PM"), 1260);
});

test("counts reservations per date for informational display", () => {
  const bookings = [
    { dateText: "Wed, Sep 2, 2026" },
    { dateText: "September 2, 2026" },
    { dateText: "Thu, Sep 3, 2026" },
    { dateText: "9/4/2026" }
  ];
  assert.equal(Core.parseBookingDateKey("Wed, Sep 2, 2026"), "2026-09-02");
  assert.equal(Core.parseBookingDateKey("9/4/2026"), "2026-09-04");
  assert.equal(Core.countBookingsForDate(bookings, "2026-09-02"), 2);
  assert.equal(Core.countBookingsForDate(bookings, "2026-09-03"), 1);
  assert.equal(Core.countBookingsForDate(bookings, "2026-09-05"), 0);
});

test("checks a preferred time window inclusively", () => {
  assert.equal(Core.isSlotInWindow("7:00 - 8:00 PM", 1140, 1260), true);
  assert.equal(Core.isSlotInWindow("9:00 - 10:00 PM", 1140, 1260), true);
  assert.equal(Core.isSlotInWindow("6:00 - 7:00 PM", 1140, 1260), false);
});

test("matches only explicitly selected hourly starts", () => {
  assert.equal(Core.isPreferredSlot("7:00 - 8:00 AM", [420, 540]), true);
  assert.equal(Core.isPreferredSlot("8:00 - 9:00 AM", [420, 540]), false);
  assert.equal(Core.isPreferredSlot("9:00 - 10:00 AM", [420, 540]), true);
});

test("finds two consecutive selected hours on the same court", () => {
  const pair = Core.findConsecutiveSlotPair([
    { court: "Tennis | North 8", slotText: "7:00 - 8:00 AM" },
    { court: "Tennis | North 8", slotText: "8:00 - 9:00 AM" },
    { court: "Tennis | North 8", slotText: "9:00 - 10:00 AM" }
  ], [480, 540, 420]);
  assert.deepEqual(pair.map((slot) => Core.parseStartMinutes(slot.slotText)), [480, 540]);
});

test("does not turn nonconsecutive selected hours into a pair", () => {
  assert.equal(Core.hasConsecutiveStarts([420, 540]), false);
  assert.equal(Core.findConsecutiveSlotPair([
    { court: "Tennis | North 8", slotText: "7:00 - 8:00 AM" },
    { court: "Tennis | North 8", slotText: "9:00 - 10:00 AM" }
  ], [420, 540]), null);
});

test("allows consecutive hours on different courts in the same area", () => {
  const northPair = Core.findSameAreaCourtPair([
    { court: "Tennis | North 6", slotText: "7:00 - 8:00 AM" },
    { court: "Tennis | North 7", slotText: "8:00 - 9:00 AM" }
  ], [420, 480], ["Tennis | North 6", "Tennis | North 7"]);
  assert.deepEqual(northPair.map((slot) => slot.court), ["Tennis | North 6", "Tennis | North 7"]);

  const muirPair = Core.findSameAreaCourtPair([
    { court: "Tennis | Muir 4", slotText: "7:00 - 8:00 AM" },
    { court: "Tennis | Muir 3", slotText: "8:00 - 9:00 AM" }
  ], [420, 480], ["Tennis | Muir 4", "Tennis | Muir 3"]);
  assert.deepEqual(muirPair.map((slot) => slot.court), ["Tennis | Muir 4", "Tennis | Muir 3"]);
});

test("prefers nearby same-area courts and never mixes North with Muir", () => {
  const nearby = Core.findSameAreaCourtPair([
    { court: "Tennis | North 6", slotText: "7:00 - 8:00 AM" },
    { court: "Tennis | North 12", slotText: "8:00 - 9:00 AM" },
    { court: "Tennis | North 7", slotText: "8:00 - 9:00 AM" }
  ], [420, 480], ["Tennis | North 6", "Tennis | North 7", "Tennis | North 12"]);
  assert.deepEqual(nearby.map((slot) => slot.court), ["Tennis | North 6", "Tennis | North 7"]);

  const rejected = Core.findSameAreaCourtPair([
    { court: "Tennis | North 9", slotText: "7:00 - 8:00 AM" },
    { court: "Tennis | Muir 4", slotText: "8:00 - 9:00 AM" }
  ], [420, 480]);
  assert.equal(rejected, null);
});

test("chooses the newest released date", () => {
  const latest = Core.pickLatestDate([
    { year: 2026, month: 8, day: 29 },
    { year: 2026, month: 8, day: 31 },
    { year: 2026, month: 8, day: 30 }
  ]);
  assert.deepEqual(latest, { year: 2026, month: 8, day: 31 });
});

test("ranks court preference before start time", () => {
  const ranked = Core.rankMatches([
    { court: "Tennis | Muir 1", slotText: "7:00 - 8:00 AM" },
    { court: "Tennis | North 10", slotText: "9:00 - 10:00 AM" },
    { court: "Tennis | North 10", slotText: "8:00 - 9:00 AM" }
  ], ["Tennis | North 10", "Tennis | Muir 1"]);
  assert.equal(ranked[0].court, "Tennis | North 10");
  assert.equal(ranked[0].slotText, "8:00 - 9:00 AM");
});

test("respects the selected hour priority when courts match", () => {
  const ranked = Core.rankMatches([
    { court: "Tennis | North 10", slotText: "7:00 - 8:00 AM" },
    { court: "Tennis | North 10", slotText: "9:00 - 10:00 AM" }
  ], ["Tennis | North 10"], [540, 420]);
  assert.equal(ranked[0].slotText, "9:00 - 10:00 AM");
});

test("uses North first, custom Muir order, and excludes Warren and Coast", () => {
  const ordered = Core.buildDefaultCourtSearchOrder([
    { name: "Tennis | Muir 1" },
    { name: "Tennis | North 10" },
    { name: "Tennis | Muir 2" },
    { name: "Tennis | Warren 13" },
    { name: "Tennis | Muir 5" },
    { name: "Tennis | Coast 14" },
    { name: "Tennis | Muir 3" },
    { name: "Tennis | North 9" },
    { name: "Tennis | Muir 4" }
  ]);
  assert.deepEqual(ordered.map((court) => court.name), [
    "Tennis | North 9",
    "Tennis | North 10",
    "Tennis | Muir 4",
    "Tennis | Muir 3",
    "Tennis | Muir 2",
    "Tennis | Muir 1",
    "Tennis | Muir 5"
  ]);
});

test("enforces the fixed polling interval without requiring court input", () => {
  const invalid = Core.validateSettings({
    selectedCourts: [],
    pollSeconds: 2,
    preferredStartMinutes: [420, 480],
    targetDate: "2026-09-01",
    windowStartSeconds: 0,
    windowEndSeconds: 600
  });
  assert.equal(invalid.errors.length, 1);
});

test("accepts the fixed three-second check and ten-minute midnight window", () => {
  const valid = Core.validateSettings({
    selectedCourts: [],
    pollSeconds: 3,
    preferredStartMinutes: [420, 480],
    autoBook: true,
    targetDate: "2026-09-01",
    windowStartSeconds: 0,
    windowEndSeconds: 600
  });
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.settings.pollSeconds, 3);
  assert.equal(valid.settings.autoBook, true);
});

test("requires at least one selected consecutive two-hour block", () => {
  const invalid = Core.validateSettings({
    selectedCourts: [],
    pollSeconds: 3,
    preferredStartMinutes: [420, 540],
    autoBook: true,
    targetDate: "2026-09-01",
    windowStartSeconds: 0,
    windowEndSeconds: 600
  });
  assert.match(invalid.errors.join(" "), /two consecutive one-hour time slots/);
});

test("rejects polling intervals other than the fixed three seconds", () => {
  const invalid = Core.validateSettings({
    selectedCourts: ["Tennis | North 10"],
    pollSeconds: 5,
    preferredStartMinutes: [420],
    autoBook: true,
    targetDate: "2026-09-01",
    windowStartSeconds: 0,
    windowEndSeconds: 600
  });
  assert.match(invalid.errors.join(" "), /every 3 seconds/);
});

test("rejects any monitoring window other than midnight to 12:10 AM", () => {
  const invalid = Core.validateSettings({
    selectedCourts: ["Tennis | North 10"],
    pollSeconds: 3,
    preferredStartMinutes: [420, 540],
    targetDate: "2026-09-01",
    windowStartSeconds: 0,
    windowEndSeconds: 300
  });
  assert.match(invalid.errors.join(" "), /12:10 AM/);
  assert.equal(Core.UCSD_DAILY_BOOKING_LIMIT, 2);
});

test("computes the three-day target and next local midnight", () => {
  const now = new Date(2026, 7, 28, 23, 58, 0);
  assert.equal(Core.desiredDateKey(now, 3), "2026-08-31");
  const next = Core.nextLocalMidnight(now);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 7);
  assert.equal(next.getDate(), 29);
  assert.equal(next.getHours(), 0);
  assert.equal(next.getMinutes(), 0);
});

test("computes the next selected monitoring-window start", () => {
  const beforeWindow = new Date(2026, 7, 29, 0, 0, 30);
  const sameDay = Core.nextWindowStart(beforeWindow, 60);
  assert.equal(sameDay.getDate(), 29);
  assert.equal(sameDay.getMinutes(), 1);

  const afterWindow = new Date(2026, 7, 29, 0, 2, 0);
  const nextDay = Core.nextWindowStart(afterWindow, 60);
  assert.equal(nextDay.getDate(), 30);

  const insideWindow = new Date(2026, 7, 29, 0, 2, 0);
  const immediate = Core.nextWindowStart(insideWindow, 0, 600);
  assert.equal(immediate.getDate(), 29);
  assert.equal(immediate.getMinutes(), 2);
  assert.ok(immediate.getTime() > insideWindow.getTime());
});
