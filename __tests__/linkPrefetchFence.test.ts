import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// A LINK TO A HEAVY ROUTE IS NOT PREFETCHED ON SIGHT
//
// Next prefetches every <Link> that enters the viewport. For a link to a
// STATIC destination that is a head start. For a link to one of this site's
// heavy dynamic routes it is a queue in front of the answer the reader is
// waiting for, and each deep link is keyed by its own query string, so nothing
// dedupes. components/nav/IntentLink.tsx states the shape in its own header: a
// Tonight arrival fired twenty `/plan?occasion=…` prefetches, each a real
// server render. #1598 measured the same thing on /pubs, where four prefetches
// pulled seven chunks and 159 KB of planning intent, coverage, contribution
// gate and price-badge code onto a page that draws none of them, and that -
// rather than the bundle - was what held the route over its own budget.
//
// /borough/westminster renders 206 such links on one 33,441px page.
//
// THE RULE. A <Link> whose href points at /map, /near, /plan, /pal or /social
// carries prefetch={false}. The alternative is IntentLink, which turns the
// automatic prefetch off and warms the ONE destination a pointer or a focus
// says is next; this fence never sees an IntentLink, because it reads the tag.
//
// This is a SOURCE fence rather than a browser measurement for the reason
// __tests__/coreUiAudit.test.ts is: the defect is invisible on screen, costs
// nothing to state in the source, and a new surface lands outside any list of
// inspected files.
//
// PENDING_GUARD is the documented backlog, in the shape
// __tests__/templatePatterns.test.ts already uses: every row names a file that
// still carries an unguarded heavy link. The list may only SHRINK - a row whose
// file is now clean fails too, so nobody leaves a door propped open by
// accident, and a file outside the list may never grow one.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const SCOPES = ["app", "components"] as const;

/**
 * The routes whose prefetch costs a real server render.
 *
 * Each is matched at a path-segment boundary, so `/plan` covers `/plan`,
 * `/plan?occasion=x` and `/plan/123` while `/planner` would be a different
 * route and is not this rule's business.
 */
const HEAVY_ROUTE_PREFIXES = ["/map", "/near", "/plan", "/pal", "/social"] as const;

/**
 * Helpers that BUILD one of those hrefs. A call to one of these is a heavy link
 * however the destination is spelled at the call site, which is the whole point:
 * `venueMapUrl(pub.id)` is `/map?sel=<id>`, a distinct RSC payload per pub.
 */
const HEAVY_HREF_HELPERS: ReadonlySet<string> = new Set([
  "boroughBrowseMapUrl",
  "boroughCoverageMapHref",
  "boroughMapUrl",
  "buildCrawlMapHref",
  "cityAwareMapPath",
  "curatedCrawlMapHref",
  "mapHrefForCity",
  "nightAreaMapHref",
  "pintDropDoorHref",
  "placeStoryMapHref",
  "preferredCityMapHref",
  "venueMapUrl",
]);

/**
 * A value NAMED as a map link is one. `row.mapHref`, `item.venueMapUrl` and
 * `pair.mapHref` are all `/map?sel=…` built one layer up, and reading the name
 * is the only way to see that from here.
 */
const HEAVY_NAME = /(?:^|[a-z])(?:maphref|mapurl)$/;

/**
 * The backlog, and it may only SHRINK.
 *
 * The rule was cut over the surfaces the finding measured: the crawlable
 * landings, where the count multiplies with the dataset (/borough/{slug} is 206
 * of them on a 33,441px page) and where a stranger arrives from a search result
 * with nothing warm. Each file below still owes the guard. Several of them do
 * carry a per-row link - a feed card, a saved list, the /today pints card - but
 * over a short list inside the product rather than over a whole borough, so the
 * cost is single figures rather than a page-long queue. Taking them is a
 * mechanical follow-up; it is not this lane's measurement, and it is the reason
 * the list exists rather than the reason the rule waits.
 *
 * Removing a row is the whole of the work: add prefetch={false} at each site the
 * failure names, then delete the line. Adding one is not, and a file that is
 * clean again fails here until its row goes.
 */
const PENDING_GUARD: ReadonlyArray<{ file: string }> = [
  { file: "app/activity/ActivityClient.tsx" },
  { file: "app/admin/AdminClient.tsx" },
  { file: "app/admin/AdminTokenForm.tsx" },
  { file: "app/crawls/[slug]/CrawlStoryPoster.tsx" },
  { file: "app/crawls/[slug]/not-found.tsx" },
  { file: "app/crawls/[slug]/page.tsx" },
  { file: "app/crawls/CrawlsPageClient.tsx" },
  { file: "app/discover/DiscoverPageClient.tsx" },
  { file: "app/feed/FeedPageClient.tsx" },
  { file: "app/messages/MessagesInboxClient.tsx" },
  { file: "app/not-found.tsx" },
  { file: "app/p/[id]/page.tsx" },
  { file: "app/plan/[id]/not-found.tsx" },
  { file: "app/plan/[id]/page.tsx" },
  { file: "app/recap/[storyId]/page.tsx" },
  { file: "app/rounds/[code]/RoundPageClient.tsx" },
  { file: "app/rounds/page.tsx" },
  { file: "app/social/crews/[crewId]/CrewDetailClient.tsx" },
  { file: "app/social/SocialPageClient.tsx" },
  { file: "app/today/TodayGetThereStrip.tsx" },
  { file: "app/today/TodayPintsCard.tsx" },
  { file: "app/today/TodayQuietPintCard.tsx" },
  { file: "app/tonight/TonightListingsNotice.tsx" },
  { file: "app/u/[handle]/ProfilePageClient.tsx" },
  { file: "app/we-are-out/WeAreOutClient.tsx" },
  { file: "components/auth/LoginPage.tsx" },
  { file: "components/contributors/ContributorRecord.tsx" },
  { file: "components/feed/FeedCard.tsx" },
  { file: "components/feed/FeedSightings.tsx" },
  { file: "components/feed/PresenceStrip.tsx" },
  { file: "components/map/inspector/VenueStoryTab.tsx" },
  { file: "components/map/route/CrawlProgressSection.tsx" },
  { file: "components/map/TonightLane.tsx" },
  { file: "components/messages/MessageVenueCard.tsx" },
  { file: "components/moment/MomentCapture.tsx" },
  { file: "components/night/MorningReentryCard.tsx" },
  { file: "components/night/NightModeCard.tsx" },
  { file: "components/pal/PalChat.tsx" },
  { file: "components/pal/PalExperience.tsx" },
  { file: "components/plan/CompletedPlanUsualLot.tsx" },
  { file: "components/plan/InviteMapLink.tsx" },
  { file: "components/plan/MapRouteTransferButton.tsx" },
  { file: "components/plan/PlanComposer.tsx" },
  { file: "components/plan/PlanIntake.tsx" },
  { file: "components/plan/PlanRoute.tsx" },
  { file: "components/plan/RecapDetail.tsx" },
  { file: "components/profile/FirstActionsRow.tsx" },
  { file: "components/profile/NightMemoryStudio.tsx" },
  { file: "components/profile/OutTonightBoard.tsx" },
  { file: "components/profile/PintPassport.tsx" },
  { file: "components/profile/SavedListDetail.tsx" },
  { file: "components/profile/SavedPubList.tsx" },
  { file: "components/PubMap.tsx" },
  { file: "components/pubpal/PubPalSummon.tsx" },
  { file: "components/pubpal/PubPalVoice.tsx" },
  { file: "components/social/ConfirmFollow.tsx" },
  { file: "components/social/CreatorListsLane.tsx" },
  { file: "components/social/PublicCrewRouteClient.tsx" },
];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx") && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
}

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const scope of SCOPES) walk(join(ROOT, scope), out);
  return out.sort();
}

/** The local name `next/link`'s default export was imported under, if at all. */
function nextLinkName(sf: ts.SourceFile): string | null {
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "next/link") continue;
    const name = statement.importClause?.name;
    if (name) return name.text;
  }
  return null;
}

function startsAtSegmentBoundary(value: string): boolean {
  return HEAVY_ROUTE_PREFIXES.some((prefix) => {
    if (!value.startsWith(prefix)) return false;
    const rest = value.slice(prefix.length);
    return rest === "" || rest.startsWith("/") || rest.startsWith("?") || rest.startsWith("#");
  });
}

/**
 * Whether an expression evaluates to a heavy href.
 *
 * `consts` carries the file's own `const x = …` bindings, because the two
 * discovery boards assign the href a line above the JSX and would otherwise
 * read as opaque.
 */
function isHeavyHref(node: ts.Node, consts: Map<string, ts.Expression>, seen: Set<string>): boolean {
  if (ts.isParenthesizedExpression(node)) return isHeavyHref(node.expression, consts, seen);
  if (ts.isJsxExpression(node)) return node.expression ? isHeavyHref(node.expression, consts, seen) : false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return startsAtSegmentBoundary(node.text);
  }
  if (ts.isTemplateExpression(node)) {
    // `${venueMapUrl(id)}&log=1` has an EMPTY head, so the destination is the
    // first substitution rather than the literal text before it.
    if (node.head.text === "") {
      const first = node.templateSpans[0];
      return first ? isHeavyHref(first.expression, consts, seen) : false;
    }
    return startsAtSegmentBoundary(node.head.text);
  }
  if (ts.isCallExpression(node)) {
    const callee = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : ts.isIdentifier(node.expression)
        ? node.expression.text
        : "";
    if (HEAVY_HREF_HELPERS.has(callee)) return true;
    return node.arguments.some((arg) => isHeavyHref(arg, consts, seen));
  }
  if (ts.isConditionalExpression(node)) {
    return isHeavyHref(node.whenTrue, consts, seen) || isHeavyHref(node.whenFalse, consts, seen);
  }
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    if (kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken) {
      return isHeavyHref(node.left, consts, seen) || isHeavyHref(node.right, consts, seen);
    }
    return false;
  }
  if (ts.isPropertyAccessExpression(node)) return HEAVY_NAME.test(node.name.text.toLowerCase());
  if (ts.isIdentifier(node)) {
    if (HEAVY_NAME.test(node.text.toLowerCase())) return true;
    if (seen.has(node.text)) return false;
    const bound = consts.get(node.text);
    if (!bound) return false;
    seen.add(node.text);
    return isHeavyHref(bound, consts, seen);
  }
  return false;
}

/** Every `const name = <expression>` in the file, by name. */
function constBindings(sf: ts.SourceFile): Map<string, ts.Expression> {
  const consts = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      consts.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return consts;
}

/** A `prefetch={false}` attribute, the whole of the guard. */
function prefetchIsOff(element: ts.JsxOpeningLikeElement): boolean {
  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText() !== "prefetch") continue;
    const value = attribute.initializer;
    if (value && ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.FalseKeyword) {
      return true;
    }
  }
  return false;
}

type Finding = { file: string; line: number; href: string };

function collectFindings(): Finding[] {
  const findings: Finding[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("next/link")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const linkName = nextLinkName(sf);
    if (!linkName) continue;
    const consts = constBindings(sf);
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (node.tagName.getText(sf) === linkName && !prefetchIsOff(node)) {
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute)) continue;
            if (attribute.name.getText() !== "href") continue;
            const value = attribute.initializer;
            if (value && isHeavyHref(value, consts, new Set())) {
              findings.push({
                file: relative(ROOT, file),
                line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                href: value.getText(sf).replace(/\s+/g, " ").slice(0, 80),
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

describe("a heavy-route Link is never prefetched on sight", () => {
  const findings = collectFindings();
  const pending = new Set(PENDING_GUARD.map((row) => row.file));

  it("finds no unguarded heavy link outside the documented backlog", () => {
    const offences = findings
      .filter((finding) => !pending.has(finding.file))
      .map((finding) => `${finding.file}:${finding.line} href=${finding.href}`);
    expect(
      offences,
      "add prefetch={false}, or use components/nav/IntentLink.tsx to warm on intent",
    ).toEqual([]);
  });

  it("keeps the backlog honest: every pending file still carries one", () => {
    const live = new Set(findings.map((finding) => finding.file));
    const stale = PENDING_GUARD.filter((row) => !live.has(row.file)).map((row) => row.file);
    expect(stale, "delete these rows: the file is clean").toEqual([]);
  });

  it("reads the guarded surfaces as guarded", () => {
    const guarded = new Set(findings.map((finding) => finding.file));
    for (const file of [
      "components/landing/LandingHero.tsx",
      "components/pubs/PubsGallery.tsx",
      "app/borough/[slug]/page.tsx",
    ]) {
      expect(guarded.has(file), `${file} carries an unguarded heavy link`).toBe(false);
    }
  });
});
