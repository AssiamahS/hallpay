// HallPay sales config. Edit these two values, commit, and Pages redeploys.
//
// PAY_URL  - a payment link (Stripe Payment Link, Square, PayPal.me, Venmo, Cash App...).
//            When set, the "Start" button opens it in a new tab.
// CONTACT  - an email address (you@example.com) or a phone number (+15555550123).
//            When PAY_URL is empty, "Start" shows a request-access form that
//            composes an email (or a text message for phone numbers) to CONTACT.
//
// Leave both empty and the form still works: it copies the request to the clipboard.
window.HALLPAY_CONFIG = {
  PAY_URL: "",
  CONTACT: "",
  PRICE_MONTH: "$4.99",
  PRICE_YEAR: "$39",
  CREW_PRICE: "$99/yr per gang (up to 10 phones)",
};
