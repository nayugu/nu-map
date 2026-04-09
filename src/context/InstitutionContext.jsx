// ═══════════════════════════════════════════════════════════════════
// INSTITUTION CONTEXT
// ═══════════════════════════════════════════════════════════════════
//
// The bridge between the adapter bundle (src/adapters/) and the
// React component tree.  Wrap the root once with InstitutionProvider,
// then read any port anywhere with usePort().
//
// ── SETUP (already done in App.jsx) ─────────────────────────────
//
//   import northeasternAdapter from "./adapters/northeastern/index.js";
//   <InstitutionProvider adapter={northeasternAdapter}>
//     ...
//   </InstitutionProvider>
//
// ── READING A PORT IN A COMPONENT ───────────────────────────────
//
//   import { usePort }           from "../context/InstitutionContext.jsx";
//   import { IAttributeSystem }  from "../ports/IAttributeSystem.js";
//
//   const attributeSystem = usePort(IAttributeSystem);
//
//   Port constants (IAttributeSystem, ICalendar, etc.) are the same
//   camelCase strings used as keys in the wiring file — they are
//   imported from src/ports/ purely so typos are caught at the
//   import site rather than silently returning undefined at runtime.
//
// ── WHEN TO USE useInstitution() INSTEAD ────────────────────────
//
//   Only when you need the whole adapter object at once — e.g. when
//   passing it as a parameter to a non-React function like exportReport().
//   For everything else, prefer usePort().
//
// ═══════════════════════════════════════════════════════════════════
import { createContext, useContext } from "react";

const InstitutionContext = createContext(null);

/**
 * @param {{ adapter: object, children: React.ReactNode }} props
 */
export function InstitutionProvider({ adapter, children }) {
  return (
    <InstitutionContext.Provider value={adapter}>
      {children}
    </InstitutionContext.Provider>
  );
}

/**
 * Returns the active institution adapter bundle.
 * Must be called inside a component tree wrapped by <InstitutionProvider>.
 * Prefer usePort() when consuming a single port.
 */
export function useInstitution() {
  const ctx = useContext(InstitutionContext);
  if (!ctx) throw new Error("useInstitution() must be used inside <InstitutionProvider>");
  return ctx;
}

/**
 * Returns the implementation bound to a specific port key.
 * Import the port constant and pass it as the key:
 *
 *   import { IAttributeSystem } from "../ports/IAttributeSystem.js";
 *   const attributeSystem = usePort(IAttributeSystem);
 *
 * @param {string} portKey - Port constant from src/ports/*.js
 */
export function usePort(portKey) {
  const ctx = useContext(InstitutionContext);
  if (!ctx) throw new Error("usePort() must be used inside <InstitutionProvider>");
  return ctx[portKey];
}
