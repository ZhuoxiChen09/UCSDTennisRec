"use strict";

const BUILD_VERSION = "0.8.9";
const CONTENT_PROTOCOL_VERSION = 18;
const Core = globalThis.UcsdBookingCore;
const DEFAULT_BOOKING_URL = "https://rec.ucsd.edu/booking/9f19b678-58ce-4dfc-bd78-7166bde9e265";
const TEST_SIMULATOR_URL = "http://127.0.0.1:4173/booking/9f19b678-58ce-4dfc-bd78-7166bde9e265";
const TEST_SIMULATOR_HEALTH_URL = "http://127.0.0.1:4173/api/state";
const elements = {
  arm: document.querySelector("#arm"),
  autoLogin: document.querySelector("#autoLogin"),
  bookingTools: document.querySelector("#bookingTools"),
  existingBooking: document.querySelector("#existingBooking"),
  environmentBanner: document.querySelector("#environmentBanner"),
  environmentLabel: document.querySelector("#environmentLabel"),
  hourCount: document.querySelector("#hourCount"),
  hourList: document.querySelector("#hourList"),
  openLogin: document.querySelector("#openLogin"),
  openSimulator: document.querySelector("#openSimulator"),
  pageState: document.querySelector("#pageState"),
  runState: document.querySelector("#runState"),
  reviewCancellation: document.querySelector("#reviewCancellation"),
  start: document.querySelector("#start"),
  startLabel: document.querySelector("#startLabel"),
  status: document.querySelector("#status"),
  stop: document.querySelector("#stop"),
  targetDate: document.querySelector("#targetDate"),
  testCaseLabel: document.querySelector("#testCaseLabel"),
  safety: document.querySelector("#safety")
};

let pageInfo = null;
let eligibleCourtCount = 0;
let upcomingBookings = [];

function formatHour(minutes) {
  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:00 ${hour24 < 12 ? "AM" : "PM"}`;
}

function formatSlotRange(minutes) {
  return `${formatHour(minutes)}–${formatHour(minutes + 60)}`;
}

function selectedHours() {
  return [...elements.hourList.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => Number(input.value));
}

function updateHourCount() {
  const hours = selectedHours();
  if (!hours.length) {
    elements.hourCount.textContent = "choose consecutive hours";
  } else if (Core.hasConsecutiveStarts(hours)) {
    elements.hourCount.textContent = `${hours.length} selected · two-hour pair ready`;
  } else {
    elements.hourCount.textContent = `${hours.length} selected · choose an adjacent hour`;
  }
}

function populateHours(savedHours) {
  const selected = new Set(savedHours?.length ? savedHours.map(Number) : [420, 480]);
  elements.hourList.innerHTML = "";
  for (let hour = 7; hour <= 21; hour += 1) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    const minutes = hour * 60;
    input.type = "checkbox";
    input.value = String(minutes);
    input.checked = selected.has(minutes);
    input.addEventListener("change", updateHourCount);
    label.append(input, document.createTextNode(formatSlotRange(minutes)));
    elements.hourList.appendChild(label);
  }
  updateHourCount();
}

function showStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function showRunState(state) {
  const labels = {
    action: "Check tab", armed: "Armed", booked: "Booked", booking: "Booking", found: "Found",
    partial: "Partial", review: "Review", starting: "Starting", stopped: "Stopped", watching: "Running", error: "Error"
  };
  elements.runState.dataset.state = state || "idle";
  elements.runState.textContent = labels[state] || "Idle";
}

function isSupportedBookingUrl(value) {
  return /^https:\/\/rec\.ucsd\.edu\/booking\/[0-9a-f-]+\/?$/i.test(value || "") ||
    /^http:\/\/127\.0\.0\.1(?::\d+)?\/booking\/[0-9a-f-]+\/?$/i.test(value || "");
}

function renderEnvironment(info) {
  const isSimulator = info.environment === "simulator";
  elements.environmentBanner.dataset.environment = isSimulator ? "simulator" : "production";
  elements.environmentLabel.textContent = isSimulator ? "TEST SIMULATOR" : "LIVE UCSD";
  elements.testCaseLabel.textContent = isSimulator
    ? `Test case: ${String(info.testCase || "unknown").replaceAll("-", " ")}`
    : "Real UCSD Recreation reservations";
  elements.startLabel.textContent = isSimulator ? "Run test: book 2 hours" : "Start midnight watcher";
  elements.arm.hidden = !isSimulator;
  elements.arm.textContent = "Arm simulator for midnight";
  elements.safety.textContent = isSimulator
    ? "TEST MODE: bookings affect only the local simulator's in-memory data. Selected hours are preferred; if unavailable, the extension tries any consecutive two-hour block. No request is sent to UCSD Recreation."
    : "LIVE UCSD: Start Midnight Watcher can be clicked early. It waits without availability polling until 12:00:00 AM, then checks through 12:05 AM and may create two real reservations. Selected hours are preferred, with any consecutive two-hour block as fallback. UCSD Recreation remains the authority on account limits. Passwords, Duo, and final cancellation remain manual.";
}

function formatReservationDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric"
  });
}

function renderDates(dates, savedDate) {
  const latestReleasedDate = dates.map((date) => date.dateKey).filter(Core.isValidDateKey).sort().at(-1);
  const nextReleaseDate = Core.addDaysToDateKey(latestReleasedDate, 1) ||
    Core.desiredDateKey(Core.nextWindowStart(new Date(), 0, Core.MAX_WINDOW_END_SECONDS), 3);
  const choices = new Map();
  dates.forEach((date) => choices.set(date.dateKey, `Available now · ${formatReservationDate(date.dateKey)}`));
  choices.set(nextReleaseDate, `Next release · ${formatReservationDate(nextReleaseDate)}`);
  elements.targetDate.innerHTML = "";
  choices.forEach((label, value) => elements.targetDate.appendChild(new Option(label, value)));
  elements.targetDate.value = savedDate && choices.has(savedDate) ? savedDate : nextReleaseDate;
}

function renderUpcomingBookings(bookings) {
  elements.existingBooking.innerHTML = "";
  if (!bookings?.length) {
    elements.bookingTools.hidden = true;
    return;
  }
  bookings.forEach((booking) => {
    const label = `${booking.dateText} · ${booking.slotText} · ${booking.court}`;
    elements.existingBooking.appendChild(new Option(label, booking.participantId));
  });
  elements.bookingTools.hidden = false;
}

function updateSelectedDateBookingLimit() {
  if (!pageInfo) return;
  const targetDate = elements.targetDate.value;
  const targetDateCount = Core.countBookingsForDate(upcomingBookings, targetDate);
  const simulatorLimitReached = pageInfo.environment === "simulator" &&
    targetDateCount >= Core.UCSD_DAILY_BOOKING_LIMIT;
  if (pageInfo.environment === "simulator") {
    elements.start.disabled = simulatorLimitReached;
    elements.arm.disabled = simulatorLimitReached;
  }
  elements.pageState.textContent = simulatorLimitReached
    ? `Connected · ${targetDateCount}/${Core.UCSD_DAILY_BOOKING_LIMIT} booked · daily test limit reached`
    : `Connected · ${eligibleCourtCount} allowed courts · ${targetDateCount}/${Core.UCSD_DAILY_BOOKING_LIMIT} detected on selected date`;
}

function readSettings() {
  const result = Core.validateSettings({
    selectedCourts: [],
    preferredStartMinutes: selectedHours(),
    autoBook: true,
    pollSeconds: Core.MIN_POLL_SECONDS,
    targetDate: elements.targetDate.value,
    windowStartSeconds: 0,
    windowEndSeconds: Core.MAX_WINDOW_END_SECONDS
  });
  if (result.errors.length) throw new Error(result.errors.join(" "));
  return result.settings;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.ok === false) throw new Error(response?.error || "The extension did not respond.");
  return response;
}

async function saveUiSettings(settings) {
  await chrome.storage.local.set({ settings, autoLogin: elements.autoLogin.checked });
}

async function openAndLogin() {
  try {
    const bookingUrl = pageInfo?.bookingUrl || DEFAULT_BOOKING_URL;
    await chrome.storage.local.set({ autoLogin: elements.autoLogin.checked, bookingUrl });
    await send({ type: "OPEN_AND_LOGIN", bookingUrl, autoLogin: elements.autoLogin.checked });
    window.close();
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function openTestSimulator() {
  elements.openSimulator.disabled = true;
  showStatus("Checking the local test simulator…");
  try {
    const response = await fetch(TEST_SIMULATOR_HEALTH_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Simulator returned HTTP ${response.status}.`);
    await chrome.tabs.create({ url: TEST_SIMULATOR_URL });
    window.close();
  } catch (_error) {
    showRunState("action");
    showStatus("Test simulator is offline. Run npm run simulator in the project folder, then click Open Test Simulator again.", true);
    elements.openSimulator.disabled = false;
  }
}

async function armNextRelease() {
  try {
    if (!pageInfo) throw new Error("Open the UCSD tennis booking page and sign in first.");
    const settings = readSettings();
    const nextWindow = Core.nextWindowStart(new Date(), settings.windowStartSeconds, settings.windowEndSeconds);
    await saveUiSettings(settings);
    await send({
      type: "ARM",
      settings,
      bookingUrl: pageInfo.bookingUrl,
      when: nextWindow.getTime()
    });
    showRunState("armed");
    const windowIsAlreadyOpen = nextWindow.getTime() - Date.now() < 1_000;
    showStatus(windowIsAlreadyOpen
      ? `The midnight window is open. Starting the court search now for ${formatReservationDate(settings.targetDate)}.`
      : `Armed for ${nextWindow.toLocaleString()}. No availability checks will run before midnight. Then it will prefer your selected hours and try any consecutive two-hour fallback on ${formatReservationDate(settings.targetDate)}.`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function startWatcher() {
  if (pageInfo?.environment === "production") {
    await armNextRelease();
    return;
  }
  await startNow();
}

async function startNow() {
  try {
    if (!pageInfo) throw new Error("Open the UCSD tennis booking page and sign in first.");
    const settings = readSettings();
    await saveUiSettings(settings);
    showRunState("watching");
    showStatus("Searching selected hours first; if needed, trying any consecutive two-hour block on one court, then nearby courts in the same area…");
    await send({ type: "START_NOW", settings, bookingUrl: pageInfo.bookingUrl });
    window.close();
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function stop() {
  try {
    await send({ type: "STOP" });
    showRunState("stopped");
    showStatus("Watcher stopped.");
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function reviewCancellation() {
  try {
    const participantId = elements.existingBooking.value;
    if (!participantId) throw new Error("Choose an existing reservation first.");
    await send({
      type: "REVIEW_CANCELLATION",
      participantId,
      bookingUrl: pageInfo?.bookingUrl || DEFAULT_BOOKING_URL
    });
    window.close();
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function initialize() {
  if (chrome.runtime.getManifest().version !== BUILD_VERSION) {
    showRunState("starting");
    elements.pageState.textContent = "Applying the latest extension update…";
    showStatus("The popup will close once. Reopen it after the UCSD tab refreshes.");
    window.setTimeout(() => chrome.runtime.reload(), 100);
    return;
  }
  const stored = await chrome.storage.local.get(["settings", "status", "autoLogin"]);
  elements.autoLogin.checked = stored.autoLogin !== false;
  const migratedHours = stored.settings?.preferredStartMinutes || (() => {
    const earliest = Number(stored.settings?.earliestMinutes ?? 420);
    const latest = Number(stored.settings?.latestMinutes ?? 480);
    const hours = [];
    for (let minutes = earliest; minutes <= latest; minutes += 60) hours.push(minutes);
    return hours;
  })();
  populateHours(migratedHours);
  if (stored.status?.protocolVersion === CONTENT_PROTOCOL_VERSION && stored.status?.message) {
    showStatus(stored.status.message, stored.status.state === "error");
    showRunState(stored.status.state);
  } else if (stored.status?.message) {
    await chrome.storage.local.remove("status");
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isSupportedBookingUrl(tab.url)) {
      throw new Error("Open the Tennis booking detail page, sign in, then reopen this popup.");
    }
    pageInfo = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_INFO" });
    if (!pageInfo?.ok) throw new Error(pageInfo?.error || "Could not read the booking page.");
    if (pageInfo.protocolVersion !== CONTENT_PROTOCOL_VERSION) {
      showRunState("starting");
      elements.pageState.textContent = "Refreshing the UCSD tab with the latest watcher…";
      showStatus("Reopen the popup after the page finishes refreshing.");
      await chrome.storage.local.remove("status");
      await chrome.tabs.reload(tab.id);
      window.close();
      return;
    }
    if (!['production', 'simulator'].includes(pageInfo.environment)) {
      throw new Error("This page is neither live UCSD Recreation nor the verified local simulator.");
    }
    renderEnvironment(pageInfo);
    renderDates(pageInfo.dates, stored.settings?.targetDate);
    upcomingBookings = pageInfo.upcomingBookings || [];
    renderUpcomingBookings(upcomingBookings);
    eligibleCourtCount = Core.buildDefaultCourtSearchOrder(pageInfo.courts).length;
    updateSelectedDateBookingLimit();
  } catch (error) {
    elements.pageState.textContent = error.message;
    elements.pageState.parentElement.classList.add("error");
    showRunState("error");
    elements.arm.disabled = true;
    elements.start.disabled = true;
  }
}

elements.arm.addEventListener("click", armNextRelease);
elements.openLogin.addEventListener("click", openAndLogin);
elements.openSimulator.addEventListener("click", openTestSimulator);
elements.reviewCancellation.addEventListener("click", reviewCancellation);
elements.start.addEventListener("click", startWatcher);
elements.stop.addEventListener("click", stop);
elements.targetDate.addEventListener("change", updateSelectedDateBookingLimit);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.status?.newValue?.protocolVersion === CONTENT_PROTOCOL_VERSION) {
    showRunState(changes.status.newValue.state);
    showStatus(changes.status.newValue.message, changes.status.newValue.state === "error");
  }
});
initialize();
