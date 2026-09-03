"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const BOOKING_ID = "9f19b678-58ce-4dfc-bd78-7166bde9e265";
const DEFAULT_PORT = 4173;
const courts = [
  { id: "8495eed8-3d1a-4172-b762-806061f8a8e8", name: "Tennis | Muir 1" },
  { id: "56461f32-41ea-44d6-b035-c574d17f1390", name: "Tennis | Muir 2" },
  { id: "ed39ec3c-9a4d-4e9f-8d32-1b3f2020a003", name: "Tennis | Muir 3" },
  { id: "ed39ec3c-9a4d-4e9f-8d32-1b3f2020a004", name: "Tennis | Muir 4" },
  { id: "ed39ec3c-9a4d-4e9f-8d32-1b3f2020a005", name: "Tennis | Muir 5" },
  { id: "6d1207df-7f4e-46b9-ad5c-80c0610207eb", name: "Tennis | North 6" },
  { id: "b1b2cac0-173e-499d-85bb-1d0eec088ab2", name: "Tennis | North 7" },
  { id: "ed39ec3c-9a4d-4e9f-8d32-1b3f2020b008", name: "Tennis | North 8" },
  { id: "ed39ec3c-9a4d-4e9f-8d32-1b3f2020b009", name: "Tennis | North 9" },
  { id: "ed39ec3c-9a4d-4e9f-8d32-1b3f2020b010", name: "Tennis | North 10" },
  { id: "ed39ec3c-9a4d-4e9f-8d32-1b3f2020b011", name: "Tennis | North 11" },
  { id: "ed39ec3c-9a4d-4e9f-8d32-1b3f2020b012", name: "Tennis | North 12" },
  { id: "f5b9c93f-697e-4915-bd7d-99b7f045e875", name: "Tennis | Warren 13" },
  { id: "ed39ec3c-9a4d-4e9f-8d32-1b3f2020c014", name: "Tennis | Coast 14" }
];

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateDetails(date) {
  return {
    key: localDateKey(date),
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    text: date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  };
}

function dateFromKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return localDateKey(date) === value ? date : null;
}

function addDays(date, count) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + count);
  return result;
}

function availableDates(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  return [0, 1, 2, 3].map((daysAhead) => dateDetails(addDays(today, daysAhead)));
}

function slotText(startMinutes) {
  function label(minutes) {
    const hour24 = Math.floor(minutes / 60) % 24;
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:00 ${hour24 < 12 ? "AM" : "PM"}`;
  }
  return `${label(startMinutes)} - ${label(startMinutes + 60)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function defaultAvailableSlots(dates) {
  return dates.flatMap((date) => courts.flatMap((court) =>
    Array.from({ length: 15 }, (_value, index) => ({
      facilityId: court.id,
      court: court.name,
      dateKey: date.key,
      dateText: date.text,
      slotText: slotText(7 * 60 + index * 60),
      spotsText: "1 spot left",
      loseRace: false
    }))
  ));
}

function slotIdentity(slot) {
  return `${slot.facilityId}|${slot.dateKey}|${slot.slotText}`;
}

function refillVisibleAvailability(state) {
  const visibleKeys = new Set(state.dates.map((date) => date.key));
  const bookedSlots = new Set(state.bookings.map(slotIdentity));
  const available = new Map(state.slots
    .filter((slot) => visibleKeys.has(slot.dateKey) && !bookedSlots.has(slotIdentity(slot)))
    .map((slot) => [slotIdentity(slot), slot]));
  defaultAvailableSlots(state.dates).forEach((slot) => {
    const identity = slotIdentity(slot);
    if (!bookedSlots.has(identity) && !available.has(identity)) available.set(identity, slot);
  });
  state.slots = [...available.values()];
}

function createState(now = new Date()) {
  const dates = availableDates(now);
  return {
    activeTestCase: "default-availability",
    dates,
    lastTodayKey: localDateKey(now),
    slots: defaultAvailableSlots(dates),
    bookings: [],
    competitorClaims: [],
    revision: 0,
    events: [{ at: Date.now(), message: `Simulator ready. Every time on all ${courts.length} courts is available.` }]
  };
}

function releaseDate(state, dateKey, automatic = false) {
  const date = dateFromKey(dateKey);
  if (!date) throw new Error("Choose a valid date to release.");
  if (state.dates.some((candidate) => candidate.key === dateKey)) {
    return { dateKey, dates: state.dates, removedDateKey: null, unchanged: true };
  }
  const latestKey = state.dates.at(-1)?.key;
  if (latestKey && dateKey <= latestKey) {
    throw new Error(`Choose a date after ${latestKey}; released dates stay in chronological order.`);
  }
  const releasedDate = dateDetails(date);
  state.dates.push(releasedDate);
  state.slots.push(...defaultAvailableSlots([releasedDate]));
  state.dates.sort((left, right) => left.key.localeCompare(right.key));
  const removed = state.dates.length > 4 ? state.dates.splice(0, state.dates.length - 4) : [];
  const visibleKeys = new Set(state.dates.map((candidate) => candidate.key));
  state.slots = state.slots.filter((slot) => visibleKeys.has(slot.dateKey));
  refillVisibleAvailability(state);
  state.activeTestCase = automatic ? "automatic-date-rollover" : "date-release";
  record(state, `${automatic ? "Calendar advanced" : "Date released"}: ${dateKey}${removed.length ? `; ${removed.map((item) => item.key).join(", ")} left the four-date window` : ""}.`);
  return { dateKey, dates: state.dates, removedDateKey: removed[0]?.key || null, unchanged: false };
}

function syncDatesToToday(state, now = new Date()) {
  const todayKey = localDateKey(now);
  if (todayKey <= state.lastTodayKey) return false;
  const previousToday = dateFromKey(state.lastTodayKey);
  const currentToday = dateFromKey(todayKey);
  const elapsedDays = Math.max(1, Math.round((currentToday - previousToday) / 86_400_000));
  for (let index = 0; index < elapsedDays; index += 1) {
    const latest = dateFromKey(state.dates.at(-1).key);
    releaseDate(state, localDateKey(addDays(latest, 1)), true);
  }
  state.lastTodayKey = todayKey;
  return true;
}

function record(state, message) {
  state.revision += 1;
  state.events.unshift({ at: Date.now(), message });
  state.events = state.events.slice(0, 30);
}

function randomStart() {
  return (7 + Math.floor(Math.random() * 8)) * 60;
}

function competitorSlotWeight(slot) {
  const start = slotTextToMinutes(slot.slotText);
  if ([18 * 60, 19 * 60, 20 * 60].includes(start)) return 8;
  if ([17 * 60, 21 * 60].includes(start)) return 3;
  return 1;
}

function addCompetitorClaim(state, slot) {
  const names = ["Alex", "Jordan", "Sam", "Taylor", "Casey", "Riley", "Morgan", "Jamie"];
  const claim = {
    id: randomUUID(),
    player: names[state.competitorClaims.length % names.length],
    facilityId: slot.facilityId,
    court: slot.court,
    dateKey: slot.dateKey,
    slotText: slot.slotText,
    at: Date.now()
  };
  state.competitorClaims.push(claim);
  state.competitorClaims = state.competitorClaims.slice(-200);
  return claim;
}

function slotTextToMinutes(text) {
  const match = String(text || "").match(/^(\d{1,2}):00\s+(AM|PM)/i);
  if (!match) return -1;
  let hour = Number(match[1]) % 12;
  if (match[2].toUpperCase() === "PM") hour += 12;
  return hour * 60;
}

function claimCompetitorSlot(state, dateKey, random = Math.random) {
  const candidates = state.slots.filter((slot) => slot.dateKey === dateKey);
  if (!candidates.length) return null;
  const totalWeight = candidates.reduce((sum, slot) => sum + competitorSlotWeight(slot), 0);
  let target = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * totalWeight;
  let chosen = candidates.at(-1);
  for (const candidate of candidates) {
    target -= competitorSlotWeight(candidate);
    if (target < 0) {
      chosen = candidate;
      break;
    }
  }
  const index = state.slots.indexOf(chosen);
  if (index < 0) return null;
  state.slots.splice(index, 1);
  const claim = addCompetitorClaim(state, chosen);
  state.activeTestCase = "competitor-rush";
  record(state, `Competitor ${claim.player} grabbed ${claim.slotText} on ${claim.court.replace("Tennis | ", "")}.`);
  return claim;
}

function prepareCompetitorSplit(state, dateKey) {
  const date = state.dates.find((candidate) => candidate.key === dateKey);
  if (!date) return null;
  const bookedSlots = new Set(state.bookings.map(slotIdentity));
  state.slots = state.slots.filter((slot) => slot.dateKey !== dateKey);
  state.slots.push(...defaultAvailableSlots([date]).filter((slot) => !bookedSlots.has(slotIdentity(slot))));
  state.competitorClaims = state.competitorClaims.filter((claim) => claim.dateKey !== dateKey);

  const north = courts.filter((court) => /\| North /i.test(court.name));
  const keep = new Set([
    `${north[0].id}|${dateKey}|${slotText(18 * 60)}`,
    `${north[1].id}|${dateKey}|${slotText(19 * 60)}`
  ]);
  const claimed = [];
  state.slots = state.slots.filter((slot) => {
    const start = slotTextToMinutes(slot.slotText);
    const isEveningTarget = slot.dateKey === dateKey && isCompetitorCourt(slot.court) &&
      [18 * 60, 19 * 60, 20 * 60].includes(start);
    if (!isEveningTarget || keep.has(slotIdentity(slot))) return true;
    claimed.push(addCompetitorClaim(state, slot));
    return false;
  });
  state.activeTestCase = "competitor-split";
  record(state, `${claimed.length} competitors filled the 6–9 PM rush; only a split North 6 + North 7 pair remains.`);
  return { dateKey, claimed, remainingPair: state.slots.filter((slot) => keep.has(slotIdentity(slot))) };
}

function isCompetitorCourt(courtName) {
  return /\| (North|Muir) \d+\b/i.test(courtName || "");
}

function releaseScenario(state, scenario, requestedStart, dateKey) {
  const start = Number.isInteger(requestedStart) ? requestedStart : randomStart();
  const date = state.dates.find((candidate) => candidate.key === dateKey) || state.dates.at(-1);
  const chosenScenario = scenario === "random"
    ? ["same-court", "same-area", "race-loss", "race-recovery"][Math.floor(Math.random() * 4)]
    : scenario;
  state.activeTestCase = chosenScenario;
  let released;
  if (chosenScenario === "race-recovery") {
    const north = courts.filter((court) => /\| North /i.test(court.name));
    released = [
      { court: north[0], startMinutes: start, loseRace: false },
      { court: north[0], startMinutes: start + 60, loseRace: true },
      { court: north[1], startMinutes: start + 60, loseRace: false }
    ];
  } else if (chosenScenario === "same-area") {
    const area = Math.random() < 0.5 ? "north" : "muir";
    const pair = courts.filter((court) => court.name.toLowerCase().includes(`| ${area} `)).slice(0, 2);
    released = [
      { court: pair[0], startMinutes: start, loseRace: false },
      { court: pair[1], startMinutes: start + 60, loseRace: false }
    ];
  } else {
    const eligible = courts.filter((court) => /\| (North|Muir) /i.test(court.name));
    const court = eligible[Math.floor(Math.random() * eligible.length)];
    released = [
      { court, startMinutes: start, loseRace: false },
      { court, startMinutes: start + 60, loseRace: chosenScenario === "race-loss" }
    ];
  }

  const scenarioSlots = released.map((entry) => ({
    facilityId: entry.court.id,
    court: entry.court.name,
    dateKey: date.key,
    dateText: date.text,
    slotText: slotText(entry.startMinutes),
    spotsText: "1 spot left",
    loseRace: entry.loseRace
  }));
  const bookedSlots = new Set(state.bookings.map(slotIdentity));
  state.slots = state.slots.filter((slot) => slot.dateKey !== date.key);
  state.slots.push(...scenarioSlots.filter((slot) => !bookedSlots.has(slotIdentity(slot))));
  const description = scenarioSlots.map((slot) => `${slot.slotText} on ${slot.court.replace("Tennis | ", "")}`).join(" + ");
  record(state, `${chosenScenario.replace("-", " ")} released: ${description}.`);
  return { scenario: chosenScenario, dateKey: date.key, slots: scenarioSlots };
}

function renderDates(selectedKey, dates = availableDates()) {
  return dates.map((date) => `
    <button class="date-button single-date-select-one-click" type="button"
      data-year="${date.year}" data-month="${date.month}" data-day="${date.day}"
      data-date-text="${escapeHtml(date.text)}" aria-current="${date.key === selectedKey ? "date" : "false"}">
      <span>${new Date(date.year, date.month - 1, date.day).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</span>
      <strong>${new Date(date.year, date.month - 1, date.day).toLocaleDateString("en-US", { month: "short" }).toUpperCase()} ${date.day}</strong>
    </button>`).join("");
}

function renderFacilities(selectedId) {
  return courts.map((court) => `
    <button class="court-tab booking-facility-list" role="tab" type="button"
      data-facility-id="${court.id}" data-facility-name="${escapeHtml(court.name)}"
      aria-selected="${court.id === selectedId}">${escapeHtml(court.name.replace("Tennis | ", ""))}</button>`).join("");
}

function renderSlots(state, facilityId, dateKey) {
  const dailyLimitReached = state.bookings.filter((booking) => booking.dateKey === dateKey).length >= 2;
  const released = new Map(state.slots
    .filter((slot) => slot.facilityId === facilityId && slot.dateKey === dateKey)
    .map((slot) => [slot.slotText, slot]));
  const slotCards = Array.from({ length: 15 }, (_value, index) => {
    const text = slotText(7 * 60 + index * 60);
    const slot = dailyLimitReached ? null : released.get(text);
    return `
    <article class="slot-row">
      <div><span class="slot-time">${escapeHtml(text)}</span><span class="slot-spots">${slot ? "1 spot available" : dailyLimitReached ? "Daily booking limit reached" : "No spots available"}</span></div>
      ${slot ? `<button class="book-button" id="btnOpenSlot_${escapeHtml(slot.facilityId)}_${index}" type="button"
        data-facility-id="${escapeHtml(slot.facilityId)}" data-slot-text="${escapeHtml(slot.slotText)}"
        data-spots-left-text="${escapeHtml(slot.spotsText)}">Book Now</button>` :
        `<button class="book-button unavailable" id="btnUnavailableSlot_${index}" type="button" disabled>Unavailable</button>`}
    </article>`;
  }).join("");
  return `<span data-ucsd-test-case="${escapeHtml(state.activeTestCase)}" hidden></span>${slotCards}`;
}

function renderBookings(state) {
  if (!state.bookings.length) return '<div class="empty"><div><strong>No test reservations</strong><br>Booked slots will appear here.</div></div>';
  return state.bookings.map((booking) => `
    <article class="reservation">
      <div><strong>${escapeHtml(booking.court.replace("Tennis | ", ""))}</strong><br><span>${escapeHtml(booking.dateText)} · ${escapeHtml(booking.slotText)}</span></div>
      <button class="cancel-booking-btn" type="button" data-booking-participant-id="${booking.participantId}"
        data-product-facility-name="Tennis - ${escapeHtml(booking.court)}" data-booking-day="${escapeHtml(booking.dateText)}"
        data-booking-time="${escapeHtml(booking.slotText)}">Cancel</button>
    </article>`).join("");
}

function cancelBooking(state, participantId) {
  const index = state.bookings.findIndex((booking) => booking.participantId === participantId);
  if (index < 0) return null;
  const [booking] = state.bookings.splice(index, 1);
  const restoredSlot = { ...booking, loseRace: false };
  delete restoredSlot.participantId;
  if (!state.slots.some((slot) => slot.facilityId === restoredSlot.facilityId &&
    slot.dateKey === restoredSlot.dateKey && slot.slotText === restoredSlot.slotText)) {
    state.slots.push(restoredSlot);
  }
  record(state, `Cancelled ${booking.slotText} on ${booking.court.replace("Tennis | ", "")}; the slot is available again.`);
  return booking;
}

function layout(body, title, bodyData = "") {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="stylesheet" href="/simulator.css"></head>
<body ${bodyData}>
  <header class="topbar">
    <button class="menu" type="button" aria-label="Open Site Navigation">☰</button>
    <a class="brand" href="/" aria-label="UC San Diego Recreation Online Store Home"><span class="triton">⚡</span><span><strong>UC SAN DIEGO</strong><b>RECREATION</b></span><em>ONLINE STORE</em></a>
    <form class="search"><input type="search" aria-label="Search Programs" placeholder="Search Programs"><button type="button" aria-label="Submit Search">⌕</button></form>
    <div class="top-actions"><span>🛒</span><span>🔔</span><span class="avatar">A</span><span>TEST@UCSD.EDU</span></div>
  </header>
  ${body}
  <footer><div><strong>UC SAN DIEGO</strong><br>9500 Gilman Drive, La Jolla, CA 92093-0529 · (858) 534-3557</div><div><b>RESOURCES</b><br>Contact · Accessibility · Terms of Use</div></footer>
  <script src="/simulator.js"></script>
</body></html>`;
}

function renderBookingPage(state) {
  const dates = state.dates;
  const selectedDate = dates.at(-1).key;
  const selectedCourt = courts[0].id;
  return layout(`
  <main class="page" id="mainContent">
    <h1>Tennis</h1>
    <section class="program-card">
      <div class="breadcrumb"><a href="/booking">Bookings</a> / Tennis <span>LOCAL SIMULATOR</span></div>
      <div class="program-info"><div class="racket">◯<i>╱</i></div><p>1 guest allowed per day |-| Private coaching prohibited |-| Bookings available 3 days prior to occurrence |-| Limit 2 bookings daily</p></div>
    </section>
    <section class="booking-card">
      <h2>Select Date &amp; Time</h2>
      <div class="date-strip" id="divBookingDateSelector">${renderDates(selectedDate, dates)}</div>
      <div class="court-tabs" role="tablist" id="tabBookingFacilities">${renderFacilities(selectedCourt)}</div>
      <p class="conflict-note">Some times may be unavailable due to conflicting appointments.</p>
      <p id="spanSelectedFacility" class="visually-hidden">Tennis | Muir 1</p>
      <div id="alertBookingFailure-NoSpots" class="alert" hidden>The slot was taken by another player.</div>
      <div id="alertBookingFailure" class="alert" hidden>The test booking failed.</div>
      <div class="slots" id="slotGrid">${renderSlots(state, selectedCourt, selectedDate)}</div>
    </section>
    <section class="booked-panel" aria-labelledby="bookedSessionsTitle">
      <div class="booked-heading">
        <div><span class="eyebrow">LOCAL TEST ACCOUNT</span><h2 id="bookedSessionsTitle">Booked sessions</h2></div>
        <strong id="bookingCount">${state.bookings.length} booked</strong>
      </div>
      <p>Both hours appear here after the extension verifies them. Cancel any test session to return it to availability.</p>
      <div class="reservation-list" id="bookedSessions">${renderBookings(state)}</div>
    </section>
    <details class="console" open>
      <summary>Test release controls <span>local only</span></summary>
      <div class="console-body">
        <p class="console-intro">Start the real extension first, then publish availability while it polls this UCSD-style page.</p>
          <div class="scenario-grid">
            <button class="scenario" type="button" data-release="random"><span class="scenario-icon">?</span><span><strong>Random release</strong>Random court, time, and behavior.</span></button>
            <button class="scenario" type="button" data-release="same-court"><span class="scenario-icon">2h</span><span><strong>Same-court pair</strong>Expected happy path and first priority.</span></button>
            <button class="scenario" type="button" data-release="same-area"><span class="scenario-icon">↔</span><span><strong>Nearby split pair</strong>Two consecutive hours in North or Muir.</span></button>
            <button class="scenario" type="button" data-release="race-loss"><span class="scenario-icon">!</span><span><strong>Second-hour race loss</strong>First booking succeeds; second disappears.</span></button>
            <button class="scenario" type="button" data-release="race-recovery"><span class="scenario-icon">↻</span><span><strong>Second-hour recovery</strong>North 6 loses hour two; North 7 remains open.</span></button>
          </div>
          <div class="auto-release"><label for="delay">Schedule one random release</label><div class="auto-row"><select id="delay"><option value="5">in 5 seconds</option><option value="15">in 15 seconds</option><option value="30">in 30 seconds</option></select><button class="primary" id="scheduleRelease" type="button">Schedule</button></div></div>
          <div class="competitor-controls">
            <label for="competitorCount">Virtual competitor rush</label>
            <p>Starts after a short release delay. Players claim random courts, weighted heavily toward 6–9 PM, while the real extension races them.</p>
            <div class="auto-row"><select id="competitorCount"><option value="20">20 competitors</option><option value="4">4 competitors</option><option value="8">8 competitors</option><option value="12">12 competitors</option><option value="30">30 competitors</option><option value="40">40 competitors</option><option value="60">60 competitors</option><option value="100">100 competitors</option></select><button class="primary" id="startCompetitors" type="button">Start rush</button></div>
            <button id="startSplitRush" class="secondary accent" type="button">Run guaranteed split test</button>
            <button id="stopCompetitors" class="secondary" type="button" disabled>Stop competitors</button>
            <strong id="competitorStatus" aria-live="polite">Idle</strong>
          </div>
          <div class="date-release">
            <label for="nextReleaseDate">Release another reservation date</label>
            <div class="auto-row"><input id="nextReleaseDate" type="date"><button class="primary" id="releaseDate" type="button">Release only</button></div>
            <button class="release-rush" id="releaseDateWithRush" type="button">Release with rush</button>
            <p><strong>Release with rush</strong> publishes this new date and immediately sends the selected number of evening-weighted competitors after that same date.</p>
            <p>The earliest tile is removed so exactly four dates remain.</p>
          </div>
          <button class="reset" id="resetSimulator" type="button">Reset availability &amp; reservations</button>
          <div class="event-heading"><h3 class="event-title">Simulator activity</h3><button id="clearActivity" type="button">Clear activity</button></div>
          <ol class="events" id="eventLog"></ol>
      </div>
    </details>
  </main>`, "Tennis - UC San Diego Recreation", `data-page="booking" data-booking-id="${BOOKING_ID}" data-ucsd-environment="simulator" data-test-case="${escapeHtml(state.activeTestCase)}"`);
}

function renderReservationsPage(state) {
  return layout(`<main class="page"><h1>Bookings</h1><section class="program-card"><div class="breadcrumb">Bookings / Upcoming</div><div class="reservation-list">${renderBookings(state)}</div></section></main>`, "Bookings - UC San Diego Recreation", `data-page="reservations" data-ucsd-environment="simulator" data-test-case="${escapeHtml(state.activeTestCase)}"`);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(value));
}

function createSimulatorServer() {
  const state = createState();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    try {
      syncDatesToToday(state);
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(302, { Location: `/booking/${BOOKING_ID}` });
        response.end();
      } else if (request.method === "GET" && url.pathname === "/simulator.css") {
        send(response, 200, "text/css; charset=utf-8", fs.readFileSync(path.join(__dirname, "simulator.css")));
      } else if (request.method === "GET" && url.pathname === "/simulator.js") {
        send(response, 200, "text/javascript; charset=utf-8", fs.readFileSync(path.join(__dirname, "simulator.js")));
      } else if (request.method === "GET" && url.pathname === "/icons/icon48.png") {
        send(response, 200, "image/png", fs.readFileSync(path.join(__dirname, "..", "icons", "icon48.png")));
      } else if (request.method === "GET" && url.pathname === `/booking/${BOOKING_ID}`) {
        send(response, 200, "text/html; charset=utf-8", renderBookingPage(state));
      } else if (request.method === "GET" && url.pathname === "/booking") {
        send(response, 200, "text/html; charset=utf-8", renderReservationsPage(state));
      } else if (request.method === "GET" && url.pathname === `/booking/${BOOKING_ID}/dates`) {
        send(response, 200, "text/html; charset=utf-8", renderDates("", state.dates));
      } else if (request.method === "GET" && url.pathname === `/booking/${BOOKING_ID}/facilities`) {
        send(response, 200, "text/html; charset=utf-8", renderFacilities(""));
      } else if (request.method === "GET" && url.pathname.startsWith(`/booking/${BOOKING_ID}/slots/`)) {
        const parts = url.pathname.split("/");
        const facilityId = parts[4];
        const dateKey = `${parts[5]}-${String(parts[6]).padStart(2, "0")}-${String(parts[7]).padStart(2, "0")}`;
        send(response, 200, "text/html; charset=utf-8", renderSlots(state, facilityId, dateKey));
      } else if (request.method === "GET" && url.pathname === "/booking/mybookings/3") {
        send(response, 200, "text/html; charset=utf-8", renderBookings(state));
      } else if (request.method === "GET" && url.pathname === "/api/state") {
        sendJson(response, 200, { ...state, courts });
      } else if (request.method === "POST" && url.pathname === "/api/release-date") {
        const input = await readJson(request);
        sendJson(response, 200, releaseDate(state, String(input.dateKey || "")));
      } else if (request.method === "POST" && url.pathname === "/api/release") {
        const input = await readJson(request);
        sendJson(response, 200, releaseScenario(state, input.scenario || "random", Number(input.startMinutes), input.dateKey));
      } else if (request.method === "POST" && url.pathname === "/api/prepare-empty-date") {
        const input = await readJson(request);
        const date = state.dates.find((candidate) => candidate.key === input.dateKey);
        if (!date) {
          sendJson(response, 404, { ok: false, error: "That test date is not currently released." });
          return;
        }
        state.slots = state.slots.filter((slot) => slot.dateKey !== date.key);
        state.activeTestCase = "empty-availability";
        record(state, `Prepared ${date.key} with no availability for a delayed-release test.`);
        sendJson(response, 200, { ok: true, dateKey: date.key });
      } else if (request.method === "POST" && url.pathname === "/api/release-full-date") {
        const input = await readJson(request);
        const date = state.dates.find((candidate) => candidate.key === input.dateKey);
        if (!date) {
          sendJson(response, 404, { ok: false, error: "That test date is not currently released." });
          return;
        }
        const bookedSlots = new Set(state.bookings.map(slotIdentity));
        state.slots = state.slots.filter((slot) => slot.dateKey !== date.key);
        state.slots.push(...defaultAvailableSlots([date]).filter((slot) => !bookedSlots.has(slotIdentity(slot))));
        state.competitorClaims = state.competitorClaims.filter((claim) => claim.dateKey !== date.key);
        state.activeTestCase = "competitor-rush";
        record(state, `Midnight release opened ${date.key}; virtual competitors entered the queue.`);
        sendJson(response, 200, { ok: true, dateKey: date.key });
      } else if (request.method === "POST" && url.pathname === "/api/competitor-claim") {
        const input = await readJson(request);
        const claim = claimCompetitorSlot(state, String(input.dateKey || ""));
        if (!claim) {
          sendJson(response, 409, { ok: false, error: "No slots remain for competitors on that date." });
          return;
        }
        sendJson(response, 200, { ok: true, claim });
      } else if (request.method === "POST" && url.pathname === "/api/competitor-split") {
        const input = await readJson(request);
        const result = prepareCompetitorSplit(state, String(input.dateKey || ""));
        if (!result) {
          sendJson(response, 404, { ok: false, error: "That test date is not currently released." });
          return;
        }
        sendJson(response, 200, { ok: true, ...result });
      } else if (request.method === "POST" && url.pathname === "/api/book") {
        const input = await readJson(request);
        if (state.bookings.filter((booking) => booking.dateKey === input.dateKey).length >= 2) {
          sendJson(response, 409, { ok: false, dailyLimit: true, error: "This date already has two test reservations." });
          return;
        }
        const index = state.slots.findIndex((slot) => slot.facilityId === input.facilityId && slot.dateKey === input.dateKey && slot.slotText === input.slotText);
        if (index < 0) {
          sendJson(response, 409, { ok: false, error: "That slot is no longer available." });
          return;
        }
        const [slot] = state.slots.splice(index, 1);
        if (slot.loseRace) {
          record(state, `Race simulated: ${slot.slotText} on ${slot.court.replace("Tennis | ", "")} was taken.`);
          sendJson(response, 409, { ok: false, raceLost: true });
          return;
        }
        const booking = { ...slot, participantId: randomUUID() };
        delete booking.loseRace;
        state.bookings.push(booking);
        record(state, `Booked ${booking.slotText} on ${booking.court.replace("Tennis | ", "")}.`);
        sendJson(response, 200, { ok: true, booking });
      } else if (request.method === "POST" && url.pathname === "/api/cancel") {
        const input = await readJson(request);
        const cancelled = cancelBooking(state, String(input.participantId || ""));
        if (!cancelled) {
          sendJson(response, 404, { ok: false, error: "That test reservation was not found." });
          return;
        }
        sendJson(response, 200, { ok: true, cancelled });
      } else if (request.method === "POST" && url.pathname === "/api/clear-events") {
        state.events = [];
        state.revision += 1;
        sendJson(response, 200, { ok: true });
      } else if (request.method === "POST" && url.pathname === "/api/reset") {
        state.bookings = [];
        state.competitorClaims = [];
        state.slots = defaultAvailableSlots(state.dates);
        state.activeTestCase = "default-availability";
        record(state, "Simulator reset. All visible dates are available and test reservations were cleared.");
        sendJson(response, 200, { ok: true });
      } else {
        send(response, 404, "text/plain; charset=utf-8", "Not found");
      }
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });
  return { server, state };
}

if (require.main === module) {
  const port = Number(process.env.UCSD_SIMULATOR_PORT || DEFAULT_PORT);
  const { server } = createSimulatorServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`UCSD Tennis simulator: http://127.0.0.1:${port}/booking/${BOOKING_ID}`);
    console.log("Reload the existing unpacked extension from this repository before testing.");
  });
}

module.exports = {
  BOOKING_ID,
  availableDates,
  createState,
  cancelBooking,
  claimCompetitorSlot,
  competitorSlotWeight,
  prepareCompetitorSplit,
  createSimulatorServer,
  releaseDate,
  releaseScenario,
  renderBookings,
  renderDates,
  renderFacilities,
  renderSlots,
  slotText,
  syncDatesToToday
};
