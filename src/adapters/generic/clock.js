// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/clock  (implements IClock)
// Production clock — always returns the real current time.
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/IClock.js').IClock} */
const clock = {
  now() { return new Date(); },
  getSources() { return []; },
};

export default clock;
