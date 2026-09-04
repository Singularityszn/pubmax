// The ONE hardened serializer for JSON we inline inside an HTML <script>
// element. A leaf module by design: it imports NOTHING, so a browser bundle
// that needs an escaped inline literal never pulls React or the SEO components
// in behind it, and every emitter shares one definition of "HTML-unsafe".
//
// Why this exists. A <script> body is parsed by the HTML tokenizer BEFORE any
// JSON or JavaScript parser sees it, so a bare JSON.stringify is a script
// breakout waiting for its first dynamic field: one "</script>" inside a pub
// name, a caption or an error message closes the element and everything after
// it is markup. We JSON.stringify then escape "<", ">" and "&" to their \uXXXX
// forms - still valid JSON, still the same string at runtime, inert to the HTML
// tokenizer. U+2028 / U+2029 go the same way: legal in JSON, illegal raw in a
// JavaScript string literal, and some consumers choke on them.
//
// The escapes are valid in a JSON string AND in a JavaScript string literal, so
// this is the right tool for both a JSON-LD graph and a JS string literal built
// into an inline script body.

// Char-code to \uXXXX escape map. Keyed by code point so no literal
// U+2028/U+2029 separator ever appears in this source file.
const HTML_UNSAFE = new Map<number, string>([
  [0x3c, "\\u003c"], // <
  [0x3e, "\\u003e"], // >
  [0x26, "\\u0026"], // &
  [0x2028, "\\u2028"], // line separator
  [0x2029, "\\u2029"], // paragraph separator
]);

// Matches every HTML-unsafe code point above without embedding a literal
// U+2028/U+2029 in this source file (built from escapes via new RegExp).
const HTML_UNSAFE_RE = new RegExp("[<>&\\u2028\\u2029]", "g");

/** Escape an already-serialized JSON string for inlining inside a <script>. */
export function escapeInlineScriptJson(json: string): string {
  return json.replace(
    HTML_UNSAFE_RE,
    (char) => HTML_UNSAFE.get(char.charCodeAt(0)) ?? char,
  );
}

/**
 * JSON.stringify hardened for inlining inside an HTML <script> element.
 *
 * A value JSON.stringify cannot represent (undefined, a function, a symbol)
 * serializes to "null" rather than the literal text "undefined", which would be
 * neither valid JSON nor a valid JavaScript expression in the emitted block.
 */
export function serializeInlineScriptJson(data: unknown): string {
  const json = JSON.stringify(data);
  return typeof json === "string" ? escapeInlineScriptJson(json) : "null";
}
