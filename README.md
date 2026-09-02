# UCSD Tennis Court Watcher

A personal Chrome extension that watches the official UCSD Recreation tennis booking page for newly released courts. It uses the UCSD SSO session already open in your browser and lets you choose acceptable one-hour ranges, such as **7:00–8:00 AM** and **8:00–9:00 AM**. One click searches for and books a consecutive two-hour block.

There is no extension confirmation dialog after clicking a Book 2 Hours button; the button itself authorizes up to two real reservations. UCSD password, Duo, and CAPTCHA steps remain manual. The cancellation helper opens the selected reservation's UCSD confirmation dialog but never clicks the destructive **Yes, Cancel** button.

## What it does

- Lets you select an exact reservation date, including the next date expected to release.
- Uses a custom Court Watcher identity across Chrome's toolbar, extension listing, desktop notifications, and popup instead of the generic extension icon.
- Can be armed for a precise midnight window and keeps checking through delayed releases such as 12:04 AM.
- Uses a fixed court order: every North court first, then Muir 4, Muir 3, Muir 2, Muir 1, and Muir 5.
- Requires two selected, consecutive hours and prioritizes both hours on the same court.
- If no same-court pair exists, it can split the two hours between nearby courts in the same complex: North with North or Muir with Muir. It never combines a North hour with a Muir hour.
- Never intentionally books a lone hour. Because UCSD processes the two reservations separately, it stops and clearly reports a partial result if hour one succeeds but hour two is taken during the attempt.
- Never requests availability for Warren or Coast courts.
- Checks the official booking partial-page endpoints with your existing session.
- Uses a fixed 3-second release check and makes only one lightweight UCSD availability request per tick.
- Uses one fixed midnight monitoring window: **12:00–12:10 AM**, with no editable start or stop controls.
- Brings the booking tab forward, posts a desktop notification, selects each exact date/court/range, clicks **Book Now**, and confirms each reservation against UCSD's upcoming-bookings list before continuing.
- Detects when an already-open UCSD tab is still running an older extension content script, reloads that tab automatically, and resumes the same Book 2 Hours request after the updated script is ready.
- Detects when Chrome still has an older unpacked-extension runtime even though the popup files changed on disk. Opening the popup applies the new runtime automatically, then refreshes open UCSD booking tabs once.
- Displays the detected reservation count for the selected date as information only. The extension never disables or stops Book 2 Hours because of that count; UCSD Recreation remains the source of truth for its two-slots-per-day rule.
- Lists current reservations and can open UCSD's cancellation review dialog for one of them; the final cancellation remains manual.
- Stores preferences locally, but never stores a UCSD password, Duo code, cookies, or SSO tokens.
- Opens the tennis page and automatically continues through UCSD Recreation's official Single Sign-On button. UCSD password, Duo, and CAPTCHA steps always remain manual.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

   `C:\Users\chenz\OneDrive\Documents\ChatGPT\UCSDTennisRec`

5. Pin **UCSD Tennis Court Watcher** to the toolbar.

For later local updates, open the popup once. If Chrome is still running an older build, the popup closes while the extension reloads and the UCSD booking tab refreshes. Reopen the popup after that one-time refresh; the old stored error is discarded automatically.

## Install on another laptop

Sign in to the same GitHub account, then either download the repository ZIP from GitHub or clone it:

```powershell
gh repo clone ZhuoxiChen09/UCSDTennisRec
```

On that laptop, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the cloned `UCSDTennisRec` folder. To receive later updates, run `git pull` inside that folder and click **Reload** for the extension in Chrome.

## Use it for a midnight release

1. Around 11:50 PM, open [the UCSD tennis booking page](https://rec.ucsd.edu/booking/9f19b678-58ce-4dfc-bd78-7166bde9e265).
2. Sign in normally with UCSD SSO and complete Duo yourself. Confirm the tennis date/court page is visible.
3. Open the extension and select the exact reservation date and acceptable one-hour ranges. At least two selected ranges must be adjacent. The court order is already fixed.
4. Click **Book 2 hours at midnight**. It arms immediately; keep Chrome running and keep the booking tab open.
5. From 12:00 through 12:10 AM, the extension checks all North courts, then Muir 4, 3, 2, 1, and 5. It books the first same-court consecutive pair. Only after a complete pass finds no same-court pair can it split adjacent hours between nearby courts in the same North or Muir complex. UCSD accepts or rejects each booking under its account rules.

Use **Book 2 hours now** to test an already-released day. It starts immediately, searches for up to ten minutes, and can create two real reservations. To test cancellation, choose an entry under **Existing reservations** and click **Review cancellation**; verify the UCSD dialog and click **Yes, Cancel** yourself only if you intend to cancel it.

## Assisted UCSD SSO

Use **Open UCSD Recreation & continue with SSO** from the popup. The extension opens the exact tennis URL. If the Recreation session is expired, the site redirects to its official sign-in page and the extension clicks **Single Sign On | UC San Diego** for you. It then waits while you complete any UCSD username/password, Duo, or CAPTCHA prompt. UCSD redirects back to the tennis page after successful authentication.

The extension never reads or stores your UCSD credentials. Automatic SSO has a 30-second retry cooldown so an authentication error cannot create a redirect loop. You can turn off the automatic SSO-button click in the popup and continue manually.

## Important behavior

- Court priority is enforced in code: North courts in number order, followed by Muir 4 → 3 → 2 → 1 → 5. Warren and Coast are filtered out before polling.
- Pair priority is enforced in code: same court first, then the closest-numbered different courts within the same area. North/Muir combinations are rejected.
- The extension checks one eligible court every three seconds. With seven North and five Muir courts, a complete pass takes about 36 seconds.
- If your SSO session expires, the watcher stops and asks you to sign in again.
- Chrome must be running. Laptop sleep, network loss, an expired session, or browser timer throttling can delay a check.
- UCSD can change its HTML or booking rules. Re-test carefully with **Book 2 hours now** after a site redesign because that button can create two real reservations.
- After updating the unpacked extension, an older booking tab may refresh once on the next Book 2 Hours action. The pending search resumes automatically; do not click the button a second time.
- Follow UCSD Recreation rules and terms. The three-second minimum and one-request-per-tick design are built in; do not modify them to interfere with other users.

## Verify the code

No install dependencies are required. With Node.js available:

```powershell
npm test
npm run check
```

These checks cover exact-date targeting, per-date booking-limit counting, consecutive same-court pairs, same-area nearby-court fallback, rejection of North/Muir splits, the fixed ten-minute midnight boundary, 3-second validation, AM/PM time parsing, court ordering, exclusions, stale-tab recovery protocol parity, input limits, and JavaScript syntax.
