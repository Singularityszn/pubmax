// The message the prerendered Ledger throws when lookupVenueDetail could not
// run. A cached document may not carry the read-unavailable card (it would be
// held for the whole ISR window), so app/ledger/[id]/page.tsx throws instead:
// ISR keeps the last good copy, or holds nothing, and the next request reads
// again. app/ledger/[id]/error.tsx draws the card.
export const LEDGER_READ_UNAVAILABLE = "ledger: venue read unavailable";
