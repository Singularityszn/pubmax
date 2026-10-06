import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  classifyChainPub,
  runCityEnrichment,
  selectCityPubs,
  type OsmPub,
  type TavilyEnrichmentResult,
} from "@/scripts/lib/tavilyPubEnrichment.mjs";
import { DAY_MS } from "@/lib/dayMs";
import type { SearchProvider } from "@/lib/searchProvider.server";
import {
  CONSECUTIVE_VENUE_FAILURE_LIMIT,
  DEFERRED_QUEUE_AGE_ALERT_MS,
  MAX_VENUE_ATTEMPTS,
  RETRY_QUERY_BUDGET,
  advanceCursor,
  cityEnrichmentHealth,
  emptyCityEnrichmentCheckpoint,
  planCityEnrichment,
  recordVenueFailure,
  recordVenueSuccess,
  releaseEnrichmentLease,
  requeueTerminalVenues,
  runLevelFailure,
  type CityEnrichmentCheckpoint,
  type CityEnrichmentHealth,
  type CityEnrichmentRunRecord,
} from "@/lib/cityEnrichmentCheckpoint";
import {
  cityEnrichmentCheckpointIsDurable,
  cityEnrichmentCheckpointStore,
  type CityEnrichmentCheckpointStore,
} from "@/lib/cityEnrichmentCheckpointStore.server";

// London leads the rotation. It was absent from it entirely until 2026-08-16,
// so no London pub had ever reached this seam, while the site's whole price
// story is a London one.
const CITY_ROTATION = [
  "london",
  "manchester",
  "birmingham",
  "edinburgh",
  "glasgow",
  "leeds",
  "bristol",
] as const;
// Provider requests run sequentially. Ten requests keep the daily function
// below Vercel's 120-second ceiling while the durable cursor preserves
// coverage across scheduled runs.
export const SEARCH_CRON_QUERY_CAP = 10;
/** Bristol nights 504 at the full cron cap; keep the city inside a smaller slice. */
export const BRISTOL_CRON_QUERY_CAP = 8;
/** Wall-clock bound so a slow Bristol lane cannot eat the whole function budget. */
export const BRISTOL_CRON_WALL_MS = 45_000;
/** Leave Vercel enough time to persist progress and return before 120 seconds. */
export const SEARCH_CRON_WALL_MS = 90_000;

type UkPack = { pubs?: OsmPub[] };

function loadUkPubs(): OsmPub[] {
  const filePath = path.join(process.cwd(), "data", "osm", "uk", "uk_osm_pubs.json");
  const pack = JSON.parse(readFileSync(filePath, "utf8")) as UkPack;
  return Array.isArray(pack.pubs) ? pack.pubs : [];
}

export type ScheduledCityEnrichment = TavilyEnrichmentResult & {
  startIndex: number;
  primaryCity: string;
  cityRuns?: ScheduledCityRunOutcome[];
  checkpoints?: CityEnrichmentHealth[];
  /**
   * Did the checkpoints this run wrote actually reach the durable store?
   *
   * TRI-STATE, and the null matters: a night where every city declined to
   * spend wrote nothing, and "we did not write" is not "we wrote to memory".
   * This is OBSERVED from the writes rather than inferred from credentials,
   * because the store falls back to memory when the table is absent and the
   * old credentials check reported a durable checkpoint over a queue that dies
   * with the function instance.
   */
  checkpointDurable?: boolean | null;
  /** Whether this deployment is CONFIGURED for a durable checkpoint. */
  checkpointExpectedDurable?: boolean;
};

type VenueOutcome = {
  index: number;
  osmId: string;
  status: "matched" | "empty" | "delegated" | "no-website" | "refused-source" | "failed";
  error?: string;
};

export type ScheduledEnrichmentProgress = {
  city: string;
  nextIndex: number;
  queriesSpent: number;
  creditsSpent: number;
  prices: TavilyEnrichmentResult["prices"];
  pages: TavilyEnrichmentResult["pages"];
  delegatedChains: TavilyEnrichmentResult["delegatedChains"];
  outcomes?: VenueOutcome[];
};

export type ScheduledCityRunOutcome = {
  city: string;
  ok: boolean;
  queriesSpent: number;
  creditsSpent: number;
  startIndex?: number;
  nextIndex?: number;
  matchedPubs?: number;
  pricesExtracted?: number;
  error?: string;
  /** Why this city did no work, when it did none. */
  skipped?: "lease-held" | "checkpoint-unavailable" | "no-eligible-pubs" | "out-of-time";
  retriesAttempted?: number;
  venuesDeferred?: number;
  venuesTerminal?: number;
  checkpointCommitted?: boolean;
  /** Where this city's checkpoint really landed. Null when it never wrote. */
  checkpointDurable?: boolean | null;
};

type RunScheduledOptions = {
  apiKey?: string;
  searchProvider?: SearchProvider;
  fetchImpl?: typeof fetch;
  now?: number;
  maxQueries?: number;
  onProgress?: (progress: ScheduledEnrichmentProgress) => void | Promise<void>;
};

type CityBatchResult = ScheduledCityEnrichment;

function eligibleCityPubs(city: string, allPubs: OsmPub[]): OsmPub[] {
  return selectCityPubs(city, allPubs).filter(
    (pub) => Boolean(pub.website) && !classifyChainPub(pub),
  );
}

function withWallClock<T>(
  promise: Promise<T>,
  wallMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`City enrichment timed out after ${wallMs}ms.`));
    }, wallMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * One pass of the core over a set of venues.
 *
 * `onVenueError` returning "continue" is what turns a venue's failure into a
 * fact about that venue instead of the end of the night. It refuses to do that
 * for a failure about us, and it stops the run once a provider has refused
 * `CONSECUTIVE_VENUE_FAILURE_LIMIT` venues in a row, which is an outage rather
 * than a run of bad pubs.
 */
type CoreRunInput = {
  city: string;
  pubs: OsmPub[];
  options: RunScheduledOptions;
  observedAt: string;
  maxQueries: number;
  startIndex?: number;
  indices?: number[];
  signal?: AbortSignal;
  onOutcomes: (outcomes: VenueOutcome[]) => void;
  /** A venue whose failure was about US. It records an outcome, and it is
   *  named here so the checkpoint never charges it an attempt. */
  onUnaskedVenue: (osmId: string) => void;
  onPartial: (progress: ScheduledEnrichmentProgress) => void;
  onProgress?: (progress: ScheduledEnrichmentProgress) => void | Promise<void>;
};

function runCore(input: CoreRunInput): Promise<TavilyEnrichmentResult> {
  let seenOutcomes = 0;
  let consecutiveFailures = 0;
  return runCityEnrichment({
    city: input.city,
    pubs: input.pubs,
    apiKey: input.options.apiKey,
    searchProvider: input.options.searchProvider,
    fetchImpl: input.options.fetchImpl,
    maxQueries: input.maxQueries,
    ...(input.indices ? { indices: input.indices } : { startIndex: input.startIndex ?? 0 }),
    observedAt: input.observedAt,
    signal: input.signal,
    onVenueError: ({ pub, error }: { pub: OsmPub; error: unknown }) => {
      if (runLevelFailure(error)) {
        // The core has already recorded this venue's outcome as failed, and
        // for a run-level failure that record is wrong about the venue: an
        // exhausted provider budget or an absent credential means the search
        // was never put. Charging the attempt anyway is how a venue nobody
        // ever asked about reaches the terminal cap over three bad nights.
        input.onUnaskedVenue(String(pub.osmId));
        return "abort";
      }
      consecutiveFailures += 1;
      return consecutiveFailures >= CONSECUTIVE_VENUE_FAILURE_LIMIT ? "abort" : "continue";
    },
    onProgress: async (state: Record<string, unknown>) => {
      // Past the wall clock this lane is finished with. A provider that keeps
      // going may not publish late progress into a run that has moved on.
      if (input.signal?.aborted) return;
      const outcomes = (state.outcomes as VenueOutcome[] | undefined) ?? [];
      if (outcomes.length > seenOutcomes) {
        const fresh = outcomes.slice(seenOutcomes);
        seenOutcomes = outcomes.length;
        if (fresh.some((outcome) => outcome.status !== "failed")) consecutiveFailures = 0;
        input.onOutcomes(fresh);
      }
      // Spend is recorded as it happens, so a lane that throws still reports
      // what it cost. Reading it off the return value alone would answer zero
      // for exactly the runs the spend question is asked about.
      input.onPartial(state as unknown as ScheduledEnrichmentProgress);
      if (input.signal?.aborted) return;
      await input.onProgress?.({
        city: input.city,
        ...(state as Omit<ScheduledEnrichmentProgress, "city">),
      });
    },
  }) as Promise<TavilyEnrichmentResult>;
}

function mergeCityResults(
  primaryCity: string,
  runs: readonly [CityBatchResult, ...CityBatchResult[]],
): ScheduledCityEnrichment {
  const primary = runs.find((run) => run.city === primaryCity) ?? runs[0];
  const prices = runs.flatMap((run) => run.prices);
  const pages = runs.flatMap((run) => run.pages);
  const delegatedChains = runs.flatMap((run) => run.delegatedChains);
  const queriesSpent = runs.reduce((sum, run) => sum + run.queriesSpent, 0);
  const creditsSpent = runs.reduce((sum, run) => sum + run.creditsSpent, 0);
  const matchedPubs = runs.reduce((sum, run) => sum + run.matchedPubs, 0);

  return {
    ...primary,
    city: primaryCity,
    primaryCity,
    prices,
    pages,
    delegatedChains,
    queriesSpent,
    creditsSpent,
    matchedPubs,
    complete: runs.every((run) => run.complete),
  };
}

export async function runScheduledCityEnrichment(
  options: RunScheduledOptions,
): Promise<ScheduledCityEnrichment> {
  const now = options.now ?? Date.now();
  const maxQueries = options.maxQueries ?? SEARCH_CRON_QUERY_CAP;
  const epochDay = Math.floor(now / DAY_MS);
  const primaryCity = CITY_ROTATION[epochDay % CITY_ROTATION.length] ?? CITY_ROTATION[0];
  const allPubs = loadUkPubs();
  const cityRuns: ScheduledCityRunOutcome[] = [];
  const mergeableRuns: CityBatchResult[] = [];
  const checkpoints: CityEnrichmentHealth[] = [];
  const runDeadline = Date.now() + SEARCH_CRON_WALL_MS;
  const store = cityEnrichmentCheckpointStore();

  const runTrackedCity = async (
    city: string,
    queryCap: number,
    cityWallMs = SEARCH_CRON_WALL_MS,
  ): Promise<CityBatchResult | null> => {
    const remainingWallMs = runDeadline - Date.now();
    if (remainingWallMs <= 0) {
      cityRuns.push({
        city,
        ok: false,
        queriesSpent: 0,
        creditsSpent: 0,
        skipped: "out-of-time",
        error: `City enrichment run timed out after ${SEARCH_CRON_WALL_MS}ms.`,
      });
      return null;
    }
    const outcome = await runCityWithCheckpoint({
      city,
      queryCap,
      wallMs: Math.min(cityWallMs, remainingWallMs),
      options,
      allPubs,
      now,
      store,
    });
    cityRuns.push(outcome.runOutcome);
    if (outcome.health) checkpoints.push(outcome.health);
    if (outcome.batch) mergeableRuns.push(outcome.batch);
    return outcome.runOutcome.ok ? outcome.batch : null;
  };

  const primaryCap =
    primaryCity === "bristol" ? Math.min(BRISTOL_CRON_QUERY_CAP, maxQueries) : maxQueries;
  const primaryWallMs = primaryCity === "bristol" ? BRISTOL_CRON_WALL_MS : SEARCH_CRON_WALL_MS;
  const primaryResult = await runTrackedCity(primaryCity, primaryCap, primaryWallMs);

  if (primaryCity === "bristol") {
    const spent = cityRuns.reduce((sum, run) => sum + run.queriesSpent, 0);
    let remainingBudget = maxQueries - spent;
    const spilloverCities = CITY_ROTATION.filter((city) => city !== "bristol");
    for (let index = 0; index < spilloverCities.length && remainingBudget > 0; index += 1) {
      const city = spilloverCities[index];
      if (!city) break;
      const citiesLeft = spilloverCities.length - index;
      const slice = Math.max(1, Math.ceil(remainingBudget / citiesLeft));
      const cap = Math.min(slice, remainingBudget);
      const result = await runTrackedCity(city, cap);
      if (result) {
        remainingBudget -= result.queriesSpent;
      } else {
        const failed = cityRuns.find((run) => run.city === city);
        remainingBudget -= failed?.queriesSpent ?? 0;
      }
    }
  }

  // A city that did no work because another run holds the lease, or because
  // the checkpoint could not be read, is not a failed night: it is a night
  // that correctly declined to spend. Only a real refusal alerts.
  const primaryOutcome = cityRuns.find((run) => run.city === primaryCity);
  const primaryDeclined = Boolean(primaryOutcome?.skipped);
  if (!primaryResult && primaryCity !== "bristol" && !primaryDeclined) {
    const message = primaryOutcome?.error ?? "City enrichment provider unavailable.";
    const error = new Error(message) as Error & {
      partial?: ScheduledEnrichmentProgress;
      cityRuns?: ScheduledCityRunOutcome[];
      checkpoints?: CityEnrichmentHealth[];
      checkpointDurable?: boolean | null;
      checkpointExpectedDurable?: boolean;
    };
    if (primaryOutcome) {
      error.partial = {
        city: primaryCity,
        nextIndex: primaryOutcome.nextIndex ?? primaryOutcome.startIndex ?? 0,
        queriesSpent: primaryOutcome.queriesSpent,
        creditsSpent: primaryOutcome.creditsSpent,
        prices: [],
        pages: [],
        delegatedChains: [],
      };
    }
    error.cityRuns = cityRuns;
    error.checkpoints = checkpoints;
    // A refused run has still committed its checkpoint, so it can still say
    // whether that checkpoint is real and whether the queue is draining. The
    // night the retry lane breaks is a night this path is taken.
    error.checkpointDurable = observedCheckpointDurability(cityRuns);
    error.checkpointExpectedDurable = cityEnrichmentCheckpointIsDurable();
    throw error;
  }

  const [firstRun, ...laterRuns] = mergeableRuns;
  const merged =
    firstRun
      ? mergeCityResults(primaryCity, [firstRun, ...laterRuns])
      : {
          city: primaryCity,
          primaryCity,
          totalPubs: eligibleCityPubs(primaryCity, allPubs).length,
          startIndex: 0,
          nextIndex: 0,
          queriesSpent: cityRuns.reduce((sum, run) => sum + run.queriesSpent, 0),
          creditsSpent: cityRuns.reduce((sum, run) => sum + run.creditsSpent, 0),
          matchedPubs: cityRuns.reduce((sum, run) => sum + (run.matchedPubs ?? 0), 0),
          prices: [],
          pages: [],
          delegatedChains: [],
          complete: false,
        };

  return {
    ...merged,
    cityRuns,
    checkpoints,
    checkpointDurable: observedCheckpointDurability(cityRuns),
    checkpointExpectedDurable: cityEnrichmentCheckpointIsDurable(),
  };
}

/**
 * What the writes said, folded into one answer. Null when no city wrote a
 * checkpoint at all, false the moment ONE landed in memory: a single volatile
 * city is a volatile queue, and rounding that up to true is how the fault this
 * function exists to surface stayed invisible.
 */
function observedCheckpointDurability(runs: ScheduledCityRunOutcome[]): boolean | null {
  const written = runs.filter((run) => typeof run.checkpointDurable === "boolean");
  if (written.length === 0) return null;
  return written.every((run) => run.checkpointDurable === true);
}

type CityRunInput = {
  city: string;
  queryCap: number;
  wallMs: number;
  options: RunScheduledOptions;
  allPubs: OsmPub[];
  now: number;
  store: CityEnrichmentCheckpointStore;
};

type CityRunResult = {
  runOutcome: ScheduledCityRunOutcome;
  batch: CityBatchResult | null;
  health: CityEnrichmentHealth | null;
};

/**
 * One city, from claiming its lease to committing what the run learned.
 *
 * The order matters. The lease is claimed BEFORE a query is spent, the cursor
 * advances only past venues whose outcome was recorded, and the commit happens
 * on every exit including a throw, so a run that dies mid-batch still leaves
 * the city further along than it found it.
 */
async function runCityWithCheckpoint(input: CityRunInput): Promise<CityRunResult> {
  const { city, options, allPubs, now, store } = input;
  const pubs = eligibleCityPubs(city, allPubs);
  const runId = `${city}-${randomUUID()}`;
  const startedAt = new Date(now).toISOString();

  if (pubs.length === 0) {
    return {
      runOutcome: { city, ok: true, queriesSpent: 0, creditsSpent: 0, skipped: "no-eligible-pubs" },
      batch: null,
      health: null,
    };
  }

  const claim = await store.claim({ city, totalPubs: pubs.length, owner: runId, now });
  if (claim.status === "lease-held") {
    return {
      runOutcome: {
        city,
        ok: true,
        queriesSpent: 0,
        creditsSpent: 0,
        skipped: "lease-held",
        error: `Lease held by ${claim.heldBy} until ${claim.expiresAt}.`,
      },
      batch: null,
      health: null,
    };
  }
  if (claim.status === "unavailable") {
    return {
      runOutcome: {
        city,
        ok: true,
        queriesSpent: 0,
        creditsSpent: 0,
        skipped: "checkpoint-unavailable",
        error: claim.reason,
      },
      batch: null,
      health: null,
    };
  }

  const claimedPasses = claim.checkpoint.passes;
  let checkpoint: CityEnrichmentCheckpoint = claim.checkpoint;
  const plan = planCityEnrichment(checkpoint, {
    now,
    queryBudget: input.queryCap,
    retryBudget: RETRY_QUERY_BUDGET,
  });

  const indexByOsmId = new Map<string, number>();
  pubs.forEach((pub, index) => indexByOsmId.set(String(pub.osmId), index));
  const retryIndices = plan.retryOsmIds
    .map((osmId) => indexByOsmId.get(osmId))
    .filter((index): index is number => typeof index === "number");
  // A deferred venue the pack no longer holds is not owed a retry. Drop it now
  // rather than carrying an id nothing can resolve for ever.
  for (const osmId of plan.retryOsmIds.filter((id) => !indexByOsmId.has(id))) {
    checkpoint = recordVenueSuccess(checkpoint, { osmId, now });
  }

  const observedAt = new Date(now).toISOString();
  const prices: TavilyEnrichmentResult["prices"] = [];
  const pages: TavilyEnrichmentResult["pages"] = [];
  const delegatedChains: TavilyEnrichmentResult["delegatedChains"] = [];
  let queriesSpent = 0;
  let creditsSpent = 0;
  let cursor = plan.startIndex;
  let runError: string | undefined;

  // Venues we actually READ this run. A run that read none of the venues it
  // asked about is a provider outage and still alerts, however many queries it
  // spent finding that out.
  let venuesRead = 0;
  // Venues whose failure was about US rather than about them. Their attempts
  // are not spent, so a budget-exhausted night costs no venue its retries.
  const unaskedVenues = new Set<string>();
  // The cursor is DERIVED from the outcomes of the fresh lane, never from the
  // lane's return value alone: a lane that threw still recorded outcomes, and
  // every venue whose outcome is recorded is a venue the cursor may pass.
  const applyOutcomes = (outcomes: VenueOutcome[], lane: "retry" | "fresh") => {
    for (const outcome of outcomes) {
      const osmId = String(outcome.osmId);
      if (outcome.status === "matched" || outcome.status === "empty") venuesRead += 1;
      // A venue whose search was never really put keeps its place in the
      // queue and its attempts, and the cursor does not pass it either: it is
      // owed the query this run could not spend.
      if (unaskedVenues.has(osmId)) continue;
      if (lane === "fresh") cursor = Math.max(cursor, outcome.index + 1);
      checkpoint =
        outcome.status === "failed"
          ? recordVenueFailure(checkpoint, { osmId, error: outcome.error ?? "unknown", now })
              .checkpoint
          : recordVenueSuccess(checkpoint, { osmId, now });
    }
  };

  const controller = new AbortController();
  const laneDeadline = Date.now() + input.wallMs;

  // One lane, whether it returns or throws. Its spend and its rows are taken
  // from the last progress it reported, so a lane killed by the wall clock is
  // accounted for exactly like one that finished.
  const runLane = async (lane: {
    indices?: number[];
    startIndex?: number;
    budget: number;
  }): Promise<TavilyEnrichmentResult | null> => {
    let partial: ScheduledEnrichmentProgress | null = null;
    let settled: TavilyEnrichmentResult | null = null;
    try {
      settled = await withWallClock(
        runCore({
          city,
          pubs,
          options,
          observedAt,
          maxQueries: lane.budget,
          ...(lane.indices ? { indices: lane.indices } : { startIndex: lane.startIndex ?? 0 }),
          signal: controller.signal,
          onOutcomes: (outcomes) => applyOutcomes(outcomes, lane.indices ? "retry" : "fresh"),
          onUnaskedVenue: (osmId) => unaskedVenues.add(osmId),
          onPartial: (state) => {
            partial = state;
          },
          onProgress: options.onProgress,
        }),
        Math.max(1, laneDeadline - Date.now()),
        // The provider may ignore the abort. The lane is never drained here,
        // or the wall-clock bound becomes an unbounded wait.
        () => controller.abort(),
      );
      return settled;
    } finally {
      // A lane that returned reports itself. A lane that threw is accounted
      // for from the last progress it published, which is the same running
      // total the return value would have carried.
      const spent: TavilyEnrichmentResult | ScheduledEnrichmentProgress | null =
        settled ?? partial;
      if (spent) {
        prices.push(...spent.prices);
        pages.push(...spent.pages);
        delegatedChains.push(...spent.delegatedChains);
        queriesSpent += spent.queriesSpent;
        creditsSpent += spent.creditsSpent;
      }
    }
  };

  try {
    // Retries first. A venue the last run could not read is owed its answer
    // before a venue nobody has looked at yet.
    if (retryIndices.length > 0) {
      await runLane({ indices: retryIndices, budget: retryIndices.length });
    }
    const freshBudget = Math.max(0, input.queryCap - queriesSpent);
    if (freshBudget > 0) {
      const result = await runLane({ startIndex: plan.startIndex, budget: freshBudget });
      if (result) cursor = Math.max(cursor, result.nextIndex);
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
  }

  checkpoint = advanceCursor(checkpoint, { nextIndex: cursor, totalPubs: pubs.length, now });

  const runRecord: CityEnrichmentRunRecord = {
    runId,
    startedAt,
    endedAt: new Date(now).toISOString(),
    // "partial" means some venues were READ and others were not. A run that
    // read none of them failed, whatever it spent finding that out.
    outcome: runError ? (venuesRead > 0 ? "partial" : "failed") : "ok",
    attempted: queriesSpent,
    succeeded: venuesRead,
    failed: checkpoint.deferred.length,
    deferredNow: checkpoint.deferred.length,
    terminalNow: checkpoint.terminal.length,
    queriesSpent,
    creditsSpent,
    matchedPubs: pages.length,
    pricesExtracted: prices.length,
    ...(runError ? { error: runError } : {}),
  };
  const released = releaseEnrichmentLease(checkpoint, { now, runRecord });
  const commit = await store.commit(released, runId);
  // Where the write LANDED, taken from the write. A commit that fell back to
  // memory reports false here however the deployment is configured, which is
  // the whole point: the retry queue is only real if the row is.
  const checkpointDurable = commit.status === "committed" ? commit.durable : claim.durable;

  return {
    batch: {
      city,
      primaryCity: city,
      totalPubs: pubs.length,
      startIndex: plan.startIndex,
      nextIndex: released.nextIndex,
      queriesSpent,
      creditsSpent,
      matchedPubs: pages.length,
      prices,
      pages,
      delegatedChains,
      complete: !runError && released.passes > claimedPasses,
    },
    health: cityEnrichmentHealth(released, now),
    runOutcome: {
      city,
      // A run that READ some venues is not a failed night, even when another
      // refused: that refusal is recorded and owed a bounded retry. A run that
      // read none of them is the provider being down, and it still alerts.
      ok: !runError || venuesRead > 0,
      queriesSpent,
      creditsSpent,
      startIndex: plan.startIndex,
      nextIndex: released.nextIndex,
      matchedPubs: pages.length,
      pricesExtracted: prices.length,
      retriesAttempted: retryIndices.length,
      venuesDeferred: released.deferred.length,
      venuesTerminal: released.terminal.length,
      checkpointCommitted: commit.status === "committed",
      checkpointDurable,
      ...(runError ? { error: runError } : {}),
    },
  };
}

/** The cities this cron rotates through. The moderator surface reads them all. */
export const ENRICHMENT_CITIES: readonly string[] = CITY_ROTATION;

/**
 * What the moderator surface prints: every city's checkpoint as it stands.
 * A city with no checkpoint yet answers its empty shape rather than being
 * absent, so "nobody has run this city" and "we could not read it" stay apart.
 */
export async function readCityEnrichmentHealth(
  now = Date.now(),
): Promise<{
  durable: boolean;
  expectedDurable: boolean;
  queueAgeAlertMs: number;
  citiesWithAgedQueue: string[];
  cities: CityEnrichmentHealth[];
}> {
  const allPubs = loadUkPubs();
  const store = cityEnrichmentCheckpointStore();
  const cities: CityEnrichmentHealth[] = [];
  let durable = true;
  for (const city of CITY_ROTATION) {
    const totalPubs = eligibleCityPubs(city, allPubs).length;
    const read = await store.read(city, totalPubs, now);
    if (!read.durable) durable = false;
    cities.push(
      cityEnrichmentHealth(
        read.checkpoint ?? emptyCityEnrichmentCheckpoint(city, totalPubs, now),
        now,
      ),
    );
  }
  return {
    // OBSERVED from the reads, never from the credentials. A surface that
    // reported a durable checkpoint over a memory fallback is what let a
    // retry queue evaporate nightly with nothing saying so.
    durable,
    expectedDurable: cityEnrichmentCheckpointIsDurable(),
    queueAgeAlertMs: DEFERRED_QUEUE_AGE_ALERT_MS,
    citiesWithAgedQueue: cities.filter((city) => city.queueAgeAlert).map((city) => city.city),
    cities,
  };
}

/**
 * The retry path a terminal failure is recorded with. Named venues, or every
 * refused venue in the city, return to the deferred list due immediately.
 */
export async function requeueCityEnrichmentTerminals(
  city: string,
  options: { osmIds?: string[]; now?: number } = {},
): Promise<{ ok: boolean; requeued: string[]; reason?: string }> {
  if (!ENRICHMENT_CITIES.includes(city)) {
    return { ok: false, requeued: [], reason: "unknown-city" };
  }
  const now = options.now ?? Date.now();
  const totalPubs = eligibleCityPubs(city, loadUkPubs()).length;
  const store = cityEnrichmentCheckpointStore();
  const { checkpoint } = await store.read(city, totalPubs, now);
  if (!checkpoint) return { ok: true, requeued: [] };
  const moved = requeueTerminalVenues(checkpoint, { now, osmIds: options.osmIds });
  if (moved.requeued.length === 0) return { ok: true, requeued: [] };
  const saved = await store.save(moved.checkpoint);
  if (saved.status !== "committed") {
    return { ok: false, requeued: [], reason: saved.status };
  }
  return { ok: true, requeued: moved.requeued };
}

export {
  CONSECUTIVE_VENUE_FAILURE_LIMIT,
  DEFERRED_QUEUE_AGE_ALERT_MS,
  MAX_VENUE_ATTEMPTS,
  RETRY_QUERY_BUDGET,
};
