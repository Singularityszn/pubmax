// The ONE Open-Meteo WMO weather code to condition table. The cron provider
// (lib/weatherProvider.ts) and the scheduled refresh script
// (scripts/refresh_weather_snapshots.mjs) both read it. Plain ESM with no
// imports, so the script can load it without a build step.

/** @param {number} code */
export function conditionForCode(code) {
  if (code === 0) return "Clear";
  if ([1, 2, 3].includes(code)) return "Cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return `Weather code ${code}`;
}
