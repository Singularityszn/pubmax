// The one public contact address for PUBMAXXING - press, privacy requests,
// data-rights requests, support, and anything else a reader needs to reach a
// human on.
//
// ONE constant on purpose: /privacy, /terms, /about (including the
// Organization JSON-LD), /account/delete, the account legal row, the landing
// footer and every crawler user-agent string read it, so moving to another
// inbox later is a single-line change with no page and no bot header left
// quoting a dead address. Only put an address here that is actually
// monitored - a privacy notice that names an inbox nobody reads is worse than
// no address at all.
//
// This is plain ESM with a .d.mts sidecar, the lib/buildInfo.mjs idiom, because
// the plain-node harvest and refresh scripts under scripts/ name the same
// address in their user-agent headers and cannot import TypeScript. The app
// reaches it through lib/siteContact.ts, which re-exports these two names.
//
// MAILBOX OWNER: the captain creates and monitors support@pubmaxxing.com. It
// must answer before a store submission, because both stores require a working
// public support contact for an app declaring user content (see
// docs/STORE_READINESS.md).
export const CONTACT_EMAIL = "support@pubmaxxing.com";

/** `mailto:` href for the same address, so callers never rebuild the string. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
