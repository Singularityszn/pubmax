/* Service Usage quota and Monitoring calls shared by the London Places verifiers. */
import { execFileSync } from "node:child_process";

const PROJECT = "projects/590118888791";
const SERVICE = `${PROJECT}/services/places.googleapis.com`;
const SEARCH_METRIC = "places.googleapis.com/SearchTextRequest";
const DETAILS_METRIC = "places.googleapis.com/GetPlaceRequest";
const DAILY_UNIT = "1/d/{project}";

function accessToken() {
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

async function apiJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 180) };
    }
  }
  if (!response.ok) {
    const message = body.error?.message ?? body.raw ?? `HTTP ${response.status}`;
    throw new Error(`serviceusage ${response.status}: ${message}`);
  }
  return body;
}

function limitUrl(metric) {
  return `https://serviceusage.googleapis.com/v1beta1/${SERVICE}/consumerQuotaMetrics/${encodeURIComponent(metric)}/limits/%2Fd%2Fproject`;
}

async function dailyOverrideValue(token, metric) {
  const body = await apiJson(`${limitUrl(metric)}/consumerOverrides`, token);
  const override = (body.overrides ?? [])[0];
  if (!override?.overrideValue) {
    throw new Error(`missing daily override for ${metric}`);
  }
  return override.overrideValue;
}

async function effectiveDailyLimit(token, metric) {
  const body = await apiJson(limitUrl(metric), token);
  const bucket = (body.quotaBuckets ?? [])[0];
  return bucket?.effectiveLimit ?? null;
}

async function waitOperation(token, operation) {
  let current = operation;
  for (let attempt = 0; attempt < 30 && !current.done; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    current = await apiJson(
      `https://serviceusage.googleapis.com/v1beta1/${current.name}`,
      token,
    );
  }
  if (!current.done) throw new Error("quota override operation timed out");
  if (current.error) throw new Error(`quota override failed: ${current.error.message ?? "unknown"}`);
}

async function setDailyOverrides(token, searchValue, detailsValue, reason = "london-osm-places-verify") {
  const operation = await apiJson(
    `https://serviceusage.googleapis.com/v1beta1/${SERVICE}/consumerQuotaMetrics:importConsumerOverrides`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        force: true,
        inlineSource: {
          overrides: [
            { metric: SEARCH_METRIC, unit: DAILY_UNIT, overrideValue: String(searchValue) },
            { metric: DETAILS_METRIC, unit: DAILY_UNIT, overrideValue: String(detailsValue) },
          ],
        },
      }),
      headers: { "X-Goog-Request-Reason": reason },
    },
  );
  if (operation.name) await waitOperation(token, operation);
}

async function monthPlacesRequests(token, detailsOnly = false) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const params = new URLSearchParams({
    filter: 'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.labels.service="places.googleapis.com"',
    "interval.startTime": start.toISOString(),
    "interval.endTime": new Date().toISOString(),
    "aggregation.alignmentPeriod": "2678400s",
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    ...(detailsOnly ? {} : { "aggregation.crossSeriesReducer": "REDUCE_SUM" }),
  });
  const body = await apiJson(
    `https://monitoring.googleapis.com/v3/projects/pubmaxx/timeSeries?${params}`,
    token,
  );
  let total = 0;
  for (const series of body.timeSeries ?? []) {
    if (detailsOnly && series.resource?.labels?.method !== "google.maps.places.v1.Places.GetPlace") continue;
    for (const point of series.points ?? []) {
      total += Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0);
    }
  }
  return total;
}


export { accessToken, dailyOverrideValue, effectiveDailyLimit, setDailyOverrides, monthPlacesRequests, SEARCH_METRIC, DETAILS_METRIC };
