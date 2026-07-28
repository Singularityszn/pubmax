export const BUS_PREDICTION_MAX_AGE_MS = 2 * 60_000;
export const BUS_DEPARTURE_HORIZON_MS = 60 * 60_000;

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
    if (ageMs < 0 || ageMs > BUS_PREDICTION_MAX_AGE_MS) continue;
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
