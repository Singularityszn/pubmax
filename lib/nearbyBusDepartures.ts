export const BUS_PREDICTION_MAX_AGE_MS = 2 * 60_000;
export const BUS_DEPARTURE_HORIZON_MS = 60 * 60_000;

// TfL stamps every prediction in a response from its own clock, so a second or
// two of skew ahead of ours must not throw the whole response away. The stale
// ceiling above is untouched by this tolerance.
export const BUS_PREDICTION_FUTURE_TOLERANCE_MS = 5_000;

// Upstream budget. The route owns its own unavailable answer only while these
// add up to less than its declared maxDuration.
export const BUS_STOP_LOOKUP_TIMEOUT_MS = 4_000;
export const BUS_STOP_LOOKUP_RETRIES = 1;
export const BUS_ARRIVALS_TIMEOUT_MS = 5_000;
export const BUS_UPSTREAM_BUDGET_MS =
  BUS_STOP_LOOKUP_TIMEOUT_MS * (BUS_STOP_LOOKUP_RETRIES + 1) +
  BUS_ARRIVALS_TIMEOUT_MS;

// Client cadence. The clock tick keeps a minute-resolution countdown true; the
// refresh interval is what asks TfL again, and only ever while the card is on
// screen.
export const BUS_DEPARTURES_TICK_MS = 15_000;
export const BUS_DEPARTURES_REFRESH_MS = 30_000;
// A check old enough to name, and the age past which a counted-down minute
// figure stops being a claim we can stand behind.
export const BUS_DEPARTURES_AGE_NOTE_MS = 60_000;
export const BUS_DEPARTURES_OUT_OF_DATE_MS = BUS_PREDICTION_MAX_AGE_MS;

export type BusDirection = "inbound" | "outbound" | null;

export type TflBusPrediction = {
  naptanId?: string;
  lineName?: string;
  destinationName?: string;
  direction?: string;
  timestamp?: string;
  expectedArrival?: string;
};

export type FreshBusPrediction = {
  naptanId: string;
  lineName: string;
  destinationName: string;
  direction: BusDirection;
  expectedArrival: string;
  dueMinutes: number;
};

export type NearbyBusDeparture = Omit<FreshBusPrediction, "naptanId">;

export type NearbyBusStop = {
  id: string;
  name: string;
  indicator: string | null;
  towards: string | null;
  distanceM: number;
  departures: NearbyBusDeparture[];
};

export type NearbyBusDeparturesResult = {
  status: "ready" | "unavailable";
  stops: NearbyBusStop[];
  generatedAt: string;
};

export function freshBusPredictions(
  predictions: TflBusPrediction[],
  now: Date,
): FreshBusPrediction[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];

  const fresh: FreshBusPrediction[] = [];
  for (const prediction of predictions) {
    const naptanId = prediction.naptanId?.trim() ?? "";
    const lineName = prediction.lineName?.trim() ?? "";
    const destinationName = prediction.destinationName?.trim() ?? "";
    if (!naptanId || !lineName || !destinationName) continue;

    const predictionAt = Date.parse(prediction.timestamp ?? "");
    const expectedAt = Date.parse(prediction.expectedArrival ?? "");
    if (!Number.isFinite(predictionAt) || !Number.isFinite(expectedAt)) continue;

    const ageMs = nowMs - predictionAt;
    const dueMs = expectedAt - nowMs;
    if (
      ageMs < -BUS_PREDICTION_FUTURE_TOLERANCE_MS ||
      ageMs > BUS_PREDICTION_MAX_AGE_MS
    ) {
      continue;
    }
    if (dueMs <= 0 || dueMs > BUS_DEPARTURE_HORIZON_MS) continue;

    const direction =
      prediction.direction === "inbound" || prediction.direction === "outbound"
        ? prediction.direction
        : null;
    fresh.push({
      naptanId,
      lineName,
      destinationName,
      direction,
      expectedArrival: new Date(expectedAt).toISOString(),
      dueMinutes: Math.ceil(dueMs / 60_000),
    });
  }

  return fresh.sort(
    (a, b) => Date.parse(a.expectedArrival) - Date.parse(b.expectedArrival),
  );
}

export type BusDeparturesFreshness =
  | { state: "live"; ageMinutes: number }
  | { state: "ageing"; ageMinutes: number }
  | { state: "out-of-date"; ageMinutes: number | null };

/**
 * How much a rendered set of departures can still claim.
 *
 * A check we cannot date is out of date: silence about when it happened is not
 * evidence that it just happened.
 */
export function busDeparturesFreshness(
  generatedAt: string,
  now: Date,
): BusDeparturesFreshness {
  const generatedMs = Date.parse(generatedAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(generatedMs) || !Number.isFinite(nowMs)) {
    return { state: "out-of-date", ageMinutes: null };
  }

  const ageMs = Math.max(0, nowMs - generatedMs);
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMs > BUS_DEPARTURES_OUT_OF_DATE_MS) {
    return { state: "out-of-date", ageMinutes };
  }
  if (ageMs >= BUS_DEPARTURES_AGE_NOTE_MS) return { state: "ageing", ageMinutes };
  return { state: "live", ageMinutes };
}

/**
 * Minutes until an arrival, read from the arrival's own absolute time.
 *
 * Never derived from a previously rendered relative figure, so a countdown
 * ages instead of freezing at whatever it said when the response landed.
 */
export function departureDueMinutes(
  expectedArrival: string,
  now: Date,
): number | null {
  const expectedMs = Date.parse(expectedArrival);
  const nowMs = now.getTime();
  if (!Number.isFinite(expectedMs) || !Number.isFinite(nowMs)) return null;
  return Math.ceil((expectedMs - nowMs) / 60_000);
}

/** Live departures are only worth asking for while somebody can see them. */
export function shouldPollBusDepartures(input: {
  open: boolean;
  documentVisible: boolean;
}): boolean {
  return input.open && input.documentVisible;
}

/**
 * Run one load now, tick a clock, and re-load on the refresh cadence until the
 * returned stop is called. Stopping clears the interval and aborts whatever is
 * in flight, so a closed disclosure, a hidden document, or an unmounted sheet
 * costs nothing. Loads never overlap.
 */
export function startBusDeparturesPoll({
  tickMs = BUS_DEPARTURES_TICK_MS,
  refreshMs = BUS_DEPARTURES_REFRESH_MS,
  now = () => Date.now(),
  onTick,
  load,
}: {
  tickMs?: number;
  refreshMs?: number;
  now?: () => number;
  onTick: (nowMs: number) => void;
  load: (signal: AbortSignal) => Promise<void>;
}): () => void {
  const controller = new AbortController();
  let inFlight = false;
  let lastLoadAt = now();

  const run = () => {
    if (inFlight || controller.signal.aborted) return;
    inFlight = true;
    lastLoadAt = now();
    const settle = () => {
      inFlight = false;
    };
    void load(controller.signal).then(settle, settle);
  };

  run();
  const timer = setInterval(() => {
    if (controller.signal.aborted) return;
    const at = now();
    onTick(at);
    if (at - lastLoadAt >= refreshMs) run();
  }, tickMs);

  return () => {
    clearInterval(timer);
    controller.abort();
  };
}
