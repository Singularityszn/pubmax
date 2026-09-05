// THE API TREE'S OWN 404, AND THE ONE THING IT MAY NEVER BECOME.
//
// Verification scout verify-preview-4, section 7.3: a multipart
// `POST /api/avatar` - a mistyped `/api/avatar/<profileId>` - answered a 500
// HTML error page (`Failed to find Server Action`, then `Failed to load static
// file for page: /500`) rather than a 404 in the house envelope. It was the
// only error-level runtime log line on that preview in 75 minutes, and the typo
// is not what broke: Next treats a form-encoded or multipart POST to a path NO
// route handler claims as a Server Action invocation, looks the action id up in
// the body, finds none and throws. So the CONTENT TYPE decided whether an
// unknown address answered 404 or 500, which is a promise no caller can read.
//
// Every unmatched path under /api is claimed HERE. An optional catch-all sits
// below every real route - a static segment or a narrower dynamic one always
// wins - and it answers ONE `publicApiError(..., 404)` whatever the method and
// whatever the content type. Because a route handler now MATCHES the path, the
// Server Action lookup never runs at all.
//
// IT IS NOT A WRITE SURFACE AND MAY NEVER GROW INTO ONE. It reads no store,
// resolves no identity and spends no rate-limit budget: a budget read would
// make a mistyped address cost more than a real request and hand an attacker an
// amplification lever, and there is no write here for an authority boundary to
// stand in front of. `__tests__/writeSurfaceCertification.test.ts` holds it to
// exactly that - its ONLY import is the envelope - and is where both tree-wide
// fences record why a route that only ever refuses needs neither.
//
// SCOPE IS /api ALONE. A document path still answers `app/not-found.tsx`,
// because the flat JSON envelope is a contract with a CALLER and a browser
// asking for a page it can read is owed the house 404 page instead.

import { publicApiError } from "@/lib/apiError";

/** The one refusal, spent by every method. */
function unmatchedApiRoute(): Response {
  return publicApiError("That endpoint doesn't exist.", "NOT_FOUND", 404);
}

export function GET(): Response {
  return unmatchedApiRoute();
}

export function HEAD(): Response {
  return unmatchedApiRoute();
}

export function OPTIONS(): Response {
  return unmatchedApiRoute();
}

export function POST(): Response {
  return unmatchedApiRoute();
}

export function PUT(): Response {
  return unmatchedApiRoute();
}

export function PATCH(): Response {
  return unmatchedApiRoute();
}

export function DELETE(): Response {
  return unmatchedApiRoute();
}
