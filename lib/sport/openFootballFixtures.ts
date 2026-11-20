import type { SportFixture } from "../../scripts/whatson/sportFixtures.d.mts";
import { londonWallClockToIso } from "../../scripts/whatson/sportFixtures.mjs";
import { openDataSourceUrl } from "@/lib/harvest/sourcePolicy";
import { OPEN_FOOTBALL_SOURCE_MAX_AGE_MS } from "@/lib/whatsOn";

type Match = { date?: unknown; time?: unknown; team1?: unknown; team2?: unknown; score?: unknown };

export async function fetchOpenFootballFixtures(opts: {
  now: number;
  endMs: number;
  fetchImpl?: typeof fetch;
}): Promise<SportFixture[]> {
  const yearParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric" }).formatToParts(new Date(opts.now));
  const year = Number(yearParts.find((part) => part.type === "year")?.value);
  const month = Number(yearParts.find((part) => part.type === "month")?.value);
  const startYear = month >= 7 ? year : year - 1;
  const path = `${startYear}-${String(startYear + 1).slice(-2)}/en.1.json`;
  const read = opts.fetchImpl ?? fetch;
  const init: RequestInit = { headers: { accept: "application/vnd.github.raw+json", "user-agent": "PubmaxxingBot/0.1 (+https://pubmaxxing.com)" }, redirect: "error", signal: AbortSignal.timeout(8000) };
  const history = await read(openDataSourceUrl("openfootball-fixtures", `commits?path=${encodeURIComponent(path)}&per_page=1`), init);
  if (!history.ok) throw new Error(`OpenFootball history returned ${history.status}`);
  const commits = await history.json() as Array<{ sha?: unknown; commit?: { committer?: { date?: unknown } } }>;
  const commit = commits[0];
  const updated = typeof commit?.commit?.committer?.date === "string" ? Date.parse(commit.commit.committer.date) : NaN;
  const sha = commit?.sha;
  if (!Number.isFinite(updated) || updated > opts.now || opts.now - updated > OPEN_FOOTBALL_SOURCE_MAX_AGE_MS || typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)) return [];
  const response = await read(openDataSourceUrl("openfootball-fixtures", `contents/${path}?ref=${sha}`), init);
  if (!response.ok) throw new Error(`OpenFootball fixtures returned ${response.status}`);
  const payload = await response.json() as { matches?: unknown };
  if (!Array.isArray(payload.matches)) throw new Error("OpenFootball fixtures are invalid");
  return (payload.matches as Match[]).flatMap((match) => {
    if (typeof match.date !== "string" || typeof match.time !== "string" || typeof match.team1 !== "string" || typeof match.team2 !== "string" || match.score != null) return [];
    const kickoff = londonWallClockToIso(match.date, match.time);
    if (!kickoff) return [];
    const ms = Date.parse(kickoff);
    const saturday = new Date(`${match.date}T12:00:00Z`).getUTCDay() === 6;
    if (!Number.isFinite(ms) || ms < opts.now || ms > opts.endMs || (saturday && match.time >= "14:45" && match.time < "17:15")) return [];
    return [{ id: `of-${match.date}-${match.team1}-${match.team2}`, title: `${match.team1} v ${match.team2} - Premier League`, competition: "Premier League", venue: "TBC", kickoffLondonDate: match.date, kickoffLondonTime: match.time, source: { label: "OpenFootball", url: "https://github.com/openfootball/football.json" }, sourceUpdatedAt: new Date(updated).toISOString() }];
  });
}
