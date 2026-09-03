"use strict";

const page = document.body.dataset.page;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { payload });
  return payload;
}

function activeDateKey() {
  const button = document.querySelector(".single-date-select-one-click[aria-current='date']");
  return button ? `${button.dataset.year}-${String(button.dataset.month).padStart(2, "0")}-${String(button.dataset.day).padStart(2, "0")}` : "";
}

function activeFacilityId() {
  return document.querySelector("[role='tab'][aria-selected='true']")?.dataset.facilityId || "";
}

if (page === "booking") {
  const bookingId = document.body.dataset.bookingId;
  const dateStrip = document.querySelector("#divBookingDateSelector");
  const grid = document.querySelector("#slotGrid");
  const eventLog = document.querySelector("#eventLog");
  const bookedSessions = document.querySelector("#bookedSessions");
  const bookingCount = document.querySelector("#bookingCount");
  const raceAlert = document.querySelector("#alertBookingFailure-NoSpots");
  let lastRevision = -1;
  let lastBookingCount = 0;
  let datesSignature = "";
  let scheduledTimer = null;
  let competitorRunId = 0;

  function nextDayKey(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day + 1, 12, 0, 0, 0);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function attachDateButtons() {
    dateStrip.querySelectorAll(".single-date-select-one-click").forEach((button) => {
      button.addEventListener("click", async () => {
        dateStrip.querySelectorAll(".single-date-select-one-click").forEach((candidate) => candidate.setAttribute("aria-current", "false"));
        button.setAttribute("aria-current", "date");
        await refreshSlots();
      });
    });
  }

  function syncDateButtons(dates, preferredDateKey) {
    const visibleKeys = new Set(dates.map((date) => date.key));
    const current = preferredDateKey || activeDateKey();
    const selectedKey = visibleKeys.has(current) ? current : dates.at(-1).key;
    dateStrip.replaceChildren(...dates.map((date) => {
      const button = document.createElement("button");
      const parsed = new Date(date.year, date.month - 1, date.day, 12, 0, 0, 0);
      button.className = "date-button single-date-select-one-click";
      button.type = "button";
      button.dataset.year = String(date.year);
      button.dataset.month = String(date.month);
      button.dataset.day = String(date.day);
      button.dataset.dateText = date.text;
      button.setAttribute("aria-current", date.key === selectedKey ? "date" : "false");
      const weekday = document.createElement("span");
      weekday.textContent = parsed.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
      const calendarDate = document.createElement("strong");
      calendarDate.textContent = `${parsed.toLocaleDateString("en-US", { month: "short" }).toUpperCase()} ${date.day}`;
      button.append(weekday, calendarDate);
      return button;
    }));
    attachDateButtons();
    const nextDate = document.querySelector("#nextReleaseDate");
    const earliestAllowed = nextDayKey(dates.at(-1).key);
    nextDate.min = earliestAllowed;
    if (!nextDate.value || nextDate.value < earliestAllowed) nextDate.value = earliestAllowed;
  }

  async function refreshSlots() {
    const [year, month, day] = activeDateKey().split("-");
    const response = await fetch(`/booking/${bookingId}/slots/${activeFacilityId()}/${year}/${month}/${day}`, { cache: "no-store" });
    grid.innerHTML = await response.text();
    attachBookingButtons();
  }

  function renderEvents(events) {
    eventLog.innerHTML = events.map((event) => {
      const time = new Date(event.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      return `<li><time>${time}</time> ${event.message}</li>`;
    }).join("");
  }

  function renderBookedSessions(bookings) {
    const previousBookingCount = lastBookingCount;
    lastBookingCount = bookings.length;
    bookingCount.textContent = `${bookings.length} booked`;
    if (!bookings.length) {
      bookedSessions.innerHTML = '<div class="empty"><div><strong>No test reservations</strong><br>Booked slots will appear here.</div></div>';
      return;
    }
    bookedSessions.replaceChildren(...bookings.map((booking) => {
      const article = document.createElement("article");
      article.className = "reservation";
      const details = document.createElement("div");
      const court = document.createElement("strong");
      court.textContent = booking.court.replace("Tennis | ", "");
      const timing = document.createElement("span");
      timing.textContent = `${booking.dateText} · ${booking.slotText}`;
      details.append(court, document.createElement("br"), timing);
      const cancel = document.createElement("button");
      cancel.className = "cancel-booking-btn";
      cancel.type = "button";
      cancel.dataset.participantId = booking.participantId;
      cancel.textContent = "Cancel & restore slot";
      cancel.addEventListener("click", () => cancelTestBooking(cancel));
      article.append(details, cancel);
      return article;
    }));
    if (bookings.length >= 2 && previousBookingCount < 2) {
      document.querySelector(".booked-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async function cancelTestBooking(button) {
    button.disabled = true;
    button.textContent = "Restoring…";
    try {
      await request("/api/cancel", {
        method: "POST",
        body: JSON.stringify({ participantId: button.dataset.participantId })
      });
      await refreshState(true);
    } catch (error) {
      button.disabled = false;
      button.textContent = error.message;
    }
  }

  async function refreshState(force = false) {
    const state = await request("/api/state");
    document.body.dataset.testCase = state.activeTestCase;
    const nextDatesSignature = state.dates.map((date) => date.key).join("|");
    if (nextDatesSignature !== datesSignature) {
      syncDateButtons(state.dates);
      datesSignature = nextDatesSignature;
    }
    if (force || state.revision !== lastRevision) {
      lastRevision = state.revision;
      renderEvents(state.events);
      renderBookedSessions(state.bookings);
      await refreshSlots();
    }
    return state;
  }

  async function book(button) {
    raceAlert.hidden = true;
    try {
      await request("/api/book", {
        method: "POST",
        body: JSON.stringify({
          facilityId: button.dataset.facilityId,
          dateKey: activeDateKey(),
          slotText: button.dataset.slotText
        })
      });
    } catch (error) {
      if (error.payload?.raceLost) raceAlert.hidden = false;
    }
    await refreshState(true);
  }

  function attachBookingButtons() {
    grid.querySelectorAll("button[id^='btnOpenSlot_']").forEach((button) => {
      button.addEventListener("click", () => book(button), { once: true });
    });
  }

  async function release(scenario, startMinutes) {
    const result = await request("/api/release", {
      method: "POST",
      body: JSON.stringify({ scenario, startMinutes, dateKey: activeDateKey() })
    });
    await refreshState(true);
    return result;
  }

  async function runCompetitorClaims(dateKey, total, runId, status, quickStart = false) {
    let completed = 0;
    status.textContent = `0/${total} competitors booked`;
    for (let index = 0; index < total && runId === competitorRunId; index += 1) {
      const delay = quickStart ? 50 + Math.random() * 150 : 180 + Math.random() * 320;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (runId !== competitorRunId) break;
      try {
        await request("/api/competitor-claim", {
          method: "POST",
          body: JSON.stringify({ dateKey })
        });
        completed += 1;
        status.textContent = `${completed}/${total} competitors booked`;
      } catch (_error) {
        status.textContent = "All released slots were taken";
        break;
      }
    }
    return completed;
  }

  document.querySelectorAll("[role='tab'][data-facility-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll("[role='tab'][data-facility-id]").forEach((candidate) => candidate.setAttribute("aria-selected", "false"));
      button.setAttribute("aria-selected", "true");
      document.querySelector("#spanSelectedFacility").textContent = button.dataset.facilityName;
      await refreshSlots();
    });
  });

  document.querySelectorAll("[data-release]").forEach((button) => {
    button.addEventListener("click", () => release(button.dataset.release, button.dataset.release === "random" ? undefined : 420));
  });

  document.querySelector("#scheduleRelease").addEventListener("click", async () => {
    if (scheduledTimer) clearTimeout(scheduledTimer);
    const delay = Number(document.querySelector("#delay").value);
    await request("/api/prepare-empty-date", {
      method: "POST",
      body: JSON.stringify({ dateKey: activeDateKey() })
    });
    await refreshState(true);
    scheduledTimer = setTimeout(() => release("random"), delay * 1000);
    const button = document.querySelector("#scheduleRelease");
    button.textContent = `Set · ${delay}s`;
    setTimeout(() => { button.textContent = "Schedule"; }, 1400);
  });

  document.querySelector("#startCompetitors").addEventListener("click", async () => {
    const runId = ++competitorRunId;
    const startButton = document.querySelector("#startCompetitors");
    const stopButton = document.querySelector("#stopCompetitors");
    const status = document.querySelector("#competitorStatus");
    const total = Number(document.querySelector("#competitorCount").value);
    startButton.disabled = true;
    document.querySelector("#startSplitRush").disabled = true;
    document.querySelector("#releaseDateWithRush").disabled = true;
    stopButton.disabled = false;
    status.textContent = "Release in 2 seconds…";
    try {
      await request("/api/prepare-empty-date", {
        method: "POST",
        body: JSON.stringify({ dateKey: activeDateKey() })
      });
      await refreshState(true);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      if (runId !== competitorRunId) return;
      await request("/api/release-full-date", {
        method: "POST",
        body: JSON.stringify({ dateKey: activeDateKey() })
      });
      await runCompetitorClaims(activeDateKey(), total, runId, status);
      if (runId === competitorRunId) status.textContent += " · rush complete";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      if (runId === competitorRunId) {
        startButton.disabled = false;
        document.querySelector("#startSplitRush").disabled = false;
        document.querySelector("#releaseDateWithRush").disabled = false;
        stopButton.disabled = true;
      }
    }
  });

  document.querySelector("#startSplitRush").addEventListener("click", async () => {
    const runId = ++competitorRunId;
    const startButton = document.querySelector("#startSplitRush");
    const stopButton = document.querySelector("#stopCompetitors");
    const status = document.querySelector("#competitorStatus");
    startButton.disabled = true;
    document.querySelector("#startCompetitors").disabled = true;
    document.querySelector("#releaseDateWithRush").disabled = true;
    stopButton.disabled = false;
    status.textContent = "Split test releases in 2 seconds…";
    try {
      await request("/api/prepare-empty-date", {
        method: "POST",
        body: JSON.stringify({ dateKey: activeDateKey() })
      });
      await refreshState(true);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      if (runId !== competitorRunId) return;
      const result = await request("/api/competitor-split", {
        method: "POST",
        body: JSON.stringify({ dateKey: activeDateKey() })
      });
      status.textContent = `${result.claimed.length} competitors booked · split pair ready`;
      await refreshState(true);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      if (runId === competitorRunId) {
        startButton.disabled = false;
        document.querySelector("#startCompetitors").disabled = false;
        document.querySelector("#releaseDateWithRush").disabled = false;
        stopButton.disabled = true;
      }
    }
  });

  document.querySelector("#stopCompetitors").addEventListener("click", () => {
    competitorRunId += 1;
    document.querySelector("#startCompetitors").disabled = false;
    document.querySelector("#startSplitRush").disabled = false;
    document.querySelector("#releaseDateWithRush").disabled = false;
    document.querySelector("#stopCompetitors").disabled = true;
    document.querySelector("#competitorStatus").textContent = "Stopped";
  });

  document.querySelector("#releaseDate").addEventListener("click", async () => {
    const dateKey = document.querySelector("#nextReleaseDate").value;
    const result = await request("/api/release-date", { method: "POST", body: JSON.stringify({ dateKey }) });
    syncDateButtons(result.dates, result.dateKey);
    datesSignature = result.dates.map((date) => date.key).join("|");
    await refreshState(true);
  });

  document.querySelector("#releaseDateWithRush").addEventListener("click", async () => {
    const runId = ++competitorRunId;
    const button = document.querySelector("#releaseDateWithRush");
    const status = document.querySelector("#competitorStatus");
    const total = Number(document.querySelector("#competitorCount").value);
    const dateKey = document.querySelector("#nextReleaseDate").value;
    button.disabled = true;
    document.querySelector("#startCompetitors").disabled = true;
    document.querySelector("#startSplitRush").disabled = true;
    document.querySelector("#stopCompetitors").disabled = false;
    status.textContent = `Releasing ${dateKey} with ${total} competitors…`;
    try {
      const result = await request("/api/release-date", {
        method: "POST",
        body: JSON.stringify({ dateKey })
      });
      syncDateButtons(result.dates, result.dateKey);
      datesSignature = result.dates.map((date) => date.key).join("|");
      await runCompetitorClaims(result.dateKey, total, runId, status, true);
      if (runId === competitorRunId) status.textContent += " · release rush complete";
      await refreshState(true);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      if (runId === competitorRunId) {
        button.disabled = false;
        document.querySelector("#startCompetitors").disabled = false;
        document.querySelector("#startSplitRush").disabled = false;
        document.querySelector("#stopCompetitors").disabled = true;
      }
    }
  });

  document.querySelector("#resetSimulator").addEventListener("click", async () => {
    competitorRunId += 1;
    document.querySelector("#startCompetitors").disabled = false;
    document.querySelector("#startSplitRush").disabled = false;
    document.querySelector("#releaseDateWithRush").disabled = false;
    document.querySelector("#stopCompetitors").disabled = true;
    document.querySelector("#competitorStatus").textContent = "Idle";
    await request("/api/reset", { method: "POST", body: "{}" });
    raceAlert.hidden = true;
    await refreshState(true);
  });

  document.querySelector("#clearActivity").addEventListener("click", async () => {
    await request("/api/clear-events", { method: "POST", body: "{}" });
    await refreshState(true);
  });

  function registerWebMcp() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const allowed = new Set(["random", "same-court", "same-area", "race-loss", "race-recovery"]);
    void Promise.resolve(context.registerTool({
      name: "release_test_courts",
      title: "Release test courts",
      description: "Publish a simulated two-hour UCSD tennis availability scenario on the selected date.",
      inputSchema: {
        type: "object",
        properties: {
          scenario: { type: "string", enum: [...allowed] },
          startMinutes: { type: "integer", minimum: 420, maximum: 1260, multipleOf: 60 }
        },
        required: ["scenario"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!input || !allowed.has(input.scenario)) throw new Error("Choose a supported release scenario.");
        if (input.startMinutes !== undefined && (!Number.isInteger(input.startMinutes) || input.startMinutes < 420 || input.startMinutes > 1260 || input.startMinutes % 60)) {
          throw new Error("startMinutes must be an hourly value from 420 through 1260.");
        }
        const result = await release(input.scenario, input.startMinutes);
        return { scenario: result.scenario, dateKey: result.dateKey, releasedSlots: result.slots.length };
      }
    })).catch(() => undefined);
  }

  attachDateButtons();
  attachBookingButtons();
  refreshState(true).catch(() => undefined);
  setInterval(() => refreshState(false).catch(() => undefined), 800);
  registerWebMcp();
}

if (page === "reservations") {
  document.querySelectorAll(".cancel-booking-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Restoring…";
      try {
        await request("/api/cancel", {
          method: "POST",
          body: JSON.stringify({ participantId: button.dataset.bookingParticipantId })
        });
        location.reload();
      } catch (error) {
        button.disabled = false;
        button.textContent = error.message;
      }
    });
  });
}
