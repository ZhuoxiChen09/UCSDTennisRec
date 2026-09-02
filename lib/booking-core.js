(function attachBookingCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.UcsdBookingCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : self, function createBookingCore() {
  "use strict";

  const MIN_POLL_SECONDS = 3;
  const MAX_WINDOW_END_SECONDS = 10 * 60;
  const UCSD_DAILY_BOOKING_LIMIT = 2;

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeCourtName(value) {
    return normalizeSpace(value).replace(/\s*\|\s*/g, " | ");
  }

  function parseStartMinutes(slotText) {
    const match = normalizeSpace(slotText).match(
      /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)\b/i
    );
    if (!match) return null;

    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = (match[3] || match[4]).toUpperCase();
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (hour === 12) hour = 0;
    if (period === "PM") hour += 12;
    return hour * 60 + minute;
  }

  function isSlotInWindow(slotText, earliestMinutes, latestMinutes) {
    const start = parseStartMinutes(slotText);
    return start !== null && start >= earliestMinutes && start <= latestMinutes;
  }

  function isPreferredSlot(slotText, preferredStartMinutes) {
    const start = parseStartMinutes(slotText);
    return start !== null && preferredStartMinutes.includes(start);
  }

  function hasConsecutiveStarts(preferredStartMinutes) {
    const starts = new Set(preferredStartMinutes.map(Number));
    return [...starts].some((start) => starts.has(start + 60));
  }

  function findConsecutiveSlotPair(slots, preferredStartMinutes) {
    const selectedStarts = new Set(preferredStartMinutes.map(Number));
    const slotsByStart = new Map();
    slots.forEach((slot) => {
      const start = parseStartMinutes(slot.slotText);
      if (start !== null && selectedStarts.has(start) && !slotsByStart.has(start)) {
        slotsByStart.set(start, slot);
      }
    });

    for (const start of preferredStartMinutes.map(Number)) {
      if (selectedStarts.has(start + 60) && slotsByStart.has(start) && slotsByStart.has(start + 60)) {
        return [slotsByStart.get(start), slotsByStart.get(start + 60)];
      }
    }
    return null;
  }

  function courtAreaDetails(courtName) {
    const match = normalizeCourtName(courtName).match(/\|\s*(North|Muir)\s+(\d+)\b/i);
    return match ? { area: match[1].toLowerCase(), number: Number(match[2]) } : null;
  }

  function findSameAreaCourtPair(slots, preferredStartMinutes, courtOrder = []) {
    const selectedStarts = new Set(preferredStartMinutes.map(Number));
    const courtRank = new Map(courtOrder.map((court, index) => [normalizeCourtName(court), index]));
    const slotsByStart = new Map();
    slots.forEach((slot) => {
      const start = parseStartMinutes(slot.slotText);
      if (start === null || !selectedStarts.has(start) || !courtAreaDetails(slot.court)) return;
      if (!slotsByStart.has(start)) slotsByStart.set(start, []);
      slotsByStart.get(start).push(slot);
    });

    for (const start of preferredStartMinutes.map(Number)) {
      if (!selectedStarts.has(start + 60)) continue;
      const candidates = [];
      for (const first of slotsByStart.get(start) || []) {
        const firstDetails = courtAreaDetails(first.court);
        for (const second of slotsByStart.get(start + 60) || []) {
          const secondDetails = courtAreaDetails(second.court);
          if (normalizeCourtName(first.court) === normalizeCourtName(second.court)) continue;
          if (firstDetails.area !== secondDetails.area) continue;
          candidates.push({
            pair: [first, second],
            areaRank: firstDetails.area === "north" ? 0 : 1,
            distance: Math.abs(firstDetails.number - secondDetails.number),
            firstRank: courtRank.get(normalizeCourtName(first.court)) ?? 999,
            secondRank: courtRank.get(normalizeCourtName(second.court)) ?? 999
          });
        }
      }
      candidates.sort((a, b) => a.areaRank - b.areaRank || a.distance - b.distance ||
        a.firstRank - b.firstRank || a.secondRank - b.secondRank);
      if (candidates.length) return candidates[0].pair;
    }
    return null;
  }

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function desiredDateKey(now, daysAhead) {
    const target = new Date(now.getTime());
    target.setHours(12, 0, 0, 0);
    target.setDate(target.getDate() + daysAhead);
    return localDateKey(target);
  }

  function datePartsKey(parts) {
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function pickLatestDate(dateOptions) {
    if (!dateOptions.length) return null;
    return [...dateOptions].sort((a, b) => datePartsKey(b).localeCompare(datePartsKey(a)))[0];
  }

  function rankMatches(matches, courtOrder, preferredStartMinutes = []) {
    const courtRank = new Map(courtOrder.map((court, index) => [normalizeCourtName(court), index]));
    const hourRank = new Map(preferredStartMinutes.map((minutes, index) => [minutes, index]));
    return [...matches].sort((a, b) => {
      const courtDifference = (courtRank.get(normalizeCourtName(a.court)) ?? 999) -
        (courtRank.get(normalizeCourtName(b.court)) ?? 999);
      if (courtDifference !== 0) return courtDifference;
      const hourDifference = (hourRank.get(parseStartMinutes(a.slotText)) ?? 999) -
        (hourRank.get(parseStartMinutes(b.slotText)) ?? 999);
      if (hourDifference !== 0) return hourDifference;
      return (parseStartMinutes(a.slotText) ?? 9999) - (parseStartMinutes(b.slotText) ?? 9999);
    });
  }

  function buildDefaultCourtSearchOrder(allCourts) {
    const muirOrder = new Map([4, 3, 2, 1, 5].map((number, index) => [number, index]));
    return allCourts
      .map((court, originalIndex) => {
        const name = normalizeCourtName(court.name);
        const northMatch = name.match(/\|\s*North\s+(\d+)\b/i);
        const muirMatch = name.match(/\|\s*Muir\s+([1-5])\b/i);
        if (northMatch) return { court, group: 0, rank: Number(northMatch[1]), originalIndex };
        if (muirMatch) return { court, group: 1, rank: muirOrder.get(Number(muirMatch[1])), originalIndex };
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => a.group - b.group || a.rank - b.rank || a.originalIndex - b.originalIndex)
      .map((entry) => entry.court);
  }

  function nextLocalMidnight(now) {
    const next = new Date(now.getTime());
    next.setHours(24, 0, 0, 0);
    return next;
  }

  function parseTimeOfDay(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] || 0);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return hour * 3600 + minute * 60 + second;
  }

  function nextWindowStart(now, startSeconds, endSeconds) {
    const start = new Date(now.getTime());
    start.setHours(0, 0, 0, 0);
    start.setSeconds(startSeconds);
    if (Number.isFinite(endSeconds)) {
      const end = new Date(start.getTime());
      end.setHours(0, 0, 0, 0);
      end.setSeconds(endSeconds);
      if (now.getTime() >= start.getTime() && now.getTime() < end.getTime()) {
        return new Date(now.getTime() + 250);
      }
    }
    if (start.getTime() <= now.getTime()) start.setDate(start.getDate() + 1);
    return start;
  }

  function currentWindowEnd(now, endSeconds) {
    const end = new Date(now.getTime());
    end.setHours(0, 0, 0, 0);
    end.setSeconds(endSeconds);
    return end;
  }

  function isValidDateKey(value) {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const [year, month, day] = text.split("-").map(Number);
    const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
  }

  function parseBookingDateKey(value) {
    const text = normalizeSpace(value);
    const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (numeric) {
      const candidate = `${numeric[3]}-${String(Number(numeric[1])).padStart(2, "0")}-${String(Number(numeric[2])).padStart(2, "0")}`;
      return isValidDateKey(candidate) ? candidate : null;
    }

    const named = text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i);
    if (!named) return null;
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = monthNames.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    if (!month) return null;
    const candidate = `${named[3]}-${String(month).padStart(2, "0")}-${String(Number(named[2])).padStart(2, "0")}`;
    return isValidDateKey(candidate) ? candidate : null;
  }

  function countBookingsForDate(bookings, targetDate) {
    return bookings.filter((booking) =>
      (booking.dateKey || parseBookingDateKey(booking.dateText)) === targetDate
    ).length;
  }

  function validateSettings(input) {
    const errors = [];
    const selectedCourts = Array.isArray(input.selectedCourts)
      ? input.selectedCourts.map(normalizeCourtName).filter(Boolean)
      : [];
    const pollSeconds = Number(input.pollSeconds);
    const preferredStartMinutes = Array.isArray(input.preferredStartMinutes)
      ? [...new Set(input.preferredStartMinutes.map(Number))]
      : [];
    const windowStartSeconds = Number(input.windowStartSeconds);
    const windowEndSeconds = Number(input.windowEndSeconds);
    const targetDate = String(input.targetDate || "");

    if (pollSeconds !== MIN_POLL_SECONDS) {
      errors.push(`Availability checking is fixed at every ${MIN_POLL_SECONDS} seconds.`);
    }
    if (!preferredStartMinutes.length || preferredStartMinutes.some((minutes) =>
      !Number.isInteger(minutes) || minutes < 0 || minutes > 1439 || minutes % 60 !== 0)) {
      errors.push("Choose valid hourly time slots.");
    } else if (!hasConsecutiveStarts(preferredStartMinutes)) {
      errors.push("Choose at least two consecutive one-hour time slots for a two-hour booking.");
    }
    if (!isValidDateKey(targetDate)) errors.push("Choose a valid reservation date.");
    if (windowStartSeconds !== 0 || windowEndSeconds !== MAX_WINDOW_END_SECONDS) {
      errors.push("Monitoring is fixed at 12:00 AM–12:10 AM.");
    }

    return {
      errors,
      settings: {
        selectedCourts,
        pollSeconds,
        preferredStartMinutes,
        autoBook: input.autoBook === true,
        windowStartSeconds,
        windowEndSeconds,
        targetDate
      }
    };
  }

  return {
    UCSD_DAILY_BOOKING_LIMIT,
    MAX_WINDOW_END_SECONDS,
    MIN_POLL_SECONDS,
    buildDefaultCourtSearchOrder,
    countBookingsForDate,
    datePartsKey,
    desiredDateKey,
    courtAreaDetails,
    findConsecutiveSlotPair,
    findSameAreaCourtPair,
    hasConsecutiveStarts,
    isSlotInWindow,
    isPreferredSlot,
    isValidDateKey,
    localDateKey,
    nextLocalMidnight,
    nextWindowStart,
    normalizeCourtName,
    normalizeSpace,
    parseStartMinutes,
    parseBookingDateKey,
    parseTimeOfDay,
    pickLatestDate,
    rankMatches,
    validateSettings,
    currentWindowEnd
  };
});
