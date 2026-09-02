"use strict";

const BUILD_VERSION = "0.7.2";
const CONTENT_PROTOCOL_VERSION = 12;
const Core = globalThis.UcsdBookingCore;
const DEFAULT_BOOKING_URL = "https://rec.ucsd.edu/booking/9f19b678-58ce-4dfc-bd78-7166bde9e265";
const elements = {
  arm: document.querySelector("#arm"),
  autoLogin: document.querySelector("#autoLogin"),
  bookingTools: document.querySelector("#bookingTools"),
  existingBooking: document.querySelector("#existingBooking"),
  hourCount: document.querySelector("#hourCount"),
  hourList: document.querySelector("#hourList"),
  openLogin: document.querySelector("#openLogin"),
  pageState: document.querySelector("#pageState"),
  runState: document.querySelector("#runState"),
  reviewCancellation: document.querySelector("#reviewCancellation"),
  start: document.querySelector("#start"),
  status: document.querySelector("#status"),
  stop: document.querySelector("#stop"),
  targetDate: document.querySelector("#targetDate")
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

function formatReservationDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric"
  });
}

function renderDates(dates, savedDate) {
  const nextStart = Core.nextWindowStart(new Date(), 0, Core.MAX_WINDOW_END_SECONDS);
  const nextReleaseDate = Core.desiredDateKey(nextStart, 3);
  const choices = new Map([[nextReleaseDate, `Next release · ${formatReservationDate(nextReleaseDate)}`]]);
  dates.forEach((date) => choices.set(date.dateKey, `Available now · ${formatReservationDate(date.dateKey)}`));
  if (savedDate && !choices.has(savedDate)) choices.set(savedDate, formatReservationDate(savedDate));
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
  elements.pageState.textContent =
    `Connected · ${eligibleCourtCount} allowed courts · ${targetDateCount}/${Core.UCSD_DAILY_BOOKING_LIMIT} detected on selected date`;
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
    showStatus(`Armed for ${nextWindow.toLocaleString()} to book a consecutive two-hour block on ${formatReservationDate(settings.targetDate)}.`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function startNow() {
  try {
    if (!pageInfo) throw new Error("Open the UCSD tennis booking page and sign in first.");
    const settings = readSettings();
    await saveUiSettings(settings);
    showRunState("watching");
    showStatus("Searching for two consecutive hours on one court; nearby courts in the same North or Muir area are the fallback…");
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
    if (!tab?.id || !/^https:\/\/rec\.ucsd\.edu\/booking\/[0-9a-f-]+\/?$/i.test(tab.url || "")) {
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
elements.reviewCancellation.addEventListener("click", reviewCancellation);
elements.start.addEventListener("click", startNow);
elements.stop.addEventListener("click", stop);
elements.targetDate.addEventListener("change", updateSelectedDateBookingLimit);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.status?.newValue?.protocolVersion === CONTENT_PROTOCOL_VERSION) {
    showRunState(changes.status.newValue.state);
    showStatus(changes.status.newValue.message, changes.status.newValue.state === "error");
  }
});
initialize();
