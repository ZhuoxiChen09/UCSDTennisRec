# UCSD Tennis Court Watcher

A personal Chrome extension that watches the official UCSD Recreation tennis booking page for newly released courts. It uses the UCSD SSO session already open in your browser and lets you choose preferred one-hour ranges, such as **7:00–8:00 AM** and **8:00–9:00 AM**. One click searches for and books a consecutive two-hour block.

There is no extension confirmation dialog after clicking a Book 2 Hours button; the button itself authorizes up to two real reservations. UCSD password, Duo, and CAPTCHA steps remain manual. The cancellation helper opens the selected reservation's UCSD confirmation dialog but never clicks the destructive **Yes, Cancel** button.

## What it does

- Lets you select an exact reservation date, including the next date expected to release.
- Uses a custom Court Watcher identity across Chrome's toolbar, extension listing, desktop notifications, and popup instead of the generic extension icon.
- The live **Start midnight watcher** button can be clicked anytime. It creates an alarm but makes no repeating availability requests before 12:00:00 AM, then keeps checking through delayed releases until 12:05 AM.
- Uses a fixed court order: every North court first, then Muir 4, Muir 3, Muir 2, Muir 1, and Muir 5.
- Requires two selected, consecutive preferred hours. It searches those first, then falls back to any available consecutive two-hour block rather than giving up.
- If no same-court pair exists, it can split the two hours between nearby courts in the same complex: North with North or Muir with Muir. It never combines a North hour with a Muir hour.
- Never intentionally chooses a lone hour. If hour one succeeds but hour two is taken during the attempt, it immediately rescans every eligible court for that exact missing hour, preferring the original court and then the nearest court in the same North or Muir area. It reports a partial result only when no safe consecutive replacement remains or UCSD cannot verify the outcome.
- Never requests availability for Warren or Coast courts.
- Checks the official booking partial-page endpoints with your existing session.
- Uses a fixed 1-second release check and makes only one lightweight UCSD availability request per tick.
- Uses one fixed midnight monitoring window: **12:00–12:05 AM**, with no editable start or stop controls.
- Backs off before one retry when UCSD returns a rate limit, access error, or temporary server error.
- Brings the booking tab forward, posts a desktop notification, selects each exact date/court/range, clicks **Book Now**, and confirms each reservation against UCSD's upcoming-bookings list before continuing.
- Shows simulator reservations in a **Booked sessions** panel on the same test page. Cancelling there removes the test reservation and immediately returns that exact slot to availability.
- Detects when an already-open UCSD tab is still running an older extension content script, reloads that tab automatically, and resumes the same Book 2 Hours request after the updated script is ready.
- Detects when Chrome still has an older unpacked-extension runtime even though the popup files changed on disk. Opening the popup applies the new runtime automatically, then refreshes open UCSD booking tabs once.
- Displays the detected reservation count for the selected date. On live UCSD, the count remains informational and UCSD Recreation is the authority. In the local simulator, two bookings on one date disable further test bookings for that date until one is cancelled.
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

## Test anytime with the local court simulator

The repository includes a local replica of the UCSD Recreation tennis booking surface. Its booking-label test set contains Muir 1–5, North 6–12, and the excluded Warren 13 and Coast 14 courts. It provides a rolling four-date window while implementing the same dates, facilities, slots, booking, and reservation-list HTML contracts used by the extension. Every hourly slot on all 14 courts starts available. The release console can add any later calendar date, including a date in a future year; dates stay chronological, the earliest tile drops off, and all unbooked slots on the remaining dates stay available. The server also advances the four-date window automatically when the computer's local calendar day changes. It never contacts UCSD and every reservation it creates is test data held only in memory.

1. Start the simulator:

   ```powershell
   npm run simulator
   ```

2. In `chrome://extensions`, reload the existing unpacked **UCSD Tennis Court Watcher** loaded from this repository. The extension can access the local replica as well as the real UCSD site.
3. Open the normal extension and click **Open Test Simulator**. On the simulator page, reopen the extension, keep the default 7:00 AM and 8:00 AM hours selected, and click **Run test: book 2 hours**.
4. On the replica, open **Test release controls** and use **Random release**, **Same-court pair**, **Nearby split pair**, **Second-hour race loss**, or **Second-hour recovery**. The recovery case confirms hour one on North 6, removes North 6's second hour during booking, and leaves that exact hour open on North 7 so the extension must rescan and finish there. These scenarios change only the selected date. Scheduling a random release automatically makes only that date empty first, allowing the extension to poll before the delayed pair appears.
5. For the most realistic release test, select the simulator's next unreleased date in the extension, choose 6:00 PM, 7:00 PM, and 8:00 PM, and start the watcher. In the simulator, choose from 4 through 100 competitors and click **Release with rush** beside the new-date field. The new date appears first, then competitors immediately begin claiming slots on that exact date with an eight-times preference for 6:00–9:00 PM.
6. **Start rush** remains available for contention on a date that is already visible. Use **Run guaranteed split test** to have competitors consume every conflicting evening option while leaving a consecutive North 6 + North 7 fallback, so the extension's split-court behavior can be verified without depending on luck. All modes remain entirely local.

The same production two-click-and-verify code path is used on both sites; the simulator changes only the origin and in-memory server behind the page. A successful test must show two entries under **Booked sessions**. Cancelling either entry restores its slot. **Clear activity** empties only the simulator event log without changing bookings or availability. Restarting the server clears all test reservations.

The actual extension identifies its environment before it can start a watch. A genuine `https://rec.ucsd.edu` booking page is labeled **LIVE UCSD**. A local page must be on `127.0.0.1` and carry the simulator's environment marker; otherwise the extension refuses to run. On the simulator, the popup, in-page watcher, saved status, and desktop notification are labeled **TEST**, and the popup displays the active case such as `default availability`, `same court`, `same area`, `race loss`, `date release`, or `empty availability`.

## Use it for a midnight release

1. Around 11:50 PM, open [the UCSD tennis booking page](https://rec.ucsd.edu/booking/9f19b678-58ce-4dfc-bd78-7166bde9e265).
2. Sign in normally with UCSD SSO and complete Duo yourself. Confirm the tennis date/court page is visible.
3. Open the extension and select the exact reservation date and preferred one-hour ranges. At least two selected ranges must be adjacent. The court order is already fixed. If the selected hours cannot form a pair, the extension is authorized to try any other consecutive two-hour block.
4. Click **Start midnight watcher** anytime before the release. It arms immediately but does not poll court availability before 12:00:00 AM; keep Chrome running and keep the booking tab open.
5. From 12:00 through 12:05 AM, the extension checks all North courts, then Muir 4, 3, 2, 1, and 5. It first searches for the selected pair on one court and then within one area. If those preferred hours are unavailable, it searches the complete court pass for any consecutive pair, again favoring one court before a nearby same-area split. UCSD accepts or rejects each booking under its account rules.

On the live UCSD page, the main button always waits for the midnight window; it no longer starts an early polling loop. On the local simulator, **Run test: book 2 hours** still starts immediately for daytime testing. To test cancellation, choose an entry under **Existing reservations** and click **Review cancellation**; verify the UCSD dialog and click **Yes, Cancel** yourself only if you intend to cancel it.

## Assisted UCSD SSO

Use **Open UCSD Recreation & continue with SSO** from the popup. The extension opens the exact tennis URL. If the Recreation session is expired, the site redirects to its official sign-in page and the extension clicks **Single Sign On | UC San Diego** for you. It then waits while you complete any UCSD username/password, Duo, or CAPTCHA prompt. UCSD redirects back to the tennis page after successful authentication.

The extension never reads or stores your UCSD credentials. Automatic SSO has a 30-second retry cooldown so an authentication error cannot create a redirect loop. You can turn off the automatic SSO-button click in the popup and continue manually.

## Important behavior

- Court priority is enforced in code: North courts in number order, followed by Muir 4 → 3 → 2 → 1 → 5. Warren and Coast are filtered out before polling.
- Pair priority is enforced in code: selected hours before other hours; within each phase, same court first, then the closest-numbered different courts within the same area. North/Muir combinations are rejected.
- The extension checks one eligible court every second. With seven North and five Muir courts, a complete pass takes about 12 seconds. Requests never overlap, and rate-limit or server responses trigger a bounded backoff before one retry.
- If your SSO session expires, the watcher stops and asks you to sign in again.
- Chrome must be running. Laptop sleep, network loss, an expired session, or browser timer throttling can delay a check.
- UCSD can change its HTML or booking rules. Re-test the production code path in the simulator after a site redesign before relying on **Start midnight watcher**, because the live run can create two real reservations once midnight arrives.
- After updating the unpacked extension, an older booking tab may refresh once on the next Book 2 Hours action. The pending search resumes automatically; do not click the button a second time.
- Follow UCSD Recreation rules and terms. The one-second floor, single in-flight request, five-minute hard stop, and automatic backoff are built in; do not modify them to interfere with other users.

## Verify the code

No install dependencies are required. With Node.js available:

```powershell
npm test
npm run check
```

These checks cover exact-date targeting, per-date booking-limit counting, preferred and any-time consecutive pairs, same-area nearby-court fallback, rejection of North/Muir splits, the fixed five-minute midnight boundary, 1-second validation and backoff contract, weighted virtual competitors, the expanded simulator court set, AM/PM time parsing, court ordering, exclusions, stale-tab recovery protocol parity, input limits, and JavaScript syntax.
