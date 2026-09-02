"use strict";

const SSO_RETRY_COOLDOWN_MS = 30_000;

function showLoginHelper(message, state = "working") {
  let helper = document.querySelector("#ucsd-tennis-login-helper");
  if (!helper) {
    helper = document.createElement("aside");
    helper.id = "ucsd-tennis-login-helper";
    Object.assign(helper.style, {
      background: state === "paused" ? "#7d2d36" : "#10284d",
      borderRadius: "12px",
      bottom: "22px",
      boxShadow: "0 12px 36px rgba(0,0,0,.28)",
      color: "white",
      font: "600 13px/1.4 system-ui, sans-serif",
      maxWidth: "390px",
      padding: "14px 16px",
      position: "fixed",
      right: "22px",
      zIndex: "2147483647"
    });
    document.body.appendChild(helper);
  }
  helper.textContent = message;
}

async function continueToUcsdSso() {
  const stored = await chrome.storage.local.get(["autoLogin", "lastSsoAttemptAt"]);
  if (stored.autoLogin === false) {
    showLoginHelper("UCSD SSO is ready. Click the Single Sign On button when you want to continue.", "paused");
    return;
  }

  const now = Date.now();
  if (now - Number(stored.lastSsoAttemptAt || 0) < SSO_RETRY_COOLDOWN_MS) {
    showLoginHelper("Automatic SSO paused to prevent a redirect loop. Click the UCSD SSO button to retry.", "paused");
    return;
  }

  const button = document.querySelector("button.btn-sso-shibboleth[data-provider-name='Shibboleth']");
  if (!button) {
    showLoginHelper("Could not find the UCSD SSO button. Continue sign-in manually on this page.", "paused");
    return;
  }

  await chrome.storage.local.set({ lastSsoAttemptAt: now });
  showLoginHelper("Redirecting to UCSD Single Sign-On… Complete your UCSD password and Duo approval if prompted.");
  window.setTimeout(() => button.click(), 500);
}

continueToUcsdSso().catch(() => {
  showLoginHelper("Automatic SSO could not continue. Use the UCSD Single Sign On button manually.", "paused");
});
