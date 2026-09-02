"use strict";

const CONTENT_PROTOCOL_VERSION = 12;
const ALARM_NAME = "ucsd-tennis-next-release";
const BOOKING_MATCH = "https://rec.ucsd.edu/booking/*";
const REC_MATCH = "https://rec.ucsd.edu/*";

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(values) {
  return chrome.storage.local.set(values);
}

function signInReturnsToBooking(tabUrl, preferredUrl) {
  if (!preferredUrl || !/\/account\/signin/i.test(tabUrl || "")) return false;
  const bookingPath = new URL(preferredUrl).pathname.toLowerCase();
  let decoded = String(tabUrl);
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch (_error) {
      break;
    }
  }
  return decoded.toLowerCase().includes(bookingPath);
}

async function findBookingTab(preferredUrl) {
  const tabs = await chrome.tabs.query({ url: REC_MATCH });
  const preferredTab = tabs.find((tab) => tab.url === preferredUrl);
  if (preferredTab) return preferredTab;
  const relatedSignInTab = tabs.find((tab) => signInReturnsToBooking(tab.url, preferredUrl));
  if (relatedSignInTab) return relatedSignInTab;
  if (!preferredUrl && tabs.length) return tabs[0];
  if (!preferredUrl) return null;
  return chrome.tabs.create({ url: preferredUrl, active: true });
}

async function hasCurrentContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GET_PROTOCOL_VERSION" });
    return response?.protocolVersion === CONTENT_PROTOCOL_VERSION;
  } catch (_error) {
    return false;
  }
}

function versionedStatus(status) {
  return { ...status, protocolVersion: CONTENT_PROTOCOL_VERSION };
}

async function refreshStaleBookingTabsAfterUpdate() {
  const { contentProtocolBootstrapVersion } = await storageGet("contentProtocolBootstrapVersion");
  if (contentProtocolBootstrapVersion === CONTENT_PROTOCOL_VERSION) return;
  await storageSet({
    contentProtocolBootstrapVersion: CONTENT_PROTOCOL_VERSION,
    status: versionedStatus({
      state: "starting",
      message: "Applying the latest watcher to the open UCSD booking tab…",
      updatedAt: Date.now()
    })
  });
  const tabs = await chrome.tabs.query({ url: BOOKING_MATCH });
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id && !await hasCurrentContentScript(tab.id)) {
      await chrome.tabs.reload(tab.id);
    }
  }));
}

async function startScheduledWatch() {
  const { settings, bookingUrl } = await storageGet(["settings", "bookingUrl"]);
  if (!settings || !bookingUrl) return;

  await storageSet({
    pendingScheduledStart: true,
    status: versionedStatus({ state: "starting", message: "Opening the booking page…", updatedAt: Date.now() })
  });
  const tab = await findBookingTab(bookingUrl);
  if (!tab || !tab.id) return;

  try {
    if (!await hasCurrentContentScript(tab.id)) {
      await chrome.tabs.reload(tab.id);
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: "START_WATCH", settings, source: "schedule" });
    await storageSet({ pendingScheduledStart: false });
  } catch (_error) {
    // A newly opened tab is not ready yet. Reloading also injects the content
    // script into a booking tab that was open before the extension was loaded.
    await chrome.tabs.reload(tab.id).catch(() => undefined);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) startScheduledWatch();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "ARM") {
      await chrome.alarms.clear(ALARM_NAME);
      await chrome.alarms.create(ALARM_NAME, { when: message.when });
      await storageSet({
        pendingImmediateStart: false,
        pendingScheduledStart: false,
        settings: message.settings,
        bookingUrl: message.bookingUrl,
        status: versionedStatus({
          state: "armed",
          message: `Armed for ${new Date(message.when).toLocaleString()}`,
          updatedAt: Date.now(),
          scheduledFor: message.when
        })
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "START_NOW") {
      await chrome.alarms.clear(ALARM_NAME);
      await storageSet({
        settings: message.settings,
        bookingUrl: message.bookingUrl,
        pendingImmediateStart: false,
        pendingScheduledStart: false
      });
      const tab = sender.tab || await findBookingTab(message.bookingUrl);
      if (!tab || !tab.id) throw new Error("Open the UCSD tennis booking page first.");
      if (!await hasCurrentContentScript(tab.id)) {
        await storageSet({
          pendingImmediateStart: true,
          status: versionedStatus({
            state: "starting",
            message: "Refreshing the booking page, then searching for an acceptable two-hour block…",
            updatedAt: Date.now()
          })
        });
        await chrome.tabs.reload(tab.id);
        sendResponse({ ok: true, reloading: true });
        return;
      }
      const result = await chrome.tabs.sendMessage(tab.id, { type: "START_WATCH", settings: message.settings, source: "manual" });
      sendResponse(result || { ok: true });
      return;
    }

    if (message.type === "OPEN_AND_LOGIN") {
      const bookingUrl = message.bookingUrl;
      if (!/^https:\/\/rec\.ucsd\.edu\/booking\/[0-9a-f-]+\/?$/i.test(bookingUrl || "")) {
        throw new Error("The tennis booking URL is invalid.");
      }
      await storageSet({ bookingUrl, autoLogin: message.autoLogin !== false });
      const tab = await findBookingTab(bookingUrl);
      if (!tab?.id) throw new Error("Could not open the UCSD Recreation page.");
      if (tab.url === bookingUrl) {
        await chrome.tabs.update(tab.id, { active: true });
      } else if (/\/account\/signin/i.test(tab.url || "")) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.tabs.reload(tab.id);
      } else {
        await chrome.tabs.update(tab.id, { active: true, url: bookingUrl });
      }
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "REVIEW_CANCELLATION") {
      if (!/^[0-9a-f-]{36}$/i.test(message.participantId || "")) {
        throw new Error("The selected booking identifier is invalid.");
      }
      const bookingUrl = message.bookingUrl;
      await storageSet({ pendingCancellationId: message.participantId, bookingUrl });
      const tab = await findBookingTab(bookingUrl);
      if (!tab?.id) throw new Error("Could not open your UCSD bookings.");
      await chrome.tabs.update(tab.id, { active: true, url: "https://rec.ucsd.edu/booking" });
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CONTENT_READY") {
      if (message.protocolVersion !== CONTENT_PROTOCOL_VERSION) {
        sendResponse({ ok: true, stale: true });
        return;
      }
      const { pendingImmediateStart, pendingScheduledStart, settings, bookingUrl, status } = await storageGet([
        "pendingImmediateStart",
        "pendingScheduledStart",
        "settings",
        "bookingUrl",
        "status"
      ]);
      const tab = sender.tab;
      await storageSet({ lastSsoAttemptAt: 0 });
      if (pendingImmediateStart && settings && tab?.id && tab.url === bookingUrl) {
        await chrome.tabs.sendMessage(tab.id, { type: "START_WATCH", settings, source: "manual" });
        await storageSet({ pendingImmediateStart: false, pendingScheduledStart: false });
      } else if (pendingScheduledStart && settings && tab?.id && tab.url === bookingUrl) {
        await chrome.tabs.sendMessage(tab.id, { type: "START_WATCH", settings, source: "schedule" });
        await storageSet({ pendingScheduledStart: false });
      } else if (status?.protocolVersion !== CONTENT_PROTOCOL_VERSION || status?.state === "starting") {
        await storageSet({
          status: versionedStatus({
            state: "idle",
            message: "Latest watcher loaded. Ready to select an available court.",
            updatedAt: Date.now()
          })
        });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "STOP") {
      await chrome.alarms.clear(ALARM_NAME);
      const tabs = await chrome.tabs.query({ url: BOOKING_MATCH });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: "STOP_WATCH" }).catch(() => undefined)
        : undefined));
      await storageSet({
        pendingImmediateStart: false,
        pendingScheduledStart: false,
        status: versionedStatus({ state: "stopped", message: "Watcher stopped.", updatedAt: Date.now() })
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "STATUS") {
      await storageSet({ status: versionedStatus({ ...message.status, updatedAt: Date.now() }) });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "FOUND") {
      const tabId = sender.tab && sender.tab.id;
      if (tabId) {
        await chrome.tabs.update(tabId, { active: true });
        if (sender.tab.windowId) await chrome.windows.update(sender.tab.windowId, { focused: true });
      }

      const pair = Array.isArray(message.pair) ? message.pair : [message.match].filter(Boolean);
      const pairText = pair.map((match) => `${match.slotText} on ${match.court}`).join(" + ");
      const title = message.autoBook ? "Booking a two-hour tennis block" : "Two-hour block available";
      const notificationId = `ucsd-tennis-${Date.now()}`;
      try {
        await chrome.notifications.create(notificationId, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title,
          message: message.autoBook
            ? `${pairText}. Confirming both UCSD reservations.`
            : `${pairText}.`,
          priority: 2,
          requireInteraction: true
        });
        await storageSet({ notificationTabs: { [notificationId]: tabId } });
      } catch (_error) {
        // Focusing the tab and the in-page alert remain as fallbacks.
      }
      await storageSet({
        status: versionedStatus({ state: message.autoBook ? "booking" : "found", message: `${title}: ${pairText}`, pair, updatedAt: Date.now() })
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "PAGE_INFO") {
      const tab = sender.tab;
      if (!tab || !tab.id) throw new Error("Open this popup from the UCSD tennis booking tab.");
      const pageInfo = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_INFO" });
      sendResponse(pageInfo);
      return;
    }

    sendResponse({ ok: false, error: "Unknown message." });
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const { notificationTabs = {} } = await storageGet("notificationTabs");
  const tabId = notificationTabs[notificationId];
  if (tabId) await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
  await chrome.notifications.clear(notificationId);
});

refreshStaleBookingTabsAfterUpdate().catch(() => undefined);
