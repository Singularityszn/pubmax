import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, resolveRedirect, sha256 } from './transport.mjs';

const key = (v, u) => `${v}\t${u}`;
const rate = (n, d) => d ? n / d : null;
const unique = (items) => [...new Set(items)];

export function urlIdentity(results) {
  const redirects = new Map();
  for (const row of results) {
    for (const request of row.requests ?? []) {
      if (request.status >= 300 && request.status < 400 && request.location) {
        const target = resolveRedirect(request.location, request.url);
        if (target) redirects.set(key(row.venueId, request.url), target);
      }
    }
    for (const page of row.pages) {
      if (page.requestedUrl && page.requestedUrl !== page.url) redirects.set(key(row.venueId, page.requestedUrl), page.url);
    }
  }
  return (venueId, url) => {
    const visited = [];
    while (redirects.has(key(venueId, url))) {
      if (visited.includes(url)) return visited.slice(visited.indexOf(url)).sort()[0];
      visited.push(url);
      url = redirects.get(key(venueId, url));
    }
    return url;
  };
}

// Gold is an independent annotation file. A missing label never means "not a menu".
export function evaluate(results, labels) {
  const identity = urlIdentity(results);
  const valid = labels.filter((r) => ['menu', 'not-menu'].includes(r.verdict))
    .map((r) => ({ ...r, url: identity(r.venueId, r.url) }));
  const byKey = new Map(valid.map((row) => [key(row.venueId, row.url), row]));
  if (byKey.size !== valid.length) throw new Error('Duplicate gold venue/URL label');
  const output = [];
  for (const arm of unique(results.map((row) => row.arm))) {
    const rows = results.filter((r) => r.arm === arm);
    const venueIds = new Set(rows.map((r) => r.venueId));
    const truth = valid.filter((r) => venueIds.has(r.venueId) && r.verdict === 'menu');
    const pages = new Map(rows.flatMap((r) => r.pages.map((page) => [key(r.venueId, identity(r.venueId, page.url)), { ...page, url: identity(r.venueId, page.url), venueId: r.venueId }])));
    const discovered = new Map();
    for (const [k, page] of pages) {
      if (page.candidate && page.status === 200) discovered.set(k, { ...page, fetched: true });
      if (page.status !== 200) continue;
      for (const link of page.links ?? []) {
        if (!link.keyword && !/\.pdf(?:\?|$)/i.test(link.url)) continue;
        const url = identity(page.venueId, link.url);
        const linkKey = key(page.venueId, url);
        if (!discovered.has(linkKey)) discovered.set(linkKey, { venueId: page.venueId, url,
          sourceUrl: page.url, path: [...(page.path ?? []), link.url, ...(url === link.url ? [] : [url])], fetched: pages.has(linkKey) });
      }
    }
    const candidates = [...discovered];
    const truePositiveKeys = candidates.filter(([k]) => byKey.get(k)?.verdict === 'menu').map(([k]) => k);
    const falsePositiveKeys = candidates.filter(([k]) => byKey.get(k)?.verdict === 'not-menu').map(([k]) => k);
    const unjudged = candidates.filter(([k]) => !byKey.has(k)).map(([k]) => k);
    const misses = truth.filter((r) => !truePositiveKeys.includes(key(r.venueId, r.url)));
    const menuKeys = [...pages].filter(([k, p]) => p.status === 200 && byKey.get(k)?.verdict === 'menu').map(([k]) => k);
    const relevantPages = [...pages].filter(([k, p]) => p.status === 200 && byKey.get(k)?.relevant === true).length;
    const successfulPages = [...pages].filter(([, p]) => p.status === 200);
    const allSuccessfulPagesReviewed = successfulPages.every(([k]) => byKey.has(k));
    const reviewedPages = [...pages].filter(([k]) => byKey.has(k)).length;
    const priceKeys = menuKeys.filter((k) => !byKey.get(k).bodySha256 || byKey.get(k).bodySha256 === pages.get(k).bodySha256);
    const priceBodyMismatches = menuKeys.filter((k) => !priceKeys.includes(k) && byKey.get(k).priceRecords?.length)
      .map((k) => ({ venueId: pages.get(k).venueId, url: pages.get(k).url, fetchedSha256: pages.get(k).bodySha256, reviewedSha256: byKey.get(k).bodySha256 }));
    const prices = unique(priceKeys.flatMap((k) => (byKey.get(k)?.priceRecords ?? []).map((p) => `${pages.get(k).venueId}\t${p.id}`)));
    const requests = rows.reduce((n, r) => n + r.networkRequests, 0);
    const events = rows.flatMap((r) => r.events);
    const network = rows.flatMap((r) => r.requests);
    const wallSeconds = rows.reduce((n, r) => n + r.wallSeconds, 0);
    const durations = rows.map((r) => r.wallSeconds).sort((x, y) => x - y);
    const percentile = (p) => durations[Math.max(0, Math.ceil(durations.length * p) - 1)] ?? null;
    const nodeCpuSeconds = rows.reduce((n, r) => n + r.nodeCpuSeconds, 0);
    const childCpuSeconds = rows.reduce((n, r) => n + (r.childCpuSeconds ?? 0), 0);
    const parserCpuSeconds = rows.reduce((n, r) => n + (r.parserCpuSeconds ?? 0), 0);
    const bytes = network.reduce((n, r) => n + r.bytes, 0);
    const blockedReason = (e) => /refused|disallowed|unreadable|challenge|cooldown|terms-restrict/.test(e.reason);
    const blockedResponse = (r) => [429, 503].includes(r.status) || Boolean(r.retryAfter);
    const blockedPairs = unique(rows.flatMap((r) => [
      ...r.events.filter(blockedReason).map((e) => key(r.venueId, e.url)),
      ...r.requests.filter(blockedResponse).map((e) => key(r.venueId, e.url)),
    ]));
    const documentHashes = new Map();
    for (const k of truePositiveKeys) {
      const label = byKey.get(k);
      const hash = pages.get(k)?.bodySha256 ?? label.bodySha256;
      if (hash) { const group = key(label.venueId, hash); documentHashes.set(group, [...(documentHashes.get(group) ?? []), label.url]); }
    }
    const result = { arm, venues: rows.length, requests, candidates: candidates.length,
      reviewedPages, unjudgedCandidates: unjudged.length, truePositives: truePositiveKeys.length,
      falsePositives: falsePositiveKeys.length, falseNegatives: misses.length,
      precision: rate(truePositiveKeys.length, truePositiveKeys.length + falsePositiveKeys.length),
      precisionLowerBound: rate(truePositiveKeys.length, candidates.length),
      precisionUpperBound: rate(truePositiveKeys.length + unjudged.length, candidates.length),
      recall: rate(truePositiveKeys.length, truth.length),
      verifiedMenusFetched: menuKeys.length,
      verifiedMenuUrlsDiscovered: truePositiveKeys.length,
      verifiedPdfUrlsDiscovered: truePositiveKeys.filter((k) => byKey.get(k).format === 'pdf').length,
      verifiedHtmlUrlsDiscovered: truePositiveKeys.filter((k) => byKey.get(k).format === 'html').length,
      verifiedPdfDiscoveryVenues: unique(truePositiveKeys.filter((k) => byKey.get(k).format === 'pdf').map((k) => byKey.get(k).venueId)).length,
      verifiedHtmlDiscoveryVenues: unique(truePositiveKeys.filter((k) => byKey.get(k).format === 'html').map((k) => byKey.get(k).venueId)).length,
      pdfUrlRecall: rate(truePositiveKeys.filter((k) => byKey.get(k).format === 'pdf').length, truth.filter((r) => r.format === 'pdf').length),
      htmlUrlRecall: rate(truePositiveKeys.filter((k) => byKey.get(k).format === 'html').length, truth.filter((r) => r.format === 'html').length),
      verifiedPdfMenus: menuKeys.filter((k) => byKey.get(k).format === 'pdf').length,
      verifiedHtmlMenus: menuKeys.filter((k) => byKey.get(k).format === 'html').length,
      verifiedMenuVenues: unique(menuKeys.map((k) => pages.get(k).venueId)).length,
      relevantPagesPer100RequestsLowerBound: rate(relevantPages * 100, requests),
      relevantPagesPer100Requests: allSuccessfulPagesReviewed ? rate(relevantPages * 100, requests) : null,
      verifiedPriceRecords: prices.length,
      priceBodyMismatches,
      verifiedPriceRecordsPer100RequestsLowerBound: rate(prices.length * 100, requests),
      verifiedPriceRecordsPer100Requests: allSuccessfulPagesReviewed && candidates.length === truePositiveKeys.length + falsePositiveKeys.length
        && priceKeys.length === menuKeys.length && priceBodyMismatches.length === 0 && menuKeys.every((k) => byKey.get(k).priceReviewComplete === true) ? rate(prices.length * 100, requests) : null,
      fetchFailures: network.filter((r) => r.error).length,
      nativeFetchErrors: rows.reduce((n, r) => n + (r.nativeFetchErrors?.length ?? 0), 0),
      httpFailures: network.filter((r) => r.status >= 400).length,
      redirects: network.filter((r) => r.status >= 300 && r.status < 400).length,
      blockedResponses: network.filter(blockedResponse).length,
      duplicateDocumentUrlGroups: [...documentHashes].filter(([, urls]) => urls.length > 1).map(([id, urls]) => ({ venueId: id.split('\t')[0], bodySha256: id.split('\t')[1], urls })),
      blockedEvents: events.filter((r) => /refused|disallowed|unreadable|challenge|cooldown|terms-restrict/.test(r.reason)).length,
      blockedVenueUrlPairs: blockedPairs.length,
      blockedVenues: rows.filter((r) => r.events.some(blockedReason) || r.requests.some(blockedResponse)).length,
      blockReasons: Object.fromEntries(unique(events.map((r) => r.reason)).sort().map((reason) => [reason, events.filter((r) => r.reason === reason).length])),
      wallSecondsSum: wallSeconds, nodeCpuSeconds, nativeChildCpuSeconds: childCpuSeconds, parserCpuSeconds,
      wallSecondsMedian: percentile(0.5), wallSecondsP95: percentile(0.95),
      parserPeakRssBytes: Math.max(0, ...rows.map((r) => r.parserPeakRssBytes ?? 0)),
      nodePeakRssBytes: Math.max(0, ...rows.map((r) => r.nodePeakRssBytes)),
      nativeChildPeakRssBytes: Math.max(0, ...rows.map((r) => r.childPeakRssBytes ?? 0)),
      downloadBytes: bytes,
      missingUrls: misses.map((r) => ({ venueId: r.venueId, url: r.url, format: r.format,
        reason: r.format === 'image' ? 'image-menu-excluded-by-protocol'
          : !rows.find((v) => v.venueId === r.venueId)?.pages.some((p) => p.status === 200)
            && rows.find((v) => v.venueId === r.venueId)?.events.some(blockedReason) ? 'access-unavailable-during-paired-run'
            : pages.has(key(r.venueId, r.url)) ? 'fetched-but-not-identified' : 'not-discovered',
        fetched: pages.has(key(r.venueId, r.url)) })),
      falsePositiveUrls: falsePositiveKeys.map((k) => ({ venueId: discovered.get(k).venueId, url: discovered.get(k).url,
        fetched: pages.has(k), evidence: byKey.get(k).evidence ?? null })),
      verifiedUrls: truePositiveKeys.map((k) => ({ venueId: discovered.get(k).venueId, url: discovered.get(k).url,
        sourceUrl: discovered.get(k).sourceUrl, path: discovered.get(k).path, format: byKey.get(k).format,
        fetched: menuKeys.includes(k), bodySha256: pages.get(k)?.bodySha256 ?? byKey.get(k).bodySha256 ?? null,
        reviewer: byKey.get(k).reviewer })),
      note: 'Discovery includes fetched candidates and eligible menu links on captured pages. Retrieval is reported separately. Precision uses judged candidates. Recall uses the supplied gold inventory. Unjudged URLs stay unknown. Price lower bounds are not complete yields.',
    };
    output.push(result);
  }
  return output;
}

export function loadResults(run) {
  // Compact exports retain every field needed for offline evaluation, without response bodies.
  if (existsSync(resolve(run, 'venue-results.jsonl'))) {
    const lines = (name) => readFileSync(resolve(run, name), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const pages = lines('pages.jsonl');
    const requests = lines('requests.jsonl');
    const events = lines('access-events.jsonl');
    return lines('venue-results.jsonl').map((row) => ({ ...row,
      pages: pages.filter((p) => p.venueId === row.venueId && p.arm === row.arm),
      requests: requests.filter((p) => p.venueId === row.venueId && p.arm === row.arm),
      events: events.filter((p) => p.venueId === row.venueId && p.arm === row.arm),
    }));
  }
  const results = [];
  for (const venue of readdirSync(run, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const arm of ['A', 'B']) {
      const path = resolve(run, venue.name, arm, 'result.json');
      if (existsSync(path)) results.push(JSON.parse(readFileSync(path)));
    }
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runInput, labelsInput] = process.argv.slice(2);
  if (!runInput || !labelsInput) throw new Error('Usage: node evaluate.mjs RUN_DIRECTORY LABELS.json');
  const run = resolve(runInput);
  const annotations = JSON.parse(readFileSync(resolve(labelsInput)));
  if (!Array.isArray(annotations.labels)) throw new Error('Annotation file needs a labels array');
  for (const label of annotations.labels) {
    if (!['menu', 'not-menu', 'unresolved'].includes(label.verdict)) throw new Error(`Unknown verdict for ${label.url}`);
    if (!label.venueId || !label.url || !label.reviewer || !label.evidence) throw new Error(`Incomplete review evidence for ${label.url}`);
    if (label.verdict === 'menu' && !label.officialEvidence?.sourceUrl) throw new Error(`Menu needs official-site evidence: ${label.url}`);
    for (const price of label.priceRecords ?? []) {
      if (!label.bodySha256) throw new Error(`Price review needs a captured body hash: ${label.url}`);
      if (!price.id || !price.item || !Number.isFinite(price.amountGbp) || price.amountGbp <= 0 || price.currency !== 'GBP' || !price.evidence) {
        throw new Error(`Incomplete price record for ${label.url}`);
      }
    }
  }
  const results = loadResults(run);
  const protocol = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'protocol.json')));
  const summary = evaluate(results, annotations.labels);
  for (const arm of summary) {
    const rates = protocol.costAssumptions;
    const cpu = arm.nodeCpuSeconds + arm.nativeChildCpuSeconds + arm.parserCpuSeconds;
    const memoryGiB = (arm.nodePeakRssBytes + arm.nativeChildPeakRssBytes + arm.parserPeakRssBytes) / 1024 ** 3;
    arm.estimatedMeasuredComponentCost = {
      currency: rates.currency,
      cpu: cpu / 3600 * rates.cpuHour,
      memoryUpperScenario: memoryGiB * arm.wallSecondsSum / 3600 * rates.memoryGiBHour,
      download: arm.downloadBytes / 1024 ** 3 * rates.downloadGiB,
      total: cpu / 3600 * rates.cpuHour + memoryGiB * arm.wallSecondsSum / 3600 * rates.memoryGiBHour + arm.downloadBytes / 1024 ** 3 * rates.downloadGiB,
      excludes: ['coordinator CPU', 'human review', 'commercial licence', 'storage retention'],
      assumptions: rates,
    };
  }
  const primaryIds = new Set(annotations.primaryGoldVenueIds ?? []);
  const primaryGoldSummary = evaluate(results.filter((r) => primaryIds.has(r.venueId)), annotations.labels.filter((r) => primaryIds.has(r.venueId)));
  const a = summary.find((r) => r.arm === 'A');
  const b = summary.find((r) => r.arm === 'B');
  const ratio = (x, y) => x != null && y > 0 ? x / y : null;
  const relativeRecall = ratio(primaryGoldSummary.find((r) => r.arm === 'B')?.recall, primaryGoldSummary.find((r) => r.arm === 'A')?.recall);
  const primaryA = primaryGoldSummary.find((r) => r.arm === 'A');
  const primaryB = primaryGoldSummary.find((r) => r.arm === 'B');
  const priceRatio = ratio(primaryB?.verifiedPriceRecordsPer100Requests, primaryA?.verifiedPriceRecordsPer100Requests);
  const gates = protocol.adoptionGates;
  const humanReviews = (annotations.venueReviews ?? []).filter((r) => r.reviewerType === 'human' && r.inventoryComplete === true).length;
  const gateResults = {
    complete60SiteCohort: results.length === 120 && new Set(results.map((r) => r.venueId)).size === 60,
    humanGoldApproved: annotations.humanApproved === true && humanReviews >= gates.minHumanReviewedVenues,
    requestCaps: results.every((r) => r.networkRequests <= r.budget),
    relevanceRecallGain: relativeRecall == null ? null : relativeRecall >= 1 + gates.minRelativeVerifiedMenuRecallGain,
    candidatePrecision: primaryB && primaryB.precisionUpperBound < gates.minAbsolutePrecision ? false
      : primaryB && !primaryB.unjudgedCandidates ? primaryB.precision >= gates.minAbsolutePrecision : null,
    priceYieldGain: priceRatio == null ? null : priceRatio >= 1 + gates.minRelativeVerifiedPriceYieldGain,
    latencyRatio: a && b ? ratio(b.wallSecondsSum, a.wallSecondsSum) <= gates.maxLatencyRatio : null,
    measuredComponentCostRatio: a && b ? ratio(b.estimatedMeasuredComponentCost.total, a.estimatedMeasuredComponentCost.total) <= gates.maxEstimatedCostRatio : null,
    repeatedRun: annotations.repeatRunApproved === true,
    licenceDecision: annotations.licenceDecisionApproved === true,
    accessAudit: annotations.accessAuditApproved === true,
  };
  const passed = Object.values(gateResults).every((v) => v === true);
  const snapshot = `${JSON.stringify(annotations, null, 2)}\n`;
  const output = { schemaVersion: 1, annotationSnapshotSha256: sha256(snapshot), status: annotations.humanApproved ? 'reviewed-sample' : 'provisional-review',
    completeArms: results.length, humanApproved: annotations.humanApproved === true,
    summary, primaryGoldSummary, gateResults,
    recommendation: passed ? 'ADOPT_SUBJECT_TO_SEPARATE_INTEGRATION_AUTHORISATION' : 'REJECT_PRODUCTION_ADOPTION_PENDING_EVIDENCE',
    reason: passed ? 'The recorded evidence passes the declared gates. Integration still needs separate authorisation.'
      : 'At least one declared gate is false or unknown. Human gold approval, complete yields, repeat runs, access audit, and an AGPL integration decision must all pass.' };
  writeFileSync(resolve(run, 'evaluated-annotations.json'), snapshot);
  writeFileSync(resolve(run, 'comparison.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: resolve(run, 'comparison.json'), arms: results.length }));
}
