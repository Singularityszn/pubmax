export type OutingAlcoholPreference = "any" | "none" | "included";
export type OutingIntent = {
  area: string;
  date: string;
  time: string;
  groupSize: number | null;
  budgetGbp: number | null;
  alcohol: OutingAlcoholPreference;
};

type IntentParams = URLSearchParams | Record<string, string | string[] | undefined>;

function firstParam(params: IntentParams, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return typeof value === "string" ? value.trim() : Array.isArray(value) ? value[0]?.trim() ?? "" : "";
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function parsePositiveNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function parseOutingIntent(params: IntentParams): OutingIntent {
  const area = firstParam(params, "area").slice(0, 80);
  const rawDate = firstParam(params, "date");
  const date = validDate(rawDate) ? rawDate : "";
  const rawTime = firstParam(params, "time");
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rawTime) ? rawTime : "";
  const rawGroupSize = firstParam(params, "groupSize");
  const groupSize = /^\d{1,2}$/.test(rawGroupSize) && Number(rawGroupSize) >= 1 && Number(rawGroupSize) <= 30
    ? Number(rawGroupSize)
    : null;
  const budgetGbp = parsePositiveNumber(firstParam(params, "budgetGbp"), 5, 500);
  const alcoholRaw = firstParam(params, "alcohol");
  const alcohol: OutingAlcoholPreference = ["any", "none", "included"].includes(alcoholRaw)
    ? alcoholRaw as OutingAlcoholPreference
    : "any";
  return { area, date, time, groupSize, budgetGbp, alcohol };
}

export function outingIntentParams(intent: OutingIntent): URLSearchParams {
  const params = new URLSearchParams();
  if (intent.area) params.set("area", intent.area);
  if (intent.date) params.set("date", intent.date);
  if (intent.time) params.set("time", intent.time);
  if (intent.groupSize !== null) params.set("groupSize", String(intent.groupSize));
  if (intent.budgetGbp !== null) params.set("budgetGbp", String(intent.budgetGbp));
  if (intent.alcohol !== "any") params.set("alcohol", intent.alcohol);
  return params;
}
