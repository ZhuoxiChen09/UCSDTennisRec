"use strict";

const CONTENT_PROTOCOL_VERSION = 12;
const Core = globalThis.UcsdBookingCore;
const BOOKING_PATH_RE = /^\/booking\/([0-9a-f-]+)\/?$/i;
let watchController = null;
let overlay = null;

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Stopped", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function setOverlay(state, title, detail) {
  if (!overlay) {
    overlay = document.createElement("aside");
    overlay.id = "ucsd-tennis-watcher";
    overlay.innerHTML = `
      <div class="ucsd-watcher-dot" aria-hidden="true"></div>
      <div class="ucsd-watcher-copy">
        <strong></strong>
        <span></span>
      </div>
      <button type="button">Stop watching</button>`;
    overlay.querySelector("button").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "STOP" });
    });
    document.body.appendChild(overlay);
  }
  overlay.dataset.state = state;
  overlay.querySelector("strong").textContent = title;
  overlay.querySelector("span").textContent = detail;
}

async function reportStatus(state, message, extra = {}) {
  setOverlay(state, state === "found" ? "Court found" : "Court watcher", message);
  await chrome.runtime.sendMessage({
    type: "STATUS",
    status: { state, message, ...extra, protocolVersion: CONTENT_PROTOCOL_VERSION }
  }).catch(() => undefined);
}

function bookingId() {
  const match = location.pathname.match(BOOKING_PATH_RE);
  return match ? match[1] : null;
}

function parseDates(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("button.single-date-select-one-click")]
    .map((button) => ({
      year: Number(button.dataset.year),
      month: Number(button.dataset.month),
      day: Number(button.dataset.day),
      dateText: button.dataset.dateText || ""
    }))
    .filter((date) => date.year && date.month && date.day);
}

function parseFacilities(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const facilities = [...doc.querySelectorAll(".booking-facility-list[data-facility-id]")]
    .map((button) => ({
      id: button.dataset.facilityId,
      name: Core.normalizeCourtName(button.dataset.facilityName || button.textContent)
    }));
  return [...new Map(facilities.map((facility) => [facility.id, facility])).values()];
}

function parseAvailableSlots(html, court, date) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll('button[id^="btnOpenSlot_"]')]
    .filter((button) => !button.disabled && Core.normalizeSpace(button.textContent).toLowerCase() === "book now")
    .map((button) => ({
      court: court.name,
      facilityId: court.id,
      dateKey: Core.datePartsKey(date),
      dateText: date.dateText,
      slotText: Core.normalizeSpace(button.dataset.slotText),
      spotsText: Core.normalizeSpace(button.dataset.spotsLeftText)
    }));
}

function parseUpcomingBookings(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const bookings = [...doc.querySelectorAll(".cancel-booking-btn[data-booking-participant-id]")]
    .map((button) => ({
      participantId: button.dataset.bookingParticipantId,
      court: Core.normalizeSpace(button.dataset.productFacilityName).replace(/^Tennis\s*-\s*/i, ""),
      dateText: Core.normalizeSpace(button.dataset.bookingDay),
      dateKey: Core.parseBookingDateKey(button.dataset.bookingDay),
      slotText: Core.normalizeSpace(button.dataset.bookingTime)
    }));
  return [...new Map(bookings.map((booking) => [booking.participantId, booking])).values()];
}

async function fetchUpcomingBookings(signal) {
  return parseUpcomingBookings(await fetchPartial("/booking/mybookings/3", signal));
}

async function fetchPartial(url, signal) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    signal
  });
  if (response.redirected && /\/account\/signin/i.test(response.url)) {
    throw new Error("Your UCSD session expired. Sign in again, then restart the watcher.");
  }
  if (!response.ok) throw new Error(`UCSD Recreation returned HTTP ${response.status}.`);
  return response.text();
}

async function getPageInfo() {
  const id = bookingId();
  if (!id) throw new Error("This is not a tennis booking detail page.");
  const currentCourt = Core.normalizeCourtName(
    document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ||
    document.querySelector("#spanSelectedFacility")?.textContent || ""
  );
  const facilityButtons = [...document.querySelectorAll(".booking-facility-list[data-facility-id]")];
  let courts = facilityButtons.map((button) => ({
    id: button.dataset.facilityId,
    name: Core.normalizeCourtName(button.dataset.facilityName || button.textContent)
  }));
  if (!courts.length) {
    const html = await fetchPartial(`/booking/${id}/facilities`, new AbortController().signal);
    courts = parseFacilities(html);
  }
  let dates = [...document.querySelectorAll("button.single-date-select-one-click")]
    .map((button) => ({
      dateKey: Core.datePartsKey({
        year: Number(button.dataset.year),
        month: Number(button.dataset.month),
        day: Number(button.dataset.day)
      }),
      dateText: button.dataset.dateText || ""
    }))
    .filter((date) => Core.isValidDateKey(date.dateKey));
  if (!dates.length) {
    const html = await fetchPartial(`/booking/${id}/dates`, new AbortController().signal);
    dates = parseDates(html).map((date) => ({
      dateKey: Core.datePartsKey(date),
      dateText: date.dateText
    }));
  }
  let upcomingBookings = [];
  try {
    upcomingBookings = await fetchUpcomingBookings(new AbortController().signal);
  } catch (_error) {
    // Availability watching still works if the optional booking-list request fails.
  }
  return {
    ok: true,
    protocolVersion: CONTENT_PROTOCOL_VERSION,
    bookingUrl: location.href,
    currentCourt,
    courts,
    dates,
    upcomingBookings
  };
}

async function revealMatch(match, signal) {
  const [year, month, day] = match.dateKey.split("-").map(Number);
  const dateButton = [...document.querySelectorAll("button.single-date-select-one-click")]
    .find((button) => Number(button.dataset.year) === year &&
      Number(button.dataset.month) === month && Number(button.dataset.day) === day);
  if (dateButton && dateButton.getAttribute("aria-current") !== "date") {
    dateButton.click();
    await sleep(700, signal);
  }

  const courtTab = [...document.querySelectorAll('[role="tab"][data-facility-id]')]
    .find((button) => button.dataset.facilityId === match.facilityId);
  if (courtTab && courtTab.getAttribute("aria-selected") !== "true") {
    courtTab.click();
    // Do not let a same-hour button left over from the prior court satisfy the
    // lookup while UCSD replaces the slot grid asynchronously.
    await sleep(700, signal);
  }

  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const targetButton = [...document.querySelectorAll('button[id^="btnOpenSlot_"]')]
      .find((button) => Core.normalizeSpace(button.dataset.slotText) === match.slotText && !button.disabled);
    if (targetButton) {
      targetButton.classList.add("ucsd-tennis-match");
      targetButton.scrollIntoView({ behavior: "smooth", block: "center" });
      targetButton.focus({ preventScroll: true });
      return targetButton;
    }
    await sleep(250, signal);
  }
  return null;
}

function elementIsVisible(element) {
  return Boolean(element && getComputedStyle(element).display !== "none" && element.getClientRects().length);
}

function bookingMatchesSlot(booking, match) {
  return booking.dateKey === match.dateKey &&
    Core.normalizeCourtName(booking.court) === Core.normalizeCourtName(match.court) &&
    Core.normalizeSpace(booking.slotText) === Core.normalizeSpace(match.slotText);
}

async function waitForBookingConfirmation(match, participantIdsBefore, signal) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (elementIsVisible(document.querySelector("#alertBookingFailure-NoSpots"))) {
      return { outcome: "unavailable" };
    }
    if (elementIsVisible(document.querySelector("#alertBookingFailure"))) {
      return { outcome: "failed" };
    }
    const visibleModal = [...document.querySelectorAll(".modal.show")]
      .find((modal) => /captcha|confirm/i.test(modal.textContent || ""));
    if (visibleModal) return { outcome: "needs-action" };

    try {
      const bookings = await fetchUpcomingBookings(signal);
      const confirmed = bookings.find((booking) =>
        !participantIdsBefore.has(booking.participantId) && bookingMatchesSlot(booking, match)
      );
      if (confirmed) return { outcome: "booked", bookings, confirmed };
    } catch (_error) {
      // Retry during UCSD's short post-booking update delay.
    }
    await sleep(350, signal);
  }
  return { outcome: "unverified" };
}

function pairDescription(pair) {
  return pair.map((match) => `${match.slotText} on ${match.court}`).join(" + ");
}

async function bookTwoHourPair(pair, signal) {
  const confirmedBookings = [];
  let knownBookings;
  try {
    knownBookings = await fetchUpcomingBookings(signal);
  } catch (_error) {
    throw new Error("UCSD's reservation list could not be read, so the extension stopped before making a two-booking attempt.");
  }

  await chrome.runtime.sendMessage({ type: "FOUND", pair, autoBook: true });
  for (let index = 0; index < pair.length; index += 1) {
    const match = pair[index];
    const targetButton = await revealMatch(match, signal);
    if (!targetButton) {
      const message = index === 0
        ? "The two-hour block disappeared before its first hour could be selected. No reservation was made."
        : `Only the first hour was confirmed. The second hour on ${match.court} disappeared before it could be selected.`;
      await reportStatus(index === 0 ? "action" : "partial", message, { pair, confirmedBookings });
      return { ok: false, partial: index > 0, pair, confirmedBookings };
    }

    await reportStatus(
      "booking",
      `Booking hour ${index + 1} of 2: ${match.court}, ${match.dateText}, ${match.slotText}…`,
      { pair, currentMatch: match, confirmedBookings }
    );
    const participantIdsBefore = new Set(knownBookings.map((booking) => booking.participantId));
    targetButton.click();
    const result = await waitForBookingConfirmation(match, participantIdsBefore, signal);
    if (result.outcome !== "booked") {
      const outcomeMessages = {
        unavailable: "UCSD says the hour was taken before the booking completed.",
        failed: "UCSD reported that the booking failed.",
        "needs-action": "UCSD needs a CAPTCHA or confirmation in this tab.",
        unverified: "UCSD did not expose a verifiable reservation result in time. Check this tab before trying again."
      };
      const prefix = index === 0
        ? "No part of the two-hour block was confirmed."
        : "The first hour is confirmed, but the second hour was not booked.";
      await reportStatus(index === 0 ? "action" : "partial", `${prefix} ${outcomeMessages[result.outcome]}`, {
        pair,
        currentMatch: match,
        confirmedBookings,
        outcome: result.outcome
      });
      return { ok: false, partial: index > 0, pair, confirmedBookings, outcome: result.outcome };
    }
    knownBookings = result.bookings;
    confirmedBookings.push(result.confirmed);
  }

  await reportStatus("booked", `Two-hour block confirmed: ${pairDescription(pair)}.`, { pair, confirmedBookings });
  return { ok: true, pair, confirmedBookings };
}

async function maybeReviewCancellation() {
  if (location.pathname.toLowerCase() !== "/booking") return;
  const { pendingCancellationId } = await chrome.storage.local.get("pendingCancellationId");
  if (!pendingCancellationId) return;

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const cancelLink = document.querySelector(
      `.cancel-booking-btn[data-booking-participant-id="${CSS.escape(pendingCancellationId)}"]`
    );
    if (cancelLink) {
      await chrome.storage.local.remove("pendingCancellationId");
      cancelLink.click();
      setOverlay("review", "Review cancellation", "Verify the court, date, and hour. Click Yes, Cancel only if you want to remove this booking.");
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
  await chrome.storage.local.remove("pendingCancellationId");
  setOverlay("error", "Cancellation unavailable", "The selected booking was not found. Reload the extension and try again.");
}

async function runWatch(settings, source) {
  if (watchController) watchController.abort();
  watchController = new AbortController();
  const { signal } = watchController;
  const id = bookingId();
  if (!id) throw new Error("Open the UCSD tennis booking detail page first.");

  const validation = Core.validateSettings(settings);
  if (validation.errors.length) throw new Error(validation.errors.join(" "));
  const config = validation.settings;
  const runStartedAt = new Date();
  const configuredDurationMs = (config.windowEndSeconds - config.windowStartSeconds) * 1000;
  const stopAt = source === "schedule"
    ? Core.currentWindowEnd(runStartedAt, config.windowEndSeconds).getTime()
    : Date.now() + Math.min(configuredDurationMs, Core.MAX_WINDOW_END_SECONDS * 1000);
  const desired = config.targetDate;
  let scanNumber = 0;
  let selectedDate = null;
  let selectedCourts = null;
  let courtIndex = 0;
  let cycleMatches = [];

  if (stopAt <= Date.now()) {
    await reportStatus("stopped", "The selected monitoring window has already ended.");
    watchController = null;
    return { ok: true, expired: true };
  }

  await reportStatus("watching", source === "schedule"
    ? `Release watch started for ${desired}.`
    : `Watching selected reservation date ${desired}.`);

  try {
    while (!signal.aborted && Date.now() < stopAt) {
      scanNumber += 1;
      if (!selectedDate) {
        const datesHtml = await fetchPartial(`/booking/${id}/dates`, signal);
        const dates = parseDates(datesHtml);
        selectedDate = dates.find((date) => Core.datePartsKey(date) === desired) || null;
      }

      if (!selectedDate) {
        await reportStatus("watching", `Check ${scanNumber}: ${desired} is not released yet.`);
      } else {
        if (!selectedCourts) {
          const facilitiesHtml = await fetchPartial(`/booking/${id}/facilities`, signal);
          const allFacilities = parseFacilities(facilitiesHtml);
          selectedCourts = Core.buildDefaultCourtSearchOrder(allFacilities);
          if (!selectedCourts.length) {
            throw new Error("No eligible North or Muir tennis courts were found. Warren and Coast are excluded.");
          }
        }

        const court = selectedCourts[courtIndex];
        const slotsHtml = await fetchPartial(
          `/booking/${id}/slots/${court.id}/${selectedDate.year}/${selectedDate.month}/${selectedDate.day}`,
          signal
        );
        const matches = parseAvailableSlots(slotsHtml, court, selectedDate)
          .filter((slot) => Core.isPreferredSlot(slot.slotText, config.preferredStartMinutes));
        cycleMatches.push(...matches);
        const sameCourtPair = Core.findConsecutiveSlotPair(matches, config.preferredStartMinutes);
        if (sameCourtPair) {
          const result = await bookTwoHourPair(sameCourtPair, signal);
          watchController = null;
          return result;
        }
        courtIndex = (courtIndex + 1) % selectedCourts.length;
        if (courtIndex === 0) {
          const sameAreaPair = Core.findSameAreaCourtPair(
            cycleMatches,
            config.preferredStartMinutes,
            selectedCourts.map((candidate) => candidate.name)
          );
          if (sameAreaPair) {
            const result = await bookTwoHourPair(sameAreaPair, signal);
            watchController = null;
            return result;
          }
          cycleMatches = [];
        }
        await reportStatus("watching", `Check ${scanNumber}: no acceptable two-hour pair on ${court.name}; next check in ${config.pollSeconds}s.`);
      }

      await sleep(config.pollSeconds * 1000, signal);
    }

    if (!signal.aborted) await reportStatus("stopped", "Watch window ended without an acceptable consecutive two-hour block.");
    watchController = null;
    return { ok: true };
  } catch (error) {
    if (error.name === "AbortError") return { ok: true, stopped: true };
    await reportStatus("error", error.message);
    watchController = null;
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_PROTOCOL_VERSION") {
    sendResponse({ ok: true, protocolVersion: CONTENT_PROTOCOL_VERSION });
    return false;
  }
  if (message.type === "GET_PAGE_INFO") {
    getPageInfo().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "START_WATCH") {
    runWatch(message.settings, message.source).catch((error) => {
      reportStatus("error", error.message).catch(() => undefined);
    });
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "STOP_WATCH") {
    if (watchController) watchController.abort();
    watchController = null;
    if (overlay) overlay.remove();
    overlay = null;
    sendResponse({ ok: true });
  }
  return false;
});

chrome.runtime.sendMessage({
  type: "CONTENT_READY",
  protocolVersion: CONTENT_PROTOCOL_VERSION
}).catch(() => undefined);
maybeReviewCancellation().catch(() => undefined);
