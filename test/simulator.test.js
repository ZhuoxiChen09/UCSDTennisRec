"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../lib/booking-core.js");
const {
  BOOKING_ID,
  claimCompetitorSlot,
  competitorSlotWeight,
  createSimulatorServer,
  createState,
  syncDatesToToday
} = require("../simulator/server");

async function withServer(run) {
  const { server } = createSimulatorServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("simulator exposes the UCSD HTML contracts consumed by the content script", async () => {
  await withServer(async (origin) => {
    const booking = await fetch(`${origin}/booking/${BOOKING_ID}`).then((response) => response.text());
    assert.match(booking, /<title>Tennis - UC San Diego Recreation<\/title>/);
    assert.match(booking, /data-page="booking"/);
    assert.match(booking, /data-ucsd-environment="simulator"/);
    assert.match(booking, /data-test-case="default-availability"/);
    assert.match(booking, /single-date-select-one-click/);
    assert.match(booking, /booking-facility-list/);
    assert.match(booking, /Book Now/);
    assert.match(booking, /id="bookedSessions"/);
    assert.match(booking, /Booked sessions/);
    assert.match(booking, /data-release="same-court"/);
    assert.match(booking, /id="releaseDateWithRush"/);
    assert.match(booking, /Release with rush/);
    assert.match(booking, /simulator\.js/);

    const dates = await fetch(`${origin}/booking/${BOOKING_ID}/dates`).then((response) => response.text());
    assert.match(dates, /data-year="\d{4}"/);
    const facilities = await fetch(`${origin}/booking/${BOOKING_ID}/facilities`).then((response) => response.text());
    assert.match(facilities, /Tennis \| North 6/);
    assert.match(facilities, /Tennis \| North 12/);
    assert.match(facilities, /Tennis \| Muir 5/);
    assert.match(facilities, /Tennis \| Warren 13/);
    assert.match(facilities, /Tennis \| Coast 14/);
    const state = await fetch(`${origin}/api/state`).then((response) => response.json());
    const latest = state.dates.at(-1);
    const slots = await fetch(`${origin}/booking/${BOOKING_ID}/slots/${state.courts[0].id}/${latest.year}/${latest.month}/${latest.day}`).then((response) => response.text());
    assert.match(slots, /data-ucsd-test-case="default-availability"/);
  });
});

test("simulator releases, books, verifies, and race-loses realistic slots", async () => {
  await withServer(async (origin) => {
    const state = await fetch(`${origin}/api/state`).then((response) => response.json());
    assert.equal(state.dates.length, 4);
    assert.equal(state.courts.length, 14);
    assert.equal(state.slots.length, 4 * state.courts.length * 15);
    assert.equal(state.activeTestCase, "default-availability");
    const dateKey = state.dates.at(-1).key;
    const release = await fetch(`${origin}/api/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "same-court", startMinutes: 420, dateKey })
    }).then((response) => response.json());
    assert.equal(release.slots.length, 2);
    assert.equal(release.slots[0].facilityId, release.slots[1].facilityId);
    const afterRelease = await fetch(`${origin}/api/state`).then((response) => response.json());
    assert.equal(afterRelease.activeTestCase, "same-court");
    assert.equal(afterRelease.slots.filter((slot) => slot.dateKey === dateKey).length, 2);
    afterRelease.dates.filter((date) => date.key !== dateKey).forEach((date) => {
      assert.equal(afterRelease.slots.filter((slot) => slot.dateKey === date.key).length, afterRelease.courts.length * 15);
    });

    const first = release.slots[0];
    const firstBookedResponse = await fetch(`${origin}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(first)
    });
    assert.equal(firstBookedResponse.status, 200);
    const firstBooked = await firstBookedResponse.json();
    const secondBooked = await fetch(`${origin}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(release.slots[1])
    });
    assert.equal(secondBooked.status, 200);
    const bookings = await fetch(`${origin}/booking/mybookings/3`).then((response) => response.text());
    assert.match(bookings, /cancel-booking-btn/);
    assert.match(bookings, /7:00 AM - 8:00 AM/);
    assert.match(bookings, /8:00 AM - 9:00 AM/);
    assert.match(bookings, /data-product-facility-name="Tennis - Tennis \|/);
    assert.equal((await fetch(`${origin}/api/state`).then((response) => response.json())).bookings.length, 2);

    const third = await fetch(`${origin}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.slots.find((slot) => slot.dateKey === dateKey && slot.slotText === "9:00 AM - 10:00 AM"))
    });
    assert.equal(third.status, 409);
    assert.equal((await third.json()).dailyLimit, true);
    const limitedSlots = await fetch(`${origin}/booking/${BOOKING_ID}/slots/${first.facilityId}/${dateKey.replaceAll("-", "/")}`).then((response) => response.text());
    assert.match(limitedSlots, /Daily booking limit reached/);

    const cancelled = await fetch(`${origin}/api/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: firstBooked.booking.participantId })
    });
    assert.equal(cancelled.status, 200);
    const afterCancel = await fetch(`${origin}/api/state`).then((response) => response.json());
    assert.equal(afterCancel.bookings.length, 1);
    assert.ok(afterCancel.slots.some((slot) => slot.facilityId === first.facilityId &&
      slot.dateKey === first.dateKey && slot.slotText === first.slotText));

    const race = await fetch(`${origin}/api/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "race-loss", startMinutes: 540, dateKey })
    }).then((response) => response.json());
    const lost = await fetch(`${origin}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(race.slots[1])
    });
    assert.equal(lost.status, 409);
    assert.equal((await lost.json()).raceLost, true);
  });
});

test("date releases stay chronological, keep four tiles, and accept a future year", async () => {
  await withServer(async (origin) => {
    const before = await fetch(`${origin}/api/state`).then((response) => response.json());
    await fetch(`${origin}/api/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "same-court", startMinutes: 420, dateKey: before.dates.at(-1).key })
    });
    const nextYear = `${Number(before.dates.at(-1).key.slice(0, 4)) + 1}-01-15`;
    const released = await fetch(`${origin}/api/release-date`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateKey: nextYear })
    }).then((response) => response.json());
    assert.equal(released.dates.length, 4);
    assert.equal(released.removedDateKey, before.dates[0].key);
    assert.equal(released.dates.at(-1).key, nextYear);
    assert.deepEqual(released.dates.map((date) => date.key), [...released.dates.map((date) => date.key)].sort());
    const after = await fetch(`${origin}/api/state`).then((response) => response.json());
    assert.equal(after.slots.filter((slot) => slot.dateKey === nextYear).length, after.courts.length * 15);
    after.dates.forEach((date) => {
      assert.equal(after.slots.filter((slot) => slot.dateKey === date.key).length, after.courts.length * 15);
    });
  });
});

test("second-hour recovery scenario leaves the exact hour open on the next North court", async () => {
  await withServer(async (origin) => {
    const state = await fetch(`${origin}/api/state`).then((response) => response.json());
    const dateKey = state.dates.at(-1).key;
    const scenario = await fetch(`${origin}/api/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "race-recovery", startMinutes: 1080, dateKey })
    }).then((response) => response.json());
    assert.equal(scenario.slots.length, 3);
    assert.deepEqual(scenario.slots.map((slot) => slot.court), [
      "Tennis | North 6", "Tennis | North 6", "Tennis | North 7"
    ]);
    const first = await fetch(`${origin}/api/book`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scenario.slots[0])
    });
    assert.equal(first.status, 200);
    const lost = await fetch(`${origin}/api/book`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scenario.slots[1])
    });
    assert.equal(lost.status, 409);
    assert.equal((await lost.json()).raceLost, true);
    const after = await fetch(`${origin}/api/state`).then((response) => response.json());
    const ranked = Core.rankExactHourFallback(
      after.slots.filter((slot) => slot.dateKey === dateKey),
      scenario.slots[0],
      scenario.slots[1].slotText,
      ["Tennis | North 6", "Tennis | North 7"]
    );
    assert.equal(ranked[0].court, "Tennis | North 7");
  });
});

test("preparing a delayed release empties only the selected date", async () => {
  await withServer(async (origin) => {
    const before = await fetch(`${origin}/api/state`).then((response) => response.json());
    const selectedDate = before.dates[1].key;
    const prepared = await fetch(`${origin}/api/prepare-empty-date`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateKey: selectedDate })
    });
    assert.equal(prepared.status, 200);
    const after = await fetch(`${origin}/api/state`).then((response) => response.json());
    assert.equal(after.slots.filter((slot) => slot.dateKey === selectedDate).length, 0);
    after.dates.filter((date) => date.key !== selectedDate).forEach((date) => {
      assert.equal(after.slots.filter((slot) => slot.dateKey === date.key).length, after.courts.length * 15);
    });
  });
});

test("clearing simulator activity preserves bookings and availability", async () => {
  await withServer(async (origin) => {
    const initial = await fetch(`${origin}/api/state`).then((response) => response.json());
    await fetch(`${origin}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initial.slots[0])
    });
    const before = await fetch(`${origin}/api/state`).then((response) => response.json());
    assert.ok(before.events.length > 0);

    const cleared = await fetch(`${origin}/api/clear-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(cleared.status, 200);
    const after = await fetch(`${origin}/api/state`).then((response) => response.json());
    assert.deepEqual(after.events, []);
    assert.equal(after.bookings.length, before.bookings.length);
    assert.equal(after.slots.length, before.slots.length);
    assert.equal(after.revision, before.revision + 1);
  });
});

test("virtual competitors remove availability without using the test account booking limit", () => {
  const state = createState(new Date(2026, 8, 2, 12));
  const dateKey = state.dates.at(-1).key;
  const slotsBefore = state.slots.length;
  const claim = claimCompetitorSlot(state, dateKey, () => 0.5);
  assert.ok(claim);
  assert.equal(state.slots.length, slotsBefore - 1);
  assert.equal(state.bookings.length, 0);
  assert.equal(state.competitorClaims.length, 1);
  assert.equal(state.activeTestCase, "competitor-rush");
});

test("competitor selection strongly favors the 6 PM through 9 PM rush", () => {
  assert.equal(competitorSlotWeight({ slotText: "6:00 PM - 7:00 PM" }), 8);
  assert.equal(competitorSlotWeight({ slotText: "8:00 PM - 9:00 PM" }), 8);
  assert.equal(competitorSlotWeight({ slotText: "5:00 PM - 6:00 PM" }), 3);
  assert.equal(competitorSlotWeight({ slotText: "10:00 AM - 11:00 AM" }), 1);
});

test("competitor rush API exposes live race controls", async () => {
  await withServer(async (origin) => {
    const before = await fetch(`${origin}/api/state`).then((response) => response.json());
    const dateKey = before.dates.at(-1).key;
    await fetch(`${origin}/api/prepare-empty-date`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateKey })
    });
    await fetch(`${origin}/api/release-full-date`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateKey })
    });
    const response = await fetch(`${origin}/api/competitor-claim`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateKey })
    });
    assert.equal(response.status, 200);
    const after = await fetch(`${origin}/api/state`).then((result) => result.json());
    assert.equal(after.competitorClaims.length, 1);
    assert.equal(after.bookings.length, 0);
  });
});

test("a newly released date accepts an immediate competitor rush", async () => {
  await withServer(async (origin) => {
    const before = await fetch(`${origin}/api/state`).then((response) => response.json());
    const [year, month, day] = before.dates.at(-1).key.split("-").map(Number);
    const next = new Date(year, month - 1, day + 1, 12);
    const dateKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    const release = await fetch(`${origin}/api/release-date`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateKey })
    });
    assert.equal(release.status, 200);
    for (let index = 0; index < 8; index += 1) {
      const claim = await fetch(`${origin}/api/competitor-claim`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateKey })
      });
      assert.equal(claim.status, 200);
    }
    const after = await fetch(`${origin}/api/state`).then((response) => response.json());
    assert.equal(after.dates.at(-1).key, dateKey);
    assert.equal(after.competitorClaims.filter((claim) => claim.dateKey === dateKey).length, 8);
    assert.equal(after.slots.filter((slot) => slot.dateKey === dateKey).length, after.courts.length * 15 - 8);
  });
});

test("guaranteed competitor split leaves no same-court evening pair and one North fallback", async () => {
  await withServer(async (origin) => {
    const before = await fetch(`${origin}/api/state`).then((response) => response.json());
    const dateKey = before.dates.at(-1).key;
    const untouchedCounts = new Map(before.dates.slice(0, -1).map((date) => [
      date.key, before.slots.filter((slot) => slot.dateKey === date.key).length
    ]));
    const response = await fetch(`${origin}/api/competitor-split`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateKey })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.remainingPair.length, 2);
    const state = await fetch(`${origin}/api/state`).then((item) => item.json());
    untouchedCounts.forEach((count, untouchedDate) => {
      assert.equal(state.slots.filter((slot) => slot.dateKey === untouchedDate).length, count);
    });
    const evening = state.slots.filter((slot) => slot.dateKey === dateKey &&
      Core.courtAreaDetails(slot.court) && [1080, 1140, 1200].includes(Core.parseStartMinutes(slot.slotText)));
    const names = [...new Set(evening.map((slot) => slot.court))];
    assert.equal(names.some((name) => Core.findConsecutiveSlotPair(
      evening.filter((slot) => slot.court === name), [1080, 1140, 1200]
    )), false);
    const split = Core.findSameAreaCourtPair(evening, [1080, 1140, 1200], names);
    assert.deepEqual(split.map((slot) => slot.court), ["Tennis | North 6", "Tennis | North 7"]);
  });
});

test("the date window advances automatically when the local calendar day changes", () => {
  const state = createState(new Date(2026, 8, 2, 12));
  assert.deepEqual(state.dates.map((date) => date.key), ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
  assert.equal(syncDatesToToday(state, new Date(2026, 8, 3, 12)), true);
  assert.deepEqual(state.dates.map((date) => date.key), ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
});

test("the actual extension receives localhost simulator access", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.ok(manifest.host_permissions.includes("https://rec.ucsd.edu/*"));
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("http://127.0.0.1/booking*")));
});

test("simulator exposes one focused WebMCP release action", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "simulator", "simulator.js"), "utf8");
  assert.match(source, /name: "release_test_courts"/);
  assert.match(source, /readOnlyHint: false/);
  assert.match(source, /same-court/);
  assert.match(source, /race-loss/);
});
