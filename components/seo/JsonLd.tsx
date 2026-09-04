import type { ReactElement } from "react";

import { serializeInlineScriptJson } from "@/lib/inlineScriptJson";

// Server-only JSON-LD injector (Wave S1.3). Renders a single
// <script type="application/ld+json"> with the structured-data graph for a
// route. Two hard rules live here:
//
//  1. XSS-safe serialization. JSON-LD is emitted inside an HTML <script>, so any
//     "<", ">" or "&" in the data (a pub name, a cited fact) could otherwise
//     break out of the script element or smuggle markup. The escaping itself
//     lives in the ONE leaf module every inline <script> body shares,
//     lib/inlineScriptJson.ts - never a second JSON.stringify at an emitter.
//  2. CSP nonce. app/layout.tsx serves a per-request nonce CSP (see proxy.ts)
//     with NO 'unsafe-inline' in script-src. The browser enforces script-src on
//     EVERY <script> element, including non-executable application/ld+json - so
//     without the nonce the block is dropped. Callers pass the request nonce
//     (headers().get("x-nonce")) exactly like the app's other inline scripts.
//
// Data must be provenance-honest: callers only ever pass fields the underlying
// dataset actually carries - nothing invented (PRD non-negotiable).

export type JsonLdGraph = Record<string, unknown> | Record<string, unknown>[];

/** JSON.stringify hardened for inlining inside an HTML <script> element. */
export function serializeJsonLd(data: JsonLdGraph): string {
  return serializeInlineScriptJson(data);
}

export default function JsonLd({
  data,
  nonce,
}: {
  data: JsonLdGraph;
  /** Per-request CSP nonce (headers().get("x-nonce")); required under the nonce CSP. */
  nonce?: string;
}): ReactElement {
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
