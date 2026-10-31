// Read Question One's venue directory as JSON: the one reader the What's-On
// cron (lib/whatsOnRefresh.server.ts) and the bundled-pack CLI
// (scripts/whatson/quizRefresh.mjs) share.
//
// The HTML archive cards lack postcodes, so they cannot support a pub match
// without separate venue-page reads. The directory JSON includes location
// evidence alongside each venue's quiz slots, avoiding those extra requests.
//
// THE TABLE OWNS THE URL. The walk starts at the source-policy row's url and
// sets pagination and field selection, so no reader types a host. Every request goes
// through the caller's permitted fetch (scripts/lib/permittedHarvestFetch.mjs),
// which asks the fence and robots.txt first.
//
// A WALK THAT DID NOT REACH THE LAST PAGE THROWS. The cron replaces the whole
// quiz kind with what one run read, so a part read would remove every quiz on
// the pages it did not reach. A throw keeps the stored rows instead.

// A plain-node CLI imports this module, so the specifiers are RELATIVE and
// carry their extensions.
import { parseQuestionOneVenuesApi } from "./quizParsers.mjs";

/** The lib/harvest/sourceRegistry.ts row both readers ask for. */
export const QUESTION_ONE_SOURCE_ID = "questionone-quiz-venues";

/** WordPress caps `per_page` at 100. */
const PAGE_SIZE = 100;

/** 500 venues. The directory held 128 on 28 Oct 2026. */
export const QUESTION_ONE_MAX_PAGES = 5;

/** The facts a row is built from. Phone, description and images are never asked for. */
const FIELDS = "link,title,acf.dates,acf.price,acf.location";

/** Page `page` of the directory, on the row's own url. */
export function questionOneDirectoryPageUrl(sourceUrl, page) {
  const url = new URL(sourceUrl);
  url.searchParams.set("per_page", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("_fields", FIELDS);
  return url.href;
}

function statedTotalPages(response) {
  const total = Number.parseInt(response.headers.get("x-wp-totalpages") ?? "", 10);
  return Number.isInteger(total) && total >= 1 ? total : null;
}

/**
 * Every page of the directory, parsed. Throws on a non-2xx page, on a body
 * that is not a JSON array, and on a directory longer than
 * QUESTION_ONE_MAX_PAGES, so a part read never replaces a full one.
 */
export async function readQuestionOneDirectory({
  sourceUrl,
  permittedFetch,
  init = () => ({}),
  sleep = async () => {},
  delayMs = 0,
}) {
  const cards = [];
  const detailsByUrl = new Map();
  let totalPages = null;

  for (let page = 1; ; page += 1) {
    if (page > QUESTION_ONE_MAX_PAGES) {
      throw new Error(
        `Question One directory has more than ${QUESTION_ONE_MAX_PAGES} pages of ${PAGE_SIZE}; nothing was replaced`,
      );
    }
    if (page > 1 && delayMs > 0) await sleep(delayMs);
    const url = questionOneDirectoryPageUrl(sourceUrl, page);
    const response = await permittedFetch(url, init());
    if (!response.ok) throw new Error(`Question One directory page ${page} returned ${response.status}`);
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body)) throw new Error(`Question One directory page ${page} is not a JSON list`);

    const parsed = parseQuestionOneVenuesApi(body);
    cards.push(...parsed.cards);
    for (const [key, detail] of parsed.detailsByUrl) detailsByUrl.set(key, detail);

    totalPages ??= statedTotalPages(response);
    const lastPage = totalPages !== null ? page >= totalPages : body.length < PAGE_SIZE;
    if (lastPage) return { cards, detailsByUrl, pages: page };
  }
}
