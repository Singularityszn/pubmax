// The "Ask for a table" handoff's pure leaves (launch plan 1 Nov 2026, section
// 7 item 3): reading a crew size out of a Pal question, and consuming the
// `/map?sel=<id>&table=<n>` deep link Pal's answer cards build
// (lib/venueMapUrl.ts). A crew is 6 to 20, the same doors the form and the
// route share (lib/tableRequests.ts). Nothing here opens anything: the venue
// sheet's action card decides, behind its sign-in gate.

import type { Route } from "next";
import { parseCityId } from "@/lib/cities";
import { parseTableRequestPartySize } from "@/lib/tableRequests";

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
];

const COUNT_TOKEN = `(?:\\d+(?:[.:]\\d+)?|${NUMBER_WORDS.join("|")}|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)`;
const COUNT_EXPRESSION = `${COUNT_TOKEN}(?:(?:\\s*[-–\\u2014/]\\s*|\\s+(?:(?:to|or|and)\\s+)?)${COUNT_TOKEN})*`;

/**
 * The one crew size a table ask names, or null. Questions without table intent
 * or a crew size produce no handoff. Conflicting or unsupported crew sizes also
 * produce no handoff, because a guessed size could send a wrong request in the
 * reader's name.
 */
export function tableRequestPartySizeInText(text: string): number | null {
  if (!/\b(?:table|book(?:ing)?|reserv(?:e|ation))\b/i.test(text)) return null;
  const sizes = new Set<number | null>();
  // A number followed by a time tail ("for 20:00", "for 8 pm") is a time,
  // never a crew.
  for (const match of text.matchAll(new RegExp(
    `\\b(?:for|party of|group of)\\s+(${COUNT_EXPRESSION})\\b|\\b(${COUNT_EXPRESSION})\\s+(?:of us|people|mates)\\b`,
    "gi",
  ))) {
    const tail = text.slice(match.index + match[0].length);
    if (/^\s*(?::|\.\s*\d|[ap]\.?m\b|o['’]clock\b)/i.test(tail)) continue;
    if (/^\s*(?:[+–—/\-]|(?:to|or)\b)/i.test(tail)) {
      sizes.add(null);
      continue;
    }
    const raw = (match[1] ?? match[2]!).toLowerCase();
    if (/[.:]/.test(raw)) continue;
    const number = /^\d/.test(raw) ? Number(raw) : NUMBER_WORDS.indexOf(raw);
    sizes.add(parseTableRequestPartySize(number));
  }
  return sizes.size === 1 ? [...sizes][0]! : null;
}

/**
 * Read `?sel=<venueId>&table=<n>` once, for the sheet of the venue it names.
 * The answer carries the search string with `table` removed, so the caller can
 * put the consumed address back. An invalid size or a venue that takes no
 * table requests still consumes the parameter (partySize null): the map
 * selects the pub and nothing opens. Returns null when the link is not for
 * this venue, so the handoff survives until its own sheet reads it.
 */
export function consumeTableRequestIntent(
  search: string,
  venueId: string,
  isPub: boolean,
): { partySize: number | null; search: string } | null {
  const params = new URLSearchParams(search);
  if (!params.has("table") || params.get("sel") !== venueId) return null;
  const raw = params.get("table") ?? "";
  const partySize = isPub && /^\d+$/.test(raw) ? parseTableRequestPartySize(raw) : null;
  params.delete("table");
  return { partySize, search: params.toString() };
}

export function safeTableRequestReturnTo(raw: string | null | undefined): Route | null {
  const address = /^(\/map(?:\/([a-z]+))?)\?([^#\\]*)$/.exec(raw ?? "");
  if (!address || (address[2] && !parseCityId(address[2]))) return null;
  const params = new URLSearchParams(address[3]);
  const venueId = params.get("sel");
  if (!venueId || !/^[\w:-]{1,200}$/.test(venueId)) return null;
  if ([...params.keys()].length !== 2 || !params.has("table")) return null;
  const intent = consumeTableRequestIntent(params.toString(), venueId, true);
  return intent?.partySize ? (`${address[1]}?${params.toString()}` as Route) : null;
}
