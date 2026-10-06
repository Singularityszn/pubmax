import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMPTY_CHAIN_DENYLIST,
  FLASH_LITE_SKU,
  JOB_SPEND_CAP_USD,
  SITE_STAMP,
  amenityColumnIsBlank,
  cachedPageRead,
  evidenceQuoteIsOnPage,
  firecrawlMayReread,
  isChainPage,
  keepEvidencedAmenities,
  liftSiteStamps,
  locatedOwnSite,
  matchPubToVenue,
  mergeChainDenylists,
  mergeHarvestEvidence,
  pageOwners,
  pageReadEntry,
  pageStatesAddress,
  pageStatesPostcode,
  pageStatesStreet,
  parseChainDenylist,
  parsePubAmenityModelJson,
  postcodeOf,
  projectPubAmenitySpend,
  provenChainEvidence,
  pubSpecificEvidence,
  readExtraPage,
  siteOfAnotherPub,
  stampAmenityColumns,
  statedAmenities,
  streetOf,
  withoutThinnerRereads,
  type HarvestRead,
} from "@/lib/harvest/pubWebsiteAmenities";

const PAGE = [
  "The Crown serves food every day from noon.",
  "Our beer garden opens when the weather does.",
  "Sunday pub quiz starts at eight.",
  "Cocktails are listed on the board behind the bar.",
].join(" ");

function expectSportsPublication(quote: string, expected: boolean) {
  const parsed = parsePubAmenityModelJson(JSON.stringify({
    amenities: { liveSports: { value: true, evidence: quote } },
  }));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;

  const kept = keepEvidencedAmenities(parsed.amenities, quote);
  const published = pubSpecificEvidence([
    { osmId: "synthetic-pub", sourceUrl: "https://synthetic-pub.example/sport", amenities: kept },
  ]);
  const stamped = stampAmenityColumns(
    { live_sports: "", price_gbp: 5.75, price_observed_at: "2026-09-20" },
    published[0]?.amenities ?? {},
  );

  expect(kept).toEqual(expected ? { liveSports: quote } : {});
  expect(published).toEqual(expected ? [
    { osmId: "synthetic-pub", sourceUrl: "https://synthetic-pub.example/sport", amenities: { liveSports: quote } },
  ] : []);
  expect(stamped).toEqual({
    row: {
      live_sports: expected ? SITE_STAMP : "",
      price_gbp: 5.75,
      price_observed_at: "2026-09-20",
    },
    stamped: expected ? ["liveSports"] : [],
  });
}

describe("sports evidence publication", () => {
  it("refuses ambiguous provider screens in a location after a comma denial", () => {
    expectSportsPublication("We don't have Sky Sports, TNT Sports screens in the bar.", false);
  });

  // Conservative policy reverses these two historical positives: shows plus a
  // location can name denied shows, so it does not establish an independent claim.
  it.each([
    "We don't show rugby, football shows on all our TVs.",
    "We don't have Sky Sports, TNT Sports shows on every screen.",
  ])("leaves historically inferred location-only shows unconfirmed: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  // Conservative policy also reverses these historical positives: a dual-use
  // viewing word after a comma-attached sports denial is no independent claim.
  it.each([
    "We don't have Sky Sports, TNT Sports shows every match.",
    "We don't have Sky Sports, BT Sport shows all the Champions League games.",
    "We don't have Sky Sports, TNT Sports and BT Sport show every match.",
    "We don't have Sky Sports, TNT Sports or BT Sport shows every match.",
    "We don't have Sky Sports, TNT Sports shows every game.",
    "We don't have Sky Sports, BT Sport shows all the action on our big screens.",
    "Without Sky Sports, TNT Sports shows every match.",
    "No Sky Sports, TNT Sports shows every match.",
    "We don't have Sky Sports, TNT Sports or BT Sport, football shows every match.",
    "No Sky Sports or TNT Sports, football broadcasts every game.",
    "We don't show rugby, cricket screens every match on our TVs.",
    "We don't show rugby, cricket broadcasts every match in the bar.",
  ])("leaves historically inferred comma-only dual-use claims unconfirmed: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "We don't show rugby, cricket broadcasts on TV.",
    "We do not show rugby, football shows in the bar.",
    "We don't show rugby, cricket screens on our TVs.",
    "We don't show rugby, live GAA broadcasts in the bar.",
    "We don't have Sky Sports, BT Sport screens on our TVs.",
    "We don't have Sky Sports, BT Sport broadcasts in the bar.",
    "We don't show rugby, Formula1 shows on our screens.",
  ])("leaves dual-use viewing nouns with only a location under the comma denial: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  // Shows, screens and broadcasts are also nouns. After a comma-attached sports
  // denial a remainder whose only verb is one of them stays unconfirmed, which is
  // not a claim that the venue lacks sport.
  it.each([
    "We don't have Sky Sports, TNT Sports screens at the bar.",
    "We don't have Sky Sports, TNT Sports screens throughout the pub.",
    "We don't show rugby, cricket broadcasts across all our TVs.",
    "We don't have Sky Sports, TNT Sports broadcasts from the bar.",
    "We don't show cricket, football broadcasts at the weekend.",
    "We don't have Sky Sports, TNT Sports screen in the bar.",
    "We don't show rugby, football show during the match.",
    "We don't have Sky Sports, TNT Sports screens around the bar.",
    "We don't have Sky Sports, TNT Sports screens near the bar.",
    "We don't have Sky Sports, TNT Sports screens by the bar.",
    "We don't have Sky Sports, TNT Sports screens behind the bar.",
    "We don't have Sky Sports, TNT Sports screens upstairs.",
    "We don't have Sky Sports, TNT Sports screens inside the pub.",
    "We don't have Sky Sports, TNT Sports screens over the bar.",
    "We don't have Sky Sports, TNT Sports screens above the bar.",
    "We don't have Sky Sports, TNT Sports screens anywhere.",
    "We don't have Sky Sports, TNT Sports screens with sound.",
    "We don't have Sky Sports, TNT Sports screens for the big games.",
    "We don't show rugby, cricket broadcasts tonight.",
    "We don't show rugby, cricket broadcasts before kick-off.",
    "We don't show rugby, cricket broadcasts after work.",
    "We don't show rugby, cricket broadcasts all season.",
    "We don't show rugby, cricket broadcasts over the weekend.",
    "We don't have Sky Sports, TNT Sports screens live in the bar.",
    "We don't show rugby, cricket broadcasts all the time.",
    "We don't show rugby, cricket broadcasts the whole weekend.",
    "We do not show rugby, cricket broadcasts all the time.",
    "We do not show rugby, cricket broadcasts the whole weekend.",
    "We don't have Sky Sports, TNT Sports screens before the games.",
    "We don't show rugby, cricket broadcasts during the big matches.",
    "We don't have Sky Sports, TNT Sports screens that football fans love.",
    "We don't have Sky Sports, TNT Sports screens this weekend.",
    "We don't have Sky Sports, TNT Sports screens their bar.",
    "We don't have Sky Sports, TNT Sports screens around the sports bar.",
    "We don't have Sky Sports, TNT Sports screens over the match.",
    "We don't have Sky Sports, TNT Sports screens since the match.",
    "We don't have Sky Sports, TNT Sports screens outside the match.",
    "We don't have Sky Sports, TNT Sports screens like the big sports bars.",
    "We don't show rugby, cricket broadcasts against the World Cup.",
    "We don't show rugby, cricket broadcasts beyond the match.",
    "We don't show rugby, cricket broadcasts under the sports bar.",
    "We don't show rugby, cricket broadcasts so sports fans go elsewhere.",
    "We don't show rugby, cricket broadcasts because sports fans go elsewhere.",
    "We don't show rugby, cricket broadcasts when sports fans visit.",
    "We don't have Sky Sports, TNT Sports screens unless the match is huge.",
    "We don't have Sky Sports, TNT Sports screens that show football.",
    "We don't have Sky Sports, TNT Sports screens which show football.",
    "We don't have Sky Sports, TNT Sports screens showing football.",
    "No Sky Sports, TNT Sports screens that show football.",
    "No Sky Sports, TNT Sports screens around the sports bar.",
    "Without Sky Sports, TNT Sports screens over the match, we focus on food.",
    "We don't show rugby, cricket broadcasts this World Cup.",
    "We don't have Sky Sports, TNT Sports screens this football season.",
    "We don't have Sky Sports, TNT Sports screens two match days a week.",
    "No Sky Sports, TNT Sports screens this football season.",
  ])("leaves dual-use viewing nouns before a location, time, clause or modifier unconfirmed: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  // Precision tradeoff: these read naturally as direct objects of a viewing verb,
  // but the same words also form noun phrases ("screens this football season"), so
  // a comma-only remainder is not independent evidence. Earlier review rounds
  // asserted them as positives; they are deliberately unconfirmed. A passive,
  // modal, contrast or separate clause still publishes, as paired below.
  it.each([
    "We don't have Sky Sports, TNT Sports screens football at the bar.",
    "We don't have Sky Sports, TNT Sports screens every match throughout the pub.",
    "We don't show rugby, cricket broadcasts every match across all our TVs.",
    "We don't have Sky Sports, TNT Sports broadcasts football from the bar.",
    "We don't show cricket, football broadcasts every game at the weekend.",
    "We don't have Sky Sports, TNT Sports screen football in the bar.",
    "We don't show rugby, football show every game during the season.",
    "We don't have Sky Sports, TNT Sports screens every match around the bar.",
    "We don't have Sky Sports, TNT Sports screens football upstairs.",
    "We don't have Sky Sports, TNT Sports screens the big games with sound.",
    "We don't have Sky Sports, TNT Sports screens our matches behind the bar.",
    "We don't show rugby, cricket broadcasts each game tonight.",
    "We don't show rugby, cricket broadcasts all the matches over the weekend.",
    "We don't show rugby, cricket broadcasts live matches before kick-off.",
    "We don't show rugby, football show every game all season.",
    "We don't have Sky Sports, TNT Sports shows all matches.",
    "We don't have Sky Sports, TNT Sports shows a match every week.",
    "We don't have Sky Sports, TNT Sports shows big games.",
    "We don't have Sky Sports, TNT Sports shows most games.",
    "We don't have Sky Sports, TNT Sports shows Six Nations.",
    "We don't have Sky Sports, TNT Sports shows Champions League games.",
    "We don't have Sky Sports, TNT Sports shows fixtures.",
    "We don't have Sky Sports, TNT Sports shows them.",
    "We don't have Sky Sports, TNT Sports broadcasts Wimbledon.",
    "We don't show rugby, football shows any match.",
    "We don't show rugby, cricket broadcasts international matches.",
    "No Sky Sports, TNT Sports shows all matches.",
    "We don't have Sky Sports, TNT Sports screens live football in the bar.",
    "We don't show rugby, cricket broadcasts every match all the time.",
    "We don't show rugby, cricket broadcasts every match the whole weekend.",
    "We do not show rugby, cricket broadcasts every match all the time.",
    "We do not show rugby, cricket broadcasts every match the whole weekend.",
    "We don't have Sky Sports, TNT Sports shows each of the matches.",
    "We don't have Sky Sports, TNT Sports shows every one of the matches.",
    "We don't have Sky Sports, TNT Sports shows all the big live games.",
    "We don't have Sky Sports, TNT Sports shows all of the matches.",
    "We don't have Sky Sports, TNT Sports shows most of the games.",
    "We don't have Sky Sports, TNT Sports shows some of the football.",
    "No Sky Sports, TNT Sports shows all of the big matches.",
    "We don't have Sky Sports, TNT Sports shows these matches.",
    "We don't have Sky Sports, TNT Sports shows those games.",
    "We don't have Sky Sports, TNT Sports shows their matches.",
    "We don't have Sky Sports, TNT Sports shows both matches.",
    "We don't have Sky Sports, TNT Sports shows this match.",
    "We don't have Sky Sports, TNT Sports shows many games.",
    "We don't have Sky Sports, TNT Sports shows more football.",
    "We don't have Sky Sports, TNT Sports shows two matches a day.",
    "We don't have Sky Sports, TNT Sports shows 3 matches a day.",
    "We don't have Sky Sports, TNT Sports shows today's match.",
    "No Sky Sports, TNT Sports shows these matches.",
    "We don't have Sky Sports, TNT Sports shows a few of their games.",
    "We don't have Sky Sports, TNT Sports shows that match.",
    "We don't have Sky Sports, TNT Sports shows the whole match.",
    "We don't have Sky Sports, TNT Sports shows every single match.",
    "We don't have Sky Sports, TNT Sports shows the biggest matches.",
    "We don't have Sky Sports, TNT Sports shows all the major matches.",
    "We don't have Sky Sports, TNT Sports shows European football.",
    "We don't have Sky Sports, TNT Sports shows today's big match.",
    "We don't have Sky Sports, TNT Sports shows exciting matches.",
  ])("leaves comma-only dual-use direct-object claims unconfirmed by policy: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "We don't have Sky Sports, TNT Sports is screened at the bar.",
    "We don't have Sky Sports, TNT Sports is shown throughout the pub.",
    "We don't show rugby, cricket is broadcast across all our TVs.",
    "We don't have Sky Sports, TNT Sports is broadcast from the bar.",
    "We don't show cricket, football is broadcast at the weekend.",
    "We don't have Sky Sports, TNT Sports are screened in the bar.",
    "We don't show rugby, football is shown during the season.",
    "We don't have Sky Sports, TNT Sports is screened around the bar.",
    "We don't have Sky Sports, TNT Sports is shown upstairs.",
    "We don't have Sky Sports, TNT Sports is screened with sound.",
    "We don't have Sky Sports, TNT Sports is broadcast behind the bar.",
    "We don't show rugby, cricket is broadcast tonight.",
    "We don't show rugby, cricket is broadcast over the weekend.",
    "We don't show rugby, cricket is broadcast before kick-off.",
    "We don't show rugby, football is shown all season.",
    "We don't have Sky Sports, TNT Sports will show every match.",
    "We don't have Sky Sports, but TNT Sports shows every match.",
    "No Sky Sports, but TNT Sports shows every match.",
    "We don't show rugby, but cricket screens every match on our TVs.",
    "We don't have Sky Sports and we show TNT Sports.",
    "We don't have pool tables, TNT Sports shows every match.",
    "TNT Sports shows every match.",
    "Cricket broadcasts every match in the bar.",
  ])("retains clear passive, modal, contrast, standalone and unrelated-denial positives: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each([
    "We don't have Sky Sports, TNT Sports is shown in the bar.",
    "We don't show rugby, cricket is broadcast on our TVs.",
    "We don't show rugby, football is shown on all our TVs.",
    "We don't have pool tables and we show football on our TVs.",
  ])("retains clear viewing predicates with prepositional locations beside denials: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each([
    "Live football, rugby and cricket are not shown.",
    "Sky Sports, TNT Sports and BT Sport are not available.",
    "We don't have Sky Sports, TNT Sports or BT Sport.",
    "Live GAA and rugby aren't shown.",
    "Live premier league and rugby are not shown here.",
    "Live gaelic and rugby aren't shown.",
    "Live sporting and rugby aren't shown.",
    "We don't show football, rugby and cricket on TV.",
    "Sky Sports, TNT Sports, and BT Sport are unavailable.",
    "We don't have Sky Sports, TNT Sports, or BT Sport.",
    "No Sky Sports, TNT Sports or BT Sport here.",
    "Sky Sports, TNT Sports are not available.",
    "We don't have Sky Sports, TNT Sports.",
    "We don't have Sky Sports, TNT Sports, BT Sport.",
    "No Sky Sports, TNT Sports, BT Sport here.",
    "No football, rugby or cricket screenings.",
    "No Sky Sports, TNT Sports or BT Sport screenings here.",
    "We don't show football, rugby or cricket broadcasts.",
    "We don't have Sky Sports, TNT Sports or BT Sport viewings.",
    "No football, rugby and cricket TVs.",
    "No Sky Sports, TNT Sports or BT Sport live sport here.",
    "Without Sky Sports, TNT Sports or BT Sport screenings, we focus on food.",
    "No Sky Sports, TNT Sports here.",
    "We don't have Sky Sports, TNT Sports at this pub.",
    "We don't have Sky Sports, TNT Sports on our screens.",
    "We don't show football, rugby on TV.",
    "No football, rugby on TV.",
    "No football, rugby or cricket shown here.",
    "No Sky Sports, TNT Sports or BT Sport shown here.",
    "We don't have Sky Sports, TNT Sports or BT Sport shown here.",
    "No football, rugby or cricket will be shown here.",
    "No football, rugby or cricket televised here.",
    "No football, rugby or cricket screened here.",
    "Without Sky Sports, TNT Sports or BT Sport shown, we focus on food.",
    "No Sky Sports, TNT Sports or BT Sport showing football here.",
    "No Sky Sports, TNT Sports or BT Sport showing the match.",
    "No football, rugby and cricket shown here.",
    "No Sky Sports, TNT Sports or BT Sport is available here.",
    "No football, rugby or cricket are shown here.",
    "We don't show football, rugby or cricket broadcasts here.",
    "We don't show football, rugby or cricket broadcasts on our screens.",
    "We don't have Sky Sports, TNT Sports or BT Sport screens in the bar.",
    "We don't show football, rugby or cricket shows here.",
    "We don't show rugby, cricket screens every Sunday.",
    "We don't show rugby, cricket broadcasts here.",
    "We don't show football, rugby and cricket screens every Sunday.",
    "No Sky Sports, TNT Sports, and BT Sport is available here.",
    "No Sky Sports, TNT Sports, BT Sport is available here.",
    "No Sky Sports, TNT Sports, BT Sport are available here.",
    "Without Sky Sports, TNT Sports, BT Sport is available here.",
    "No football, rugby, cricket are shown here.",
    "No Sky Sports, TNT Sports, BT Sport shows every match.",
    "No Sky Sports, TNT Sports, BT Sport will be shown here.",
    "We don't have Sky Sports, TNT Sports, BT Sport is available here.",
    "We don't have Sky Sports, TNT Sports, BT Sport shows every match.",
    "We don't show football, rugby, cricket is shown here.",
    "No Sky Sports, TNT Sports screens in the bar.",
    "Without Sky Sports, TNT Sports screens in the bar, we focus on food.",
    "No Sky Sports, TNT Sports broadcasts in the bar.",
    "No football, rugby broadcasts on our screens.",
    "No football, rugby shows on our TVs.",
    "No Sky Sports, TNT Sports will be shown.",
    "No Sky Sports, TNT Sports has it all.",
  ])("refuses shared denials over supported sport and provider lists: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "No Sky Sports, football on the big screen every weekend.",
    "We don't show cricket, live football every Saturday.",
    "We do not show cricket, live football every Saturday.",
    "We don't show rugby, football shown on all our TVs.",
    "We do not show rugby, football shown on all our TVs.",
    "We don't show rugby, football and cricket shown on all our TVs.",
    "We do not show rugby, football and cricket shown on all our TVs.",
  ])("conservatively refuses a denied comma list whose remainder has no finite predicate of its own: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "Sky Sports is unavailable, we show football on our TVs.",
    "We don't have Sky Sports, we have TNT Sports.",
    "We show football on our TVs, Sky Sports is unavailable.",
    "We have TNT Sports, we don't have Sky Sports.",
    "Football is not shown, rugby is broadcast on our TVs.",
    "We don't show football, rugby is broadcast on our TVs.",
    "We don't have Sky Sports, TNT Sports is available.",
    "We don't show football, rugby and cricket are broadcast on our TVs.",
    "We have Sky Sports, rugby is not available.",
    "We don't have Sky Sports, TNT Sports or BT Sport, we show football on our TVs.",
    "Live football, rugby and cricket are not shown, we have TNT Sports.",
    "We don't have Sky Sports, TNT Sports has every match on our screens.",
    "We don't show rugby, football will be shown on all our TVs.",
    "We don't show rugby, football and F1 will be shown on all our TVs.",
    "We don't have Sky Sports, TNT Sports has it all on our screens.",
    "Without Sky Sports, football is still shown on our TVs.",
    "No Sky Sports, football is shown on all our TVs via TNT.",
    "No Sky Sports, TNT Sports is available.",
    "We don't show rugby or cricket, football is shown on our TVs.",
    "We don't show rugby, cricket and F1, football is shown on our TVs.",
    "We don't have Sky Sports or TNT Sports, football is shown on our TVs.",
    "No rugby or cricket, football is shown on our TVs.",
    "Without Sky Sports, TNT Sports or BT Sport, football is shown on our TVs.",
  ])("retains independent affirmative clauses beside comma denials: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each(["GAA", "gaelic", "sporting", "premier league"])(
    "publishes supported live viewing vocabulary: %s", (sport) => {
      expectSportsPublication(`Live ${sport} here.`, true);
    },
  );

  it.each([
    "We don't have any Sky Sports.",
    "We do not have access to TNT Sports.",
    "We no longer have Sky Sports.",
    "Sky Sports is unavailable at this pub.",
    "Sky Sports is not available at this pub.",
    "We are not subscribed to TNT Sports.",
    "Sky Sports isn't available at this pub.",
    "Sky Sports and TNT Sports aren't available.",
    "We're not subscribed to TNT Sports.",
    "We aren't subscribed to TNT Sports.",
  ])("refuses consolidated provider availability denials: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each(["Sky Sports", "TNT Sports", "BT Sport"].flatMap((provider) => [
    `We don't have any ${provider}.`,
    `We do not have access to ${provider}.`,
    `We no longer have ${provider}.`,
    `${provider} is unavailable at this pub.`,
    `${provider} is not available at this pub.`,
    `We are not subscribed to ${provider}.`,
  ]))("refuses availability predicates across canonical providers: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "We don't have any Sky Sports and TNT Sports.",
    "We do not have access to TNT Sports or BT Sport.",
    "We no longer have Sky Sports and TNT Sports.",
    "We are not subscribed to Sky Sports or TNT Sports.",
    "Sky Sports and TNT Sports are unavailable at this pub.",
    "Sky Sports and TNT Sports are not available at this pub.",
    "Sky Sports or BT Sport is not available at this pub.",
    "Sky Sports and TNT Sports and BT Sport are not available.",
    "We don't have any Sky Sports and have TNT Sports.",
    "We no longer have Sky Sports and have TNT Sports.",
  ])("keeps consolidated availability denials over shared provider objects: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "We don't have any Sky Sports and we have TNT Sports.",
    "We have TNT Sports and we don't have any Sky Sports.",
    "We do not have access to Sky Sports and we have TNT Sports.",
    "We have TNT Sports and we do not have access to Sky Sports.",
    "We no longer have Sky Sports and we have TNT Sports.",
    "We have TNT Sports and we no longer have Sky Sports.",
    "Sky Sports is unavailable and we have TNT Sports.",
    "We have TNT Sports and Sky Sports is unavailable.",
    "Sky Sports is not available and we have TNT Sports.",
    "We have TNT Sports and Sky Sports is not available.",
    "We are not subscribed to TNT Sports but we show football on our TVs.",
    "We show football on our TVs and we are not subscribed to TNT Sports.",
    "Sky Sports and TNT Sports are not available and we have BT Sport.",
    "We have BT Sport and Sky Sports and TNT Sports are not available.",
    "We don't have any pool tables and we show football on our TVs.",
    "We do not have access to pool tables and we show football on our TVs.",
    "We no longer have pool tables and we show football on our TVs.",
    "Pool tables are unavailable and we show football on our TVs.",
    "Pool tables are not available and we show football on our TVs.",
  ])("retains independent positives beside consolidated availability denials: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each([
    "We don't have Sky Sports.",
    "We do not have TNT Sports.",
  ])("refuses explicit provider availability denials: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each(["Sky Sports", "TNT Sports", "BT Sport"].flatMap((provider) => [
    `We don't have ${provider}.`,
    `We don’t have ${provider}.`,
    `We do not have ${provider}.`,
    `We never have ${provider}.`,
  ]))("refuses provider availability denial variants: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "We don't have Sky Sports and TNT Sports.",
    "We don’t have Sky Sports or BT Sport.",
    "We do not have TNT Sports and BT Sport.",
    "We never have BT Sport or Sky Sports.",
    "We don't have Sky Sports and have TNT Sports.",
  ])("keeps availability denial over its provider objects: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "We don't have Sky Sports and we have TNT Sports.",
    "We have TNT Sports and don't have Sky Sports.",
    "We don’t have TNT Sports and we have BT Sport.",
    "We have Sky Sports and do not have BT Sport.",
    "We never have Sky Sports but we have TNT Sports.",
    "We don't have pool tables and we show football on our TVs.",
    "We don't have pool tables and show football on our TVs.",
    "We don't have pool tables and we have Sky Sports.",
    "We have Sky Sports.",
    "We have TNT Sports.",
    "We have BT Sport.",
  ])("retains independent sports grounding beside availability denials: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each([
    "Watch F1 live on our screens.",
    "F1 is broadcast on our TVs.",
  ])("publishes explicit F1 viewing evidence: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each(["Formula1", "Formula 1"].flatMap((sport) => [
    `Watch ${sport} live on our screens.`,
    `${sport} is broadcast on our TVs.`,
  ]))("publishes explicit Formula viewing evidence: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each(["F1", "Formula1", "Formula 1"].flatMap((sport) => [
    `We show ${sport} on our screens.`,
    `We are watching ${sport} on our TVs.`,
    `Our screens are used to show ${sport}.`,
  ]))("retains ordinary Formula viewing propositions: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each(["F1", "Formula1", "Formula 1"].flatMap((sport) => [
    `No ${sport} here.`,
    `We do not watch ${sport} on our screens.`,
    `We don't broadcast ${sport} on our TVs.`,
    `${sport} is not shown on our TVs.`,
    `${sport} isn't broadcast on our screens.`,
    `We have no TVs for watching ${sport}.`,
    `We don't show ${sport} and rugby on TV.`,
    `${sport} and rugby aren't shown on our screens.`,
    `${sport} event this Sunday.`,
    `${sport} Grand Prix race night.`,
    `${sport} is on our menu and we show Alien vs Predator live.`,
  ]))("refuses denied or unsupported Formula viewing evidence: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "Watch F10 live on our screens.",
    "Watch Formula10 live on our screens.",
    "Watch Formula 10 live on our screens.",
  ])("requires a complete Formula sporting identity: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it("publishes an explicit live team fixture as viewing evidence", () => {
    expectSportsPublication("Watch Liverpool vs Man City live", true);
    expectSportsPublication("Watch Liverpool vs Man City football live", true);
  });

  it("leaves a fixture without an invitation to watch it live unconfirmed", () => {
    expectSportsPublication("Liverpool vs Man City live", false);
    expectSportsPublication("Watch Liverpool vs Man City", false);
  });

  it.each([
    "No screens at this pub and football is shown at our sister venue",
    "No screens here, but football is shown at our sister venue",
    "No screens at this pub and our sister venue shows football",
    "We don't show football here, but our sister pub does show football on its TVs",
    "Football is shown at our other pubs.",
    "No screens at this pub and football is shown at another venue",
    "No screens here, but football is shown at another pub",
  ])("does not stamp this pub from a sister venue's sport: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "We don't show films and screen live football.",
    "We never show films and broadcast live rugby.",
  ])("scopes an unrelated media denial to its own clause: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each([
    "We don't show and screen football.",
    "We don't show films and screen films.",
  ])("keeps a denial over a coordinated bare verb: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "Football is shown here and at our sister venue.",
    "We show football at this pub and at our sister venue.",
  ])("keeps a sister venue beside this pub's own viewing: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it("does not borrow sport identity from a separate proposition or screen list", () => {
    expectSportsPublication("Football memorabilia. We have TVs and board games.", false);
  });

  it("refuses a television title whose only apparent sporting identity is game", () => {
    expectSportsPublication("Watch Game of Thrones on our TVs.", false);
  });

  it.each([
    "Watch The Hunger Games on our screens.",
    "We show games on our TVs.",
    "Watch board games live on our screens.",
    "Watch game day on our screens.",
    "Watch game-day live on our TVs.",
  ])("requires sporting identity beyond game wording: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "Watch football games on our TVs.",
    "We show rugby games on our screens.",
    "We broadcast cricket games live.",
    "Watch Premier League games on our screens.",
    "Watch game day live on Sky Sports.",
  ])("retains games with explicit sporting identity: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each([
    "We don't show Sky Sports.",
    "We don't show Manchester United games.",
    "Football isn't shown on our screens.",
    "We do not broadcast live football.",
    "Our screens are not used to show football.",
    "We do not watch Liverpool vs Man City live",
  ])("refuses a denied viewing statement throughout publication: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it("publishes a stated provider despite a coordinated denial of another provider", () => {
    expectSportsPublication("We have TNT Sports and no Sky Sports.", true);
  });

  it("retains a provider before an independent active viewing denial", () => {
    expectSportsPublication("We have TNT Sports and don't show Sky Sports.", true);
  });

  it("retains an independent active viewing statement after a provider denial", () => {
    expectSportsPublication("No Sky Sports and we show TNT Sports.", true);
  });

  it("retains an independent passive viewing statement after a sport denial", () => {
    expectSportsPublication("Football is not shown and rugby is broadcast on our TVs.", true);
  });

  it.each([
    "Football is on our menu and we show Alien vs Predator live.",
    "Football is on our menu and Alien vs Predator is shown on our TVs.",
    "Football memorabilia and we have TVs and board games.",
  ])("keeps sporting identity within the supported viewing proposition: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "We don't show Sky Sports and we show TNT Sports.",
    "Rugby is broadcast on our TVs and football isn't shown.",
    "Football is not shown and our TVs are used to show rugby.",
    "We show live football and rugby is not shown.",
    "We have Sky Sports and rugby is not available.",
    "We're not subscribed to TNT Sports and we show football on our TVs.",
  ])("retains an independent viewing proposition beside a denial: %s", (quote) => {
    expectSportsPublication(quote, true);
  });

  it.each([
    "We don’t show Sky Sports.",
    "We don't show Sky Sports and TNT Sports.",
    "We don't show football and rugby on TV.",
    "We don’t broadcast football or rugby.",
    "We don't watch football or cricket on our TVs.",
    "No Sky Sports and no TNT Sports.",
    "No Sky Sports or TNT Sports.",
    "Football and rugby aren't shown on our screens.",
    "Cricket isn’t broadcast on our TVs.",
    "Our screens aren’t used to show cricket.",
    "Sky Sports and football are not shown on our TVs.",
    "Live football and rugby are not shown here.",
    "TNT Sports and rugby are not available.",
    "Live football and live rugby aren't shown.",
    "We don't have football or Sky Sports.",
  ])("keeps a denial over its coordinated objects: %s", (quote) => {
    expectSportsPublication(quote, false);
  });

  it.each([
    "We have Sky Sports and no TNT Sports.",
    "We show BT Sport and no Sky Sports.",
    "We show football and rugby on our TVs.",
    "Cricket is shown on our screens.",
    "Rugby is broadcast on our TVs.",
    "Our screens are used to show football.",
    "Live football and rugby are shown on our TVs.",
    "Sky Sports and football are shown here.",
    "Sports pub",
  ])("retains explicit affirmative viewing evidence: %s", (quote) => {
    expectSportsPublication(quote, true);
  });
});

describe("parsePubAmenityModelJson", () => {
  it("reads a fenced object and drops keys that are not amenities", () => {
    const raw = [
      "```json",
      JSON.stringify({
        amenities: {
          food: { value: true, evidence: "serves food every day" },
          wifi: { value: true, evidence: "free wifi" },
          cocktails: { value: "yes", evidence: "Cocktails" },
        },
      }),
      "```",
    ].join("\n");
    const parsed = parsePubAmenityModelJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.amenities.food).toEqual({
      value: true,
      evidence: "serves food every day",
    });
    expect(parsed.amenities).not.toHaveProperty("wifi");
    expect(parsed.amenities.cocktails).toBeUndefined();
  });

  it("refuses a body that is not JSON", () => {
    expect(parsePubAmenityModelJson("the pub has a garden")).toEqual({
      ok: false,
      reason: "not-json",
    });
  });
});

describe("keepEvidencedAmenities", () => {
  it.each([
    "WORLD CUP 2026",
    "Autumn Nations 2026",
    "No screens and no live sport at this pub.",
    "We have no TVs for the football.",
    "No Sky Sports here.",
    "No TNT Sports here.",
    "We do not show sport.",
    "We dont show sport.",
    "We don’t show sport.",
    "Never show sport.",
    "We do not show football.",
    "We don't show rugby.",
    "We don’t show cricket.",
    "We never show boxing.",
    "We never show football on our screens.",
    "We never show rugby on our TVs.",
    "We are not a sports pub.",
    "We aren't a sports bar.",
    "Watch televised news on our TVs.",
    "Watch Sky documentaries on our screens.",
    "Watch TNT dramas on our TVs.",
    "Watch BT adverts on our screens.",
    "Watch a kick tutorial on our TVs.",
    "Watch a tackle tutorial on our screens.",
    "Watch Alien vs Predator on our TVs.",
    "Watch Liverpool vs Man City",
    "Liverpool vs Man City live",
  ])("does not publish a quote that does not say sport is shown here: %s", (quote) => {
    const parsed = parsePubAmenityModelJson(JSON.stringify({
      amenities: { liveSports: { value: true, evidence: quote } },
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const kept = keepEvidencedAmenities(parsed.amenities, quote);
    expect(kept).toEqual({});
    expect(statedAmenities({ liveSports: quote })).toEqual({});
    expect(pubSpecificEvidence([
      { osmId: "a", sourceUrl: "https://pub.example/", amenities: { liveSports: quote } },
    ])).toEqual([]);
    expect(stampAmenityColumns(liftSiteStamps({ live_sports: SITE_STAMP }), kept).row)
      .toEqual({ live_sports: "" });
  });

  it.each([
    "We show live sport on our Sky Sports screens.",
    "Watch football on our TV screens.",
    "No food, but we show live sport on our TV screens.",
    "Live Sport",
    "LIVE SPORTS",
    "Sky Sports and TNT Sports",
    "Live Premier League Football",
    "Live sport on our TVs",
    "Live Sports Screenings",
    "Catch the rugby this season",
    "Playing all the big matches",
    "World Cup and Wimbledon matches screened in the garden.",
    "No food, but we show live sport.",
    "Sports pub",
    "Sports bar, restaurant and rooms",
    "The Crown is known as a \"Sports Pub\" for football and rugby.",
    "A pub known for televised sport.",
    "Live boxing on our screens.",
    "Watch Liverpool vs Man City live",
    "Watch Liverpool vs Man City football live",
    "No Sky Sports, but we show live sport on TNT Sports.",
    "We don't show football; we show rugby on our TVs.",
    "We show live sport on TNT Sports, but no Sky Sports.",
    "We show TNT Sports but no Sky Sports.",
    "No screens in the dining room. Watch football on our bar TVs.",
  ])("publishes affirmative televised sport evidence: %s", (quote) => {
    const parsed = parsePubAmenityModelJson(JSON.stringify({
      amenities: { liveSports: { value: true, evidence: quote } },
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const kept = keepEvidencedAmenities(parsed.amenities, quote);
    expect(kept).toEqual({ liveSports: quote });
    expect(pubSpecificEvidence([
      { osmId: "a", sourceUrl: "https://pub.example/", amenities: kept },
    ])).toEqual([{ osmId: "a", sourceUrl: "https://pub.example/", amenities: { liveSports: quote } }]);
    expect(stampAmenityColumns({ live_sports: "" }, kept).row)
      .toEqual({ live_sports: SITE_STAMP });
  });

  it("keeps a true value only when the quote is on the page", () => {
    const kept = keepEvidencedAmenities(
      {
        food: { value: true, evidence: "serves food every day" },
        beerGarden: { value: true, evidence: "Our Beer Garden opens" },
        liveSports: { value: true, evidence: "we show every match live" },
        cocktails: { value: false, evidence: "Cocktails are listed on the board" },
        pubQuiz: { value: true, evidence: "quiz" },
      },
      PAGE,
    );
    expect(kept.food).toBe("serves food every day");
    expect(kept.beerGarden).toBe("Our Beer Garden opens");
    expect(kept.liveSports).toBeUndefined();
    expect(kept.cocktails).toBeUndefined();
    expect(kept.pubQuiz).toBeUndefined();
    expect(evidenceQuoteIsOnPage(PAGE, "quiz")).toBe(false);
  });

  it("drops a quote that is on the page but does not state the amenity at this pub", () => {
    const page = [
      "We serve a range of tea, coffee and hot chocolate drinks.",
      "All children's meals are served with a drink and fruit option included.",
      "Book a table for all the top sporting action, from footy to rugby, F1, darts and more!",
      "Pool Charging Station by the door.",
      "Plenty of merriment from Christmas quizzes to karaoke. Come join us.",
      "Food and drinks Hotels About us Contact us Careers",
    ].join(" ");
    const kept = keepEvidencedAmenities(
      {
        nonAlcoholic: { value: true, evidence: "tea, coffee and hot chocolate drinks" },
        darts: { value: true, evidence: "from footy to rugby, F1, darts and more!" },
        pool: { value: true, evidence: "Pool Charging Station" },
        karaoke: { value: true, evidence: "Christmas quizzes to karaoke" },
        food: { value: true, evidence: "Food and drinks Hotels About us Contact us Careers" },
      },
      page,
    );
    expect(kept).toEqual({});
    expect(
      keepEvidencedAmenities(
        {
          nonAlcoholic: {
            value: true,
            evidence: "All children's meals are served with a drink",
          },
          karaoke: { value: true, evidence: "karaoke. Come join us" },
        },
        page,
      ),
    ).toEqual({});
  });

  it("drops chain-wide news, seasonal promotions and a bare time range", () => {
    const page = [
      "Related Content Alcohol free cocktails fuelling growth in low and no sales at Greene King Pubs.",
      "Plenty of merriment from Christmas quizzes to karaoke.",
      "Drinks deals 4pm - 7pm, Monday to Thursday!",
    ].join(" ");
    const kept = keepEvidencedAmenities(
      {
        nonAlcoholic: {
          value: true,
          evidence: "Alcohol free cocktails fuelling growth in low and no sales at Greene King Pubs",
        },
        pubQuiz: { value: true, evidence: "Christmas quizzes" },
        happyHour: { value: true, evidence: "4pm - 7pm, Monday to Thursday!" },
      },
      page,
    );
    expect(kept).toEqual({});
    for (const evidence of ["Alcohol free cocktails", "low and no sales"]) {
      expect(keepEvidencedAmenities({ nonAlcoholic: { value: true, evidence } }, page)).toEqual({});
    }
  });

  it("drops a bare screen, drinks before an event elsewhere, a quiz machine and generic soft drinks", () => {
    expect(
      statedAmenities({
        liveSports: "tv TV screens",
        liveMusic: "pre/post match & concert drinks",
        pubQuiz: "Quiz Machine",
        nonAlcoholic: "alcoholic and non-alcoholic drinks",
      }),
    ).toEqual({});
    expect(statedAmenities({ liveSports: "pre/post match & concert drinks" })).toEqual({});
    expect(
      statedAmenities({
        liveSports: "We show live sport on our Sky Sports screens",
        liveMusic: "live music every Saturday",
        pubQuiz: "Join our pub quiz, every Wednesday",
        nonAlcoholic: "non-alcoholic beers",
      }),
    ).toEqual({
      liveSports: "We show live sport on our Sky Sports screens",
      liveMusic: "live music every Saturday",
      pubQuiz: "Join our pub quiz, every Wednesday",
      nonAlcoholic: "non-alcoholic beers",
    });
  });

  it("keeps a quote that names the amenity itself", () => {
    const page = [
      "Lucky Saint 0.5% and alcohol-free cocktails behind the bar.",
      "Upstairs we have a dart board and two pool tables.",
      "Karaoke every Thursday from eight.",
      "Our kitchen serves food every day.",
      "2-4-1 cocktails Monday to Friday, 5-7pm.",
    ].join(" ");
    const kept = keepEvidencedAmenities(
      {
        nonAlcoholic: { value: true, evidence: "alcohol-free cocktails" },
        darts: { value: true, evidence: "a dart board" },
        pool: { value: true, evidence: "two pool tables" },
        karaoke: { value: true, evidence: "Karaoke every Thursday" },
        food: { value: true, evidence: "serves food every day" },
        happyHour: { value: true, evidence: "2-4-1 cocktails Monday to Friday" },
      },
      page,
    );
    expect(kept).toEqual({
      happyHour: "2-4-1 cocktails Monday to Friday",
      nonAlcoholic: "alcohol-free cocktails",
      darts: "a dart board",
      pool: "two pool tables",
      karaoke: "Karaoke every Thursday",
      food: "serves food every day",
    });
  });
});

describe("statedAmenities", () => {
  it("drops stored quotes the gate would refuse, so a restamp cannot bring them back", () => {
    expect(
      statedAmenities({
        nonAlcoholic: "tea, coffee and hot chocolate drinks",
        darts: "Boxing Darts Formula 1",
        pubQuiz: "Christmas quizzes to karaoke.",
        beerGarden: "Our beer garden opens",
        pool: "two pool tables",
      }),
    ).toEqual({ beerGarden: "Our beer garden opens", pool: "two pool tables" });
  });

  it("drops a question and a quote cut off before its object", () => {
    expect(
      statedAmenities({
        liveSports: "Do you show live sport?",
        karaoke: "karaoke to keep",
        food: "Our kitchen serves food to order",
      }),
    ).toEqual({ food: "Our kitchen serves food to order" });
  });

  it("drops an event the page advertises at another venue", () => {
    expect(statedAmenities({ pubQuiz: "The Lexington Pop Quiz" })).toEqual({});
  });
});

describe("pubSpecificEvidence", () => {
  it("drops a page several pubs point at and gates the quotes of the rest", () => {
    const rows = [
      { osmId: "a", sourceUrl: "https://chain.example/food-drink", amenities: { liveSports: "Live Sport" } },
      { osmId: "b", sourceUrl: "https://chain.example/food-drink", amenities: {} },
      {
        osmId: "c",
        sourceUrl: "https://crown.example/",
        amenities: { pubQuiz: "Quiz Machine", food: "serves food every day" },
      },
      { osmId: "d", sourceUrl: "https://swan.example/", amenities: { nonAlcoholic: "soft drinks" } },
    ];
    expect(pubSpecificEvidence(rows)).toEqual([
      { osmId: "c", sourceUrl: "https://crown.example/", amenities: { food: "serves food every day" } },
    ]);
  });

  it("treats pages that differ only by query, case or slash, and a shared host's home page, as chain pages", () => {
    const rows = [
      { osmId: "a", sourceUrl: "https://www.chain.example/our-pubs?PubID=1", amenities: { food: "Food & Drink" } },
      { osmId: "b", sourceUrl: "https://WWW.chain.example/our-pubs/?PubID=2#top", amenities: { food: "Food & Drink" } },
      { osmId: "c", sourceUrl: "https://www.chain.example/", amenities: { cocktails: "secret cocktail bars" } },
    ];
    expect(pubSpecificEvidence(rows)).toEqual([]);
  });

  it("drops a quote repeated word for word across pubs on one host and keeps each pub's own", () => {
    const rows = [
      {
        osmId: "a",
        sourceUrl: "https://pubs.example/pubs/goose",
        amenities: { liveSports: "WATCH LIVERPOOL VS MAN CITY LIVE", beerGarden: "a hidden garden" },
      },
      {
        osmId: "b",
        sourceUrl: "https://pubs.example/pubs/george",
        amenities: { liveSports: "Watch Liverpool vs Man City live" },
      },
    ];
    expect(pubSpecificEvidence(rows)).toEqual([
      {
        osmId: "a",
        sourceUrl: "https://pubs.example/pubs/goose",
        amenities: { beerGarden: "a hidden garden" },
      },
    ]);
  });
});

describe("chain denylist", () => {
  const youngsRows = [
    { osmId: "a", sourceUrl: "https://www.youngs.co.uk/food-drink", amenities: { beerGarden: "Pub Gardens" } },
    { osmId: "b", sourceUrl: "https://www.youngs.co.uk/food-drink?pub=2", amenities: {} },
    { osmId: "c", sourceUrl: "https://www.youngs.co.uk/", amenities: { cocktails: "secret cocktail bars" } },
    {
      osmId: "d",
      sourceUrl: "https://pubs.example/pubs/goose",
      amenities: { liveSports: "WATCH LIVERPOOL VS MAN CITY LIVE", beerGarden: "a hidden garden" },
    },
    { osmId: "e", sourceUrl: "https://pubs.example/pubs/george", amenities: { liveSports: "Watch Liverpool vs Man City live" } },
  ];

  it("records the shared pages, the shared host's home page, the repeated quotes and every reader", () => {
    expect(provenChainEvidence(youngsRows)).toEqual({
      pages: ["youngs.co.uk", "youngs.co.uk/food-drink"],
      quotes: [{ host: "pubs.example", key: "liveSports", quote: "watch liverpool vs man city live" }],
      readers: {
        "pubs.example/pubs/george": ["e"],
        "pubs.example/pubs/goose": ["d"],
        "youngs.co.uk": ["c"],
        "youngs.co.uk/food-drink": ["a", "b"],
      },
      quoteReaders: [
        { host: "pubs.example", key: "beerGarden", quote: "a hidden garden", readers: ["d"] },
        { host: "pubs.example", key: "liveSports", quote: "watch liverpool vs man city live", readers: ["d", "e"] },
        { host: "youngs.co.uk", key: "beerGarden", quote: "pub gardens", readers: ["a"] },
        { host: "youngs.co.uk", key: "cocktails", quote: "secret cocktail bars", readers: ["c"] },
      ],
    });
  });

  it("proves a page read by one pub on each of two runs, whatever the first read kept", () => {
    const firstRun = provenChainEvidence([{ osmId: "a", sourceUrl: "https://chain.example/locations" }]);
    expect(firstRun.pages).toEqual([]);
    const secondRun = [
      { osmId: "b", sourceUrl: "https://www.chain.example/locations/", amenities: { beerGarden: "Pub Gardens" } },
    ];
    expect(pubSpecificEvidence(secondRun)).toHaveLength(1);
    expect(pubSpecificEvidence(secondRun, firstRun)).toEqual([]);
    expect(mergeChainDenylists(firstRun, provenChainEvidence(secondRun))).toMatchObject({
      pages: ["chain.example/locations"],
      readers: { "chain.example/locations": ["a", "b"] },
    });
  });

  it("proves a quote stated by one pub on a chain page and by another pub on a later run", () => {
    const firstRun = provenChainEvidence([
      { osmId: "a", sourceUrl: "https://chain.example/locations", amenities: { food: "Stacked burgers" } },
      { osmId: "c", sourceUrl: "https://chain.example/locations?pub=c", amenities: {} },
    ]);
    expect(firstRun.pages).toEqual(["chain.example/locations"]);
    expect(firstRun.quotes).toEqual([]);
    const secondRun = [
      {
        osmId: "b",
        sourceUrl: "https://chain.example/bars/b",
        amenities: { food: "stacked  burgers", beerGarden: "a hidden garden" },
      },
    ];
    expect(pubSpecificEvidence(secondRun)).toHaveLength(1);
    expect(pubSpecificEvidence(secondRun, firstRun)).toEqual([
      { osmId: "b", sourceUrl: "https://chain.example/bars/b", amenities: { beerGarden: "a hidden garden" } },
    ]);
    expect(mergeChainDenylists(firstRun, provenChainEvidence(secondRun)).quotes).toEqual([
      { host: "chain.example", key: "food", quote: "stacked burgers" },
    ]);
  });

  it("proves a shared host's home page from readers of its other pages on an earlier run", () => {
    const firstRun = provenChainEvidence([{ osmId: "a", sourceUrl: "https://chain.example/the-plough" }]);
    expect(
      pubSpecificEvidence([{ osmId: "b", sourceUrl: "https://chain.example/", amenities: { beerGarden: "Pub Gardens" } }], firstRun),
    ).toEqual([]);
  });

  it("counts one pub that read a page twice as one reader", () => {
    expect(
      provenChainEvidence([
        { osmId: "a", sourceUrl: "https://crown.example/" },
        { osmId: "a", sourceUrl: "https://crown.example/", amenities: { food: "serves food every day" } },
      ]).pages,
    ).toEqual([]);
  });

  it("keeps a pub that reads a proven chain page alone on a later run out of the evidence", () => {
    const denylist = provenChainEvidence(youngsRows);
    const laterRun = [
      { osmId: "f", sourceUrl: "https://www.youngs.co.uk/food-drink/", amenities: { beerGarden: "Pub Gardens" } },
      {
        osmId: "h",
        sourceUrl: "https://pubs.example/pubs/swan",
        amenities: { liveSports: "watch Liverpool vs Man City LIVE", food: "serves food every day" },
      },
    ];
    expect(pubSpecificEvidence(laterRun)).toHaveLength(2);
    expect(pubSpecificEvidence(laterRun, denylist)).toEqual([
      { osmId: "h", sourceUrl: "https://pubs.example/pubs/swan", amenities: { food: "serves food every day" } },
    ]);
    const homeAlone = [
      { osmId: "g", sourceUrl: "https://www.youngs.co.uk", amenities: { liveSports: "Live Sport on every screen" } },
    ];
    expect(pubSpecificEvidence(homeAlone)).toHaveLength(1);
    expect(pubSpecificEvidence(homeAlone, denylist)).toEqual([]);
  });

  it("reads www and the bare host as one site", () => {
    expect(
      provenChainEvidence([
        { osmId: "a", sourceUrl: "https://www.motherkellys.example/", amenities: {} },
        { osmId: "b", sourceUrl: "http://motherkellys.example", amenities: {} },
      ]).pages,
    ).toEqual(["motherkellys.example"]);
  });

  it("counts the reads a stopped run left in the checkpoint when a resumed run merges", () => {
    // Run 1 read pub A on the chain page, saved the checkpoint and stopped before it wrote the chain list.
    const checkpoint = {
      a: { status: "ok", sourceUrl: "https://chain.example/locations", amenities: {} },
      c: { status: "empty-page", sourceUrl: "https://chain.example/bars/c" },
      d: { status: "ok", sourceUrl: "https://chain.example/bars/d", amenities: { food: "stacked burgers" } },
    };
    // The resumed run skips the checkpointed pubs and reads only B.
    const fresh = new Map([
      [
        "b",
        {
          status: "ok",
          name: "B",
          venueId: "venue-b",
          sourceUrl: "https://chain.example/locations?pub=b",
          verifiedAt: "2026-10-05",
          amenities: { beerGarden: "Pub Gardens" },
        },
      ],
      [
        "e",
        {
          status: "ok",
          name: "E",
          venueId: "venue-e",
          sourceUrl: "https://chain.example/bars/e",
          verifiedAt: "2026-10-05",
          amenities: { food: "Stacked  burgers", pool: "a pool table upstairs" },
        },
      ],
    ]);
    const resumed = { previousRows: [], fresh, knownChainPages: EMPTY_CHAIN_DENYLIST };
    const merged = mergeHarvestEvidence({ ...resumed, checkpoint: { ...checkpoint, ...Object.fromEntries(fresh) } });
    expect(merged.chainPages.pages).toContain("chain.example/locations");
    expect(merged.chainPages.quotes).toContainEqual({ host: "chain.example", key: "food", quote: "stacked burgers" });
    expect(merged.rows).toEqual([
      {
        osmId: "e",
        name: "E",
        venueId: "venue-e",
        sourceUrl: "https://chain.example/bars/e",
        verifiedAt: "2026-10-05",
        amenities: { pool: "a pool table upstairs" },
      },
    ]);
    // Counting only this process's reads lets B and E's chain quote through.
    const freshOnly = mergeHarvestEvidence({ ...resumed, checkpoint: Object.fromEntries(fresh) });
    expect(freshOnly.rows.map((row) => row.osmId)).toEqual(["b", "e"]);
  });

  it("does not count a read of a page that did not state the pub's address as a reader of it", () => {
    const own: HarvestRead = {
      status: "ok",
      name: "The Two Brewers",
      venueId: "venue-clapham",
      sourceUrl: "https://www.the2brewers.com/london",
      verifiedAt: "2026-10-05",
      amenities: { liveMusic: "live music every Friday" },
    };
    const fresh = new Map<string, HarvestRead>([["node/1", own]]);
    const checkpoint: Record<string, HarvestRead> = {
      "node/1": own,
      "venue/islington": { status: "listed-site-unconfirmed", venueId: "venue-islington", sourceUrl: "https://www.the2brewers.com/london" },
      "venue/other": { status: "located-site-unconfirmed", venueId: "venue-other", sourceUrl: "https://www.the2brewers.com/" },
    };
    const merged = mergeHarvestEvidence({ previousRows: [], fresh, checkpoint, knownChainPages: EMPTY_CHAIN_DENYLIST });
    expect(merged.chainPages.pages).toEqual([]);
    expect(merged.rows.map((row) => row.osmId)).toEqual(["node/1"]);
  });

  it("does not let a dataset venue's read of a page an OSM pub read prove it chain-wide, whatever came of either read", () => {
    const page = "https://www.greeneking.co.uk/pubs/greater-london/butchers-hook";
    const duplicate: HarvestRead = {
      status: "ok",
      name: "Butchers Hook",
      venueId: "venue-dup",
      sourceUrl: page,
      verifiedAt: "2026-10-05",
      amenities: { food: "savour delicious pub classics" },
    };
    const osm: HarvestRead = { status: "quota", venueId: "venue-osm", sourceUrl: page };
    const fresh = new Map<string, HarvestRead>([["venue/venue-dup", duplicate]]);
    const merged = mergeHarvestEvidence({
      previousRows: [],
      fresh,
      checkpoint: { "way/151288979": osm, "venue/venue-dup": duplicate },
      knownChainPages: EMPTY_CHAIN_DENYLIST,
    });
    expect(merged.chainPages.pages).toEqual([]);
    expect(merged.rows).toEqual([]);
    const ownRow = { osmId: "way/151288979", venueId: "venue-osm", sourceUrl: page, amenities: { food: "savour delicious pub classics" } };
    const kept = mergeHarvestEvidence({
      previousRows: [ownRow],
      fresh,
      checkpoint: { "venue/venue-dup": duplicate },
      knownChainPages: EMPTY_CHAIN_DENYLIST,
    });
    expect(kept.chainPages.pages).toEqual([]);
    expect(kept.rows.map((row) => row.osmId)).toEqual(["way/151288979"]);
  });

  it("treats a dataset venue's read as a duplicate when the OSM owner is only a reader on the chain list", () => {
    const page = "https://www.greeneking.co.uk/pubs/greater-london/butchers-hook";
    const duplicate: HarvestRead = {
      status: "ok",
      name: "Butchers Hook",
      venueId: "venue-dup",
      sourceUrl: page,
      verifiedAt: "2026-10-05",
      amenities: { food: "savour delicious pub classics" },
    };
    const knownChainPages = { ...EMPTY_CHAIN_DENYLIST, readers: { "greeneking.co.uk/pubs/greater-london/butchers-hook": ["way/151288979"] } };
    const merged = mergeHarvestEvidence({
      previousRows: [],
      fresh: new Map([["venue/venue-dup", duplicate]]),
      checkpoint: { "venue/venue-dup": duplicate },
      knownChainPages,
    });
    expect(merged.chainPages.pages).toEqual([]);
    expect(merged.rows).toEqual([]);
    const owners = pageOwners([], Object.entries({ "venue/venue-dup": duplicate }), knownChainPages);
    expect(siteOfAnotherPub(page, "venue/venue-dup", owners)).toBe(true);
    expect(siteOfAnotherPub(page, "way/151288979", owners)).toBe(false);
  });

  it("does not let two dataset venues' reads of one page prove it chain-wide", () => {
    const read = (venueId: string): HarvestRead => ({
      status: "ok",
      venueId,
      sourceUrl: "https://www.thecrown.example/",
      verifiedAt: "2026-10-05",
      amenities: { pool: "a pool table upstairs" },
    });
    const fresh = new Map<string, HarvestRead>([["venue/a", read("a")], ["venue/b", read("b")]]);
    const merged = mergeHarvestEvidence({ previousRows: [], fresh, checkpoint: Object.fromEntries(fresh), knownChainPages: EMPTY_CHAIN_DENYLIST });
    expect(merged.chainPages.pages).toEqual([]);
  });

  it("drops an extra page whose link is allowed but which lands on a proven chain page", async () => {
    const chainPages = { ...EMPTY_CHAIN_DENYLIST, pages: ["chain.example/food-drink"] };
    const fetched: string[] = [];
    const pages: Record<string, string> = {
      "https://pub.example/menu": "https://www.chain.example/food-drink/",
      "https://pub.example/whats-on": "https://pub.example/whats-on",
    };
    const deps = {
      chainPages,
      isHarvestable: () => true,
      robots: async () => ({ allowed: true }),
      readHtml: async (url: string) => {
        fetched.push(url);
        return { ok: true as const, url: pages[url] ?? url, text: `text of ${url}` };
      },
    };
    expect(await readExtraPage("https://pub.example/menu", deps)).toBeNull();
    expect(await readExtraPage("https://pub.example/whats-on", deps)).toBe("text of https://pub.example/whats-on");
    expect(await readExtraPage("https://chain.example/food-drink", deps)).toBeNull();
    expect(fetched).toEqual(["https://pub.example/menu", "https://pub.example/whats-on"]);
  });

  it("asks about a URL the way the chain rule reads a page", () => {
    const denylist = { pages: ["youngs.co.uk/our-pubs"], quotes: [], readers: {}, quoteReaders: [] };
    expect(isChainPage("https://WWW.youngs.co.uk/our-pubs/?PubID=7#map", denylist)).toBe(true);
    expect(isChainPage("https://youngs.co.uk/our-pubs", denylist)).toBe(true);
    expect(isChainPage("https://www.youngs.co.uk/our-pubs/the-plough", denylist)).toBe(false);
    expect(isChainPage("not a url", denylist)).toBe(false);
    expect(isChainPage("https://www.youngs.co.uk/our-pubs", EMPTY_CHAIN_DENYLIST)).toBe(false);
  });

  it("merges lists into one sorted, deduplicated list with folded quotes", () => {
    expect(
      mergeChainDenylists(
        {
          pages: ["b.example", "a.example"],
          quotes: [{ host: "a.example", key: "food", quote: "Sunday  Roasts" }],
          readers: { "c.example/x": ["2", "1"] },
          quoteReaders: [
            { host: "e.example", key: "pool", quote: "Pool  Table", readers: ["4"] },
            { host: "f.example", key: "food", quote: "pies", readers: ["6"] },
          ],
        },
        {
          pages: ["a.example"],
          quotes: [{ host: "a.example", key: "food", quote: "sunday roasts" }],
          readers: { "c.example/x": ["1"], "d.example": ["3"] },
          quoteReaders: [{ host: "e.example", key: "pool", quote: "pool table", readers: ["5", "4"] }],
        },
      ),
    ).toEqual({
      pages: ["a.example", "b.example", "c.example/x"],
      quotes: [
        { host: "a.example", key: "food", quote: "sunday roasts" },
        { host: "e.example", key: "pool", quote: "pool table" },
      ],
      readers: { "c.example/x": ["1", "2"], "d.example": ["3"] },
      quoteReaders: [
        { host: "e.example", key: "pool", quote: "pool table", readers: ["4", "5"] },
        { host: "f.example", key: "food", quote: "pies", readers: ["6"] },
      ],
    });
  });

  it("reads a hand-written page, quote host and reader page the way the chain rule does", () => {
    const denylist = parseChainDenylist({
      pages: ["https://WWW.Chain.example/Our-Pubs/", "www.chain.example"],
      quotes: [{ host: "https://WWW.Youngs.co.uk", key: "beerGarden", quote: "Pub Gardens" }],
      readers: { "WWW.Crown.example/": ["a"] },
      quoteReaders: [{ host: "WWW.Swan.example", key: "food", quote: "Pies", readers: ["s"] }],
    });
    expect(denylist).toEqual({
      pages: ["chain.example", "chain.example/Our-Pubs"],
      quotes: [{ host: "youngs.co.uk", key: "beerGarden", quote: "pub gardens" }],
      readers: { "crown.example": ["a"] },
      quoteReaders: [{ host: "swan.example", key: "food", quote: "pies", readers: ["s"] }],
    });
    expect(
      pubSpecificEvidence(
        [{ osmId: "t", sourceUrl: "https://swan.example/menu", amenities: { food: "pies", beerGarden: "a hidden garden" } }],
        denylist,
      ),
    ).toEqual([{ osmId: "t", sourceUrl: "https://swan.example/menu", amenities: { beerGarden: "a hidden garden" } }]);
    expect(
      pubSpecificEvidence(
        [{ osmId: "b", sourceUrl: "https://www.youngs.co.uk/the-plough", amenities: { beerGarden: "Pub Gardens" } }],
        denylist,
      ),
    ).toEqual([]);
  });

  it("refuses a malformed list rather than reading it as empty", () => {
    expect(() => parseChainDenylist(null)).toThrow();
    expect(() => parseChainDenylist({ pages: [] })).toThrow();
    const empty = { pages: [], quotes: [], readers: {}, quoteReaders: [] };
    expect(parseChainDenylist(empty)).toEqual(EMPTY_CHAIN_DENYLIST);
    expect(() => parseChainDenylist({ pages: [], quotes: [], readers: {} })).toThrow();
    expect(() => parseChainDenylist({ pages: [], quotes: [], quoteReaders: [] })).toThrow();
    expect(() => parseChainDenylist({ ...empty, pages: [1] })).toThrow();
    expect(() => parseChainDenylist({ ...empty, quotes: [{ host: "a.example", key: "nope", quote: "free wifi" }] })).toThrow();
    expect(() => parseChainDenylist({ ...empty, quotes: [{ host: "a.example/pubs", key: "food", quote: "food" }] })).toThrow();
    expect(() => parseChainDenylist({ ...empty, readers: { "a.example": "x" } })).toThrow();
    expect(() => parseChainDenylist({ ...empty, readers: { "a.example": [""] } })).toThrow();
    expect(() => parseChainDenylist({ ...empty, quoteReaders: [{ host: "a.example", key: "food", quote: "pies" }] })).toThrow();
    expect(() =>
      parseChainDenylist({ ...empty, quoteReaders: [{ host: "a.example/pubs", key: "food", quote: "pies", readers: ["a"] }] }),
    ).toThrow();
  });

  it("commits a sorted list that holds the chain proof and readers of every first-harvest pub and no page the evidence uses", () => {
    const root = path.resolve(__dirname, "..");
    const raw = JSON.parse(readFileSync(path.join(root, "data/amenities/london_pub_website_chain_pages.json"), "utf8"));
    const denylist = parseChainDenylist(raw);
    expect({ version: 1, ...denylist }).toEqual(raw);
    expect(denylist.pages).toEqual(
      expect.arrayContaining([
        "jdwetherspoon.com",
        "youngs.co.uk",
        "youngs.co.uk/food-drink",
        "youngs.co.uk/our-pubs",
        "greeneking.co.uk/pubs-near-me",
        "socialpubandkitchen.co.uk",
      ]),
    );
    expect(denylist.quotes).toContainEqual({
      host: "socialpubandkitchen.co.uk",
      key: "liveSports",
      quote: "watch liverpool vs man city live",
    });
    expect(new Set(Object.values(denylist.readers).flat()).size).toBeGreaterThanOrEqual(1261);
    expect(new Set(denylist.quoteReaders.flatMap((entry) => entry.readers)).size).toBeGreaterThanOrEqual(1261);
    expect(denylist.readers).toMatchObject({
      "craftunionpubs.com/brewery-tap-brentwood": ["node/10018880685"],
      "jdwetherspoon.com/pubs/the-greyhound-bromley": ["node/11067789496"],
      "stormbirdcamberwell.com": ["node/12572448581"],
    });
    const evidence = JSON.parse(
      readFileSync(path.join(root, "data/amenities/london_pub_website_evidence.json"), "utf8"),
    ) as { rows: { osmId: string; sourceUrl: string; amenities: Record<string, string> }[] };
    expect(evidence.rows.filter((row) => isChainPage(row.sourceUrl, denylist))).toEqual([]);
    expect(mergeChainDenylists(denylist, provenChainEvidence(evidence.rows))).toEqual(denylist);
    expect(pubSpecificEvidence(evidence.rows, denylist)).toEqual(pubSpecificEvidence(evidence.rows));
  });
});

describe("stampAmenityColumns", () => {
  it("writes the site stamp into a blank column and leaves a stated answer alone", () => {
    const { row, stamped } = stampAmenityColumns(
      { food: "", cocktails: "no", beer_garden: "yes (summer)" },
      {
        food: "serves food every day",
        cocktails: "Cocktails are listed on the board",
        beerGarden: "Our beer garden opens",
      },
    );
    expect(row.food).toBe(SITE_STAMP);
    expect(row.cocktails).toBe("no");
    expect(row.beer_garden).toBe("yes (summer)");
    expect(stamped).toEqual(["food"]);
    expect(amenityColumnIsBlank("")).toBe(true);
    expect(amenityColumnIsBlank("n/a")).toBe(true);
    expect(amenityColumnIsBlank("no")).toBe(false);
  });

  it("lifts its own stamps back to the source row and leaves the source's answers alone", () => {
    const source = { food: "", live_sports: "yes", pool: "" };
    const { row } = stampAmenityColumns(source, {
      food: "serves food every day",
      liveSports: "We show live sport",
      nonAlcoholic: "alcohol-free beers",
    });
    expect(row).toEqual({ food: SITE_STAMP, live_sports: "yes", pool: "", non_alcoholic: SITE_STAMP });
    expect(liftSiteStamps(row)).toEqual(source);
    expect(liftSiteStamps(source)).toBe(source);
  });
});

describe("projectPubAmenitySpend", () => {
  it("prices the Flash-Lite text SKU under the job cap for the London pub set", () => {
    const spend = projectPubAmenitySpend({
      calls: 1882,
      inputTokensPerCall: 3000,
      outputTokensPerCall: 800,
      inputUsdPerMillion: FLASH_LITE_SKU.inputUsdPerMillion,
      outputUsdPerMillion: FLASH_LITE_SKU.outputUsdPerMillion,
    });
    expect(spend).toBeCloseTo(1.16684, 4);
    expect(spend).toBeLessThan(JOB_SPEND_CAP_USD);
  });
});

describe("matchPubToVenue", () => {
  const venues = [
    { venueId: "venue-near", name: "The Shy Horse", lat: 51.5, lng: -0.1 },
    { venueId: "venue-far", name: "The Shy Horse", lat: 51.7, lng: -0.4 },
    { venueId: "venue-other", name: "The Crown and Treaty", lat: 51.5, lng: -0.1 },
  ];

  it("picks the closest pub whose name agrees", () => {
    const match = matchPubToVenue(
      {
        osmId: "node/1",
        name: "The Shy Horse",
        lat: 51.5002,
        lng: -0.1002,
        website: "https://example.com/shy-horse",
      },
      venues,
    );
    expect(match?.venueId).toBe("venue-near");
  });

  it("matches a chain suffix on the same pub", () => {
    const match = matchPubToVenue(
      {
        osmId: "node/3",
        name: "The Shy Horse",
        lat: 51.5001,
        lng: -0.1001,
        website: "https://example.com/shy-horse",
      },
      [{ venueId: "venue-spoon", name: "The Shy Horse - JD Wetherspoon", lat: 51.5002, lng: -0.1002 }],
    );
    expect(match?.venueId).toBe("venue-spoon");
  });

  it("does not match a different pub that only shares a word", () => {
    const match = matchPubToVenue(
      {
        osmId: "node/2",
        name: "The Crown",
        lat: 51.5,
        lng: -0.1,
        website: "https://example.com/crown",
      },
      venues,
    );
    expect(match).toBeNull();
  });
});


describe("firecrawlMayReread", () => {
  it("rereads only what the network or a script kept from the plain read", () => {
    for (const reason of ["timeout", "fetch-failed", "http-429", "http-503"]) expect(firecrawlMayReread({ ok: false, reason })).toBe(true);
    for (const reason of ["http-401", "http-403", "http-451", "http-404", "http-410", "redirect-refused", "not-html"]) {
      expect(firecrawlMayReread({ ok: false, reason })).toBe(false);
    }
    expect(firecrawlMayReread({ ok: true, url: "https://a.example/", text: "Loading" })).toBe(true);
    expect(firecrawlMayReread({ ok: true, url: "https://a.example/", text: "x".repeat(200) })).toBe(false);
  });
});

describe("kept page reads", () => {
  const pub = { venueId: "venue-abc", name: "The Crown" };

  it("keeps a Firecrawl read's fenced landing so the model run does not ask the site again", () => {
    const firecrawl = pageReadEntry(pub, { sourceUrl: "https://crown.example/", reader: "firecrawl", located: false });
    const kept = cachedPageRead(firecrawl, () => PAGE);
    expect(kept).toMatchObject({ status: "read", reader: "firecrawl", sourceUrl: "https://crown.example/", landingChecked: true, text: PAGE });
    const plain = cachedPageRead(pageReadEntry(pub, { sourceUrl: "https://crown.example/", reader: "fetch" }), () => PAGE);
    expect(plain?.landingChecked).toBeUndefined();
  });

  it("reads the pub again when its kept page text is gone", () => {
    const entry = pageReadEntry(pub, { sourceUrl: "https://crown.example/", reader: "firecrawl" });
    expect(cachedPageRead(entry, () => null)).toBeNull();
    expect(cachedPageRead({ status: "ok", sourceUrl: "https://crown.example/" }, () => PAGE)).toBeNull();
    expect(cachedPageRead(undefined, () => PAGE)).toBeNull();
  });
});

describe("located own sites", () => {
  const deps = {
    chainPages: { ...EMPTY_CHAIN_DENYLIST, pages: ["chainpubs.example/the-crown"] },
    isHarvestable: (url: string) => !url.includes("tripadvisor"),
    ownSite: (name: string, url: string) => (new URL(url).hostname.includes(name.split(" ").at(-1)!.toLowerCase()) ? url : null),
  };

  it("keeps the first permitted, non-chain hit whose host carries the pub's name", () => {
    const hits = [
      { url: "https://www.tripadvisor.co.uk/crown" },
      { url: "https://chainpubs.example/the-crown" },
      { url: "https://www.thecrownislington.example/" },
    ];
    expect(locatedOwnSite("The Crown", hits, deps)).toBe("https://www.thecrownislington.example/");
    expect(locatedOwnSite("The Crown", hits.slice(0, 2), deps)).toBeNull();
  });

  it("reads a postcode from an address and finds it on a page with or without its space", () => {
    expect(postcodeOf("116 Cloudesley Rd, London n1 0eb")).toBe("N1 0EB");
    expect(postcodeOf("Cloudesley Road, Islington")).toBeNull();
    expect(pageStatesPostcode("Find us at 116 Cloudesley Road, N10EB", "N1 0EB")).toBe(true);
    expect(pageStatesPostcode("Find us at N1 0EBX", "N1 0EB")).toBe(false);
    expect(pageStatesPostcode("Find us at SN1 0EB", "N1 0EB")).toBe(false);
  });
});

describe("street locators", () => {
  it("reads the street from an address's first part and spells out its suffix", () => {
    expect(streetOf("10 James St, London WC2E88T")).toEqual(["james", "street"]);
    expect(streetOf("39-41 Crutched Friars , , London")).toEqual(["crutched", "friars"]);
    expect(streetOf("106-107 Houndsditch, , London, UK")).toBeNull();
    expect(streetOf(", , Southwark,")).toBeNull();
  });

  it("finds the street on a page with its suffix spelled out or abbreviated, and no other street", () => {
    expect(pageStatesStreet("Find us on James St.", ["james", "street"])).toBe(true);
    expect(pageStatesStreet("51 Bethnal Green Rd, E2", ["bethnal", "green", "road"])).toBe(true);
    expect(pageStatesStreet("Jameson Street", ["james", "street"])).toBe(false);
  });

  it("confirms an address by its postcode when it has one, else its street, and never with neither", () => {
    const clapham = "The Two Brewers, 114 Clapham High Street, London SW4 7UJ";
    expect(pageStatesAddress(clapham, { postcode: "EC1Y 8JJ", street: ["whitecross", "street"] })).toBe(false);
    expect(pageStatesAddress(clapham, { postcode: "SW4 7UJ", street: null })).toBe(true);
    expect(pageStatesAddress(clapham, { postcode: null, street: ["clapham", "high", "street"] })).toBe(true);
    expect(pageStatesAddress(clapham, { postcode: null, street: null })).toBe(false);
  });
});

describe("scoped harvest guards", () => {
  const reads = [
    { osmId: "node/1", sourceUrl: "https://www.theguardhouse.example/" },
    { osmId: "node/2", sourceUrl: "https://www.chain.example/pubs/swan" },
    { osmId: "node/3", sourceUrl: "https://www.chain.example/pubs/crown" },
  ];

  it("leaves unread a page another pub read, and any page of a site only one other pub reads", () => {
    expect(siteOfAnotherPub("https://theguardhouse.example/menu", "venue/a", reads)).toBe(true);
    expect(siteOfAnotherPub("https://www.chain.example/pubs/swan/", "venue/a", reads)).toBe(true);
    expect(siteOfAnotherPub("https://www.chain.example/pubs/lion", "venue/a", reads)).toBe(false);
    expect(siteOfAnotherPub("https://www.theguardhouse.example/", "node/1", reads)).toBe(false);
    expect(siteOfAnotherPub("https://new.example/", "venue/a", reads)).toBe(false);
  });

  it("gives a page to every read of it but one whose page did not state the pub's address", () => {
    const read = { osmId: "node/9", sourceUrl: "https://thecrownandanchor.example/" };
    for (const status of ["located-site-unconfirmed", "listed-site-unconfirmed"]) {
      expect(siteOfAnotherPub("https://thecrownandanchor.example/", "venue/a", [{ ...read, status }])).toBe(false);
    }
    for (const status of ["ok", "read", "quota", "model-500", "error", "empty-page", "chain-page", undefined]) {
      expect(siteOfAnotherPub("https://thecrownandanchor.example/", "venue/a", [{ ...read, status }])).toBe(true);
    }
  });

  it("never takes a site OSM gives a pub away from it", () => {
    const reads = [{ osmId: "venue/a", sourceUrl: "https://thecrownandanchor.example/", status: "read" }];
    expect(siteOfAnotherPub("https://thecrownandanchor.example/", "node/9", reads)).toBe(false);
  });

  it("keeps earlier evidence unless a re-read keeps more amenities", () => {
    const previous = [{ osmId: "node/1", sourceUrl: "https://a.example/", amenities: { food: "serves food", pool: "a pool table" } }];
    const fresh = new Map<string, HarvestRead>([
      ["node/1", { status: "ok", sourceUrl: "https://a.example/", amenities: { food: "serves food" } }],
      ["node/2", { status: "http-404" }],
    ]);
    expect([...withoutThinnerRereads(fresh, previous).keys()]).toEqual(["node/2"]);
    fresh.set("node/1", { status: "robots-unreachable" });
    expect(withoutThinnerRereads(fresh, previous).has("node/1")).toBe(false);
    fresh.set("node/1", { status: "ok", sourceUrl: "https://a.example/", amenities: { food: "serves food", pool: "a pool table", darts: "a dartboard" } });
    expect(withoutThinnerRereads(fresh, previous).has("node/1")).toBe(true);
  });
});
