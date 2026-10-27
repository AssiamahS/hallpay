# HallPay

**Know your check is right before you leave the hall.** Log every longshore shift (terminal, vessel, gang, job, hours), and HallPay splits straight / overtime / double time, adds the call-out guarantee and skill differential, checks the paycheck stub against it, tracks container-royalty hours toward the qualifying threshold, and warns before a TWIC or equipment card expires.

- **Live web app:** https://assiamahs.github.io/hallpay/ (installable, works offline, data stays on the phone)
- **iPhone Duo app:** `ios/` (SwiftUI, three columns on the 7.6" inner display, one stack on the 5.4" outer display)

## Who pays and why

| | |
|---|---|
| Buyer | ILA (East / Gulf Coast) and ILWU (West Coast) longshore workers, checkers, clerks, lashers, crane operators. Casuals building hours care most: they get the odd shifts, the guarantee calls and the most pay errors. |
| Pain | Pay is split across straight time, overtime, double time, guarantees, differentials and holidays, by port. Workers keep paper books or the notes app and only notice a short check weeks later. |
| Price | **$4.99/mo or $39/yr**, gang/local bundle **$99/yr** (up to 10 phones). Undercuts the only direct competitor ($6.99 / $49.99). |
| Wedge | Works **today, in any browser, on Android too**, with no App Store. Dispute note for the steward is one tap. Native Duo app follows. |

### Evidence

- Official ILA app already shows timesheets, earnings, royalty and cert alerts **for members with a login** — so the job is real and valued, but casuals / non-members and anyone wanting their own independent record are not covered: <https://www.iladistrict.com/?p=8507>
- **DockBook Longshore Pay Tracker** (iOS only) charges **$6.99/mo or $49.99/yr** for exactly this — shift log, paystub check, PGP, pension — and added ILA East/Gulf ports in v3: <https://apps.apple.com/us/app/id6758878439>. Proof people pay; also the main risk.
- r/Longshoremen thread "Making a better shift tracker" — workers asking for a better tracker, others pointing to the Android-only *My TimeBook*: <https://www.reddit.com/r/Longshoremen/comments/1h70va1/making_a_better_shift_tracker/>
- *My TimeBook* (third-party, data deleted if the app is deleted): <https://apps.apple.com/app/id519511422>
- USMX-ILA Master Contract 2024-2030 (62% raise over 6 years, royalty terms) — rates change every October 1, so people need to re-check their pay: <https://usmx.com/> / <https://www.logisticsmgmt.com/article/ila_membership_ratifies_new_master_contract_with_the_usmx/Labor>
- How builders actually make money with Claude: narrow, painful problem for a specific trade beats broad apps; distribution is the bottleneck, not code. <https://lucijatomsic.substack.com/p/the-claude-money-map-12-income-streams>, <https://gameplaydev.substack.com/p/my-ai-generated-apps-earn-1600mo>

## First dollar

1. Put a payment link in `web/config.js` (`PAY_URL`) and a phone/email in `CONTACT`. Commit; Pages redeploys in about a minute.
2. Post the outreach message (below) in r/Longshoremen, longshore Facebook groups (search "ILA Local 1235", "ILA 1804-1", "ILWU Local 13", "Longshoremen of America", "Port of NY/NJ Longshoremen"), and text it to anyone you know on the docks.
3. Offer the **founding price**: $39/yr locked for life for the first 50, or $99 for a whole gang.

> Built a free tool for longshore pay: log the shift (terminal, vessel, gang, hours) and it splits ST / OT / DT, adds the guarantee, and tells you if your stub came up short — with the note for your steward already written. Works in the browser, Android or iPhone, no account, nothing leaves your phone: https://assiamahs.github.io/hallpay/ — set your own rates in the Rates tab. Looking for 10 guys to try it this week and tell me what's wrong with it.

## Setting `PAY_URL` and `CONTACT`

Edit `web/config.js`:

```js
window.HALLPAY_CONFIG = {
  PAY_URL: "https://buy.stripe.com/xxxxxxxx",   // Stripe/Square/PayPal/Venmo link
  CONTACT: "+15555550123",                       // or an email
  ...
};
```

- `PAY_URL` set: the **Start** button opens it.
- `PAY_URL` empty: **Start** opens a request-access form that composes an email (email `CONTACT`) or text message (phone `CONTACT`). With both empty it copies the request to the clipboard.

## Layout

```
web/            static PWA, no build step (index.html, app.js, styles.css, config.js, sw.js)
ios/            XcodeGen project.yml + SwiftUI/SwiftData app (iOS 26.0+, com.assiamah.hallpay)
.github/workflows/pages.yml   deploys web/ to GitHub Pages
.github/workflows/ios.yml     unsigned simulator build on the Xcode 27 runner
```

### iPhone Duo

`NavigationSplitView` with section / list / detail columns. On the inner display you get the shift log and the pay breakdown side by side; folded, it collapses to a push stack. Section and selection live in `@SceneStorage`, rates in `@AppStorage`, shifts/stubs/cards in SwiftData, so folding mid-edit lands you on the same shift. Built with the iOS 27.1 SDK in CI so it fills the inner display instead of letterboxing.

Build locally: `cd ios && xcodegen generate && open HallPay.xcodeproj`.

## Not affiliated

Not affiliated with the ILA, ILWU, USMX or PMA. Rates are whatever the user enters; the $40 default is an example.
