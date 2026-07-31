// ═══════════════════════════════════════════════════════════════════
// DONATE CONFIG — single source of truth for the modal and for
// scripts/gen-donate-qr.mjs (which bakes this URL into public/donate-qr.svg).
//
// ⚠ NEVER put bank or routing numbers in here. This repo is public and git
// history is permanent; a published account number invites fraudulent ACH
// debits. The processor holds those details, and donors only ever see the
// public business name configured on the processor's side — set that to
// "NU Map" so a legal name never appears at checkout.
//
// One rail, deliberately. This started as two (a fast card link plus GitHub
// Sponsors for its 0% fee) and that was the wrong call: Sponsors' checkout
// requires a logged-in GitHub account, which most non-CS undergrads do not
// have, so for the actual audience it is a signup wall rather than a discount.
// A second option also costs a decision at the exact moment the flow is
// trying to be a single scan.
//
// Expected value: a Stripe Payment Link (buy.stripe.com/…) with wallet
// payments on, or a Ko-fi page. Both are scan → Face ID → done, with no
// donor account and nothing typed.
//
// Empty string is a valid, safe state: the header pill and the About modal's
// /donate button both hide themselves, so nothing ships pointing nowhere.
// After setting it, run `npm run gen:donate-qr` to re-encode the QR.
// ═══════════════════════════════════════════════════════════════════

export const DONATE_URL = "https://buy.stripe.com/fZu8wJf575zY7Ljd633AY00";

export const donateEnabled = () => Boolean(DONATE_URL);

// Stripe Checkout takes a `locale` URL parameter and otherwise sniffs the
// browser's language. Passing our active locale keeps the handoff seamless:
// someone reading the app in Korean shouldn't land on an English pay page.
//
// Stripe supports 7 of our 8 locales one-for-one. Hindi is absent from its
// list entirely, so `hi` is deliberately omitted rather than mapped — with no
// parameter Stripe falls back to browser detection, which may well find a
// language it does support. Forcing `en` would throw that chance away.
const STRIPE_LOCALES = { en: "en", es: "es", fr: "fr", ja: "ja", ko: "ko", zh: "zh", ar: "ar" };

/** Donate URL with the checkout page pinned to `locale` where Stripe supports it. */
export function donateUrlFor(locale) {
  const code = STRIPE_LOCALES[locale];
  if (!DONATE_URL || !code) return DONATE_URL;
  return `${DONATE_URL}?locale=${code}`;
}
