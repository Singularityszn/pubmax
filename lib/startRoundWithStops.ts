// Mint a Round and optionally seed its stops from a Plan (map route). Used by
// RoundStarter on /crawls and in the Plan drawer. Stops are added sequentially
// so addStop stays idempotent and order matches the plan.

import type { RoundState } from "@/lib/rounds";

export type SeedStop = { id: string; name: string };

export type StartRoundWithStopsResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

type FetchLike = typeof fetch;

/**
 * POST /api/rounds, then optionally POST addStop for each seed stop, then
 * return the join code. Caller owns localStorage + navigation.
 */
export async function startRoundWithStops(input: {
  handle: string;
  title?: string;
  seedStops?: SeedStop[];
  fetchImpl?: FetchLike;
}): Promise<StartRoundWithStopsResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body: { handle: string; title?: string } = { handle: input.handle };
  if (input.title?.trim()) body.title = input.title.trim();

  let createRes: Response;
  try {
    createRes = await fetchImpl("/api/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Could not start the Round. Try again." };
  }

  let createData: RoundState | { error: string };
  try {
    createData = (await createRes.json()) as RoundState | { error: string };
  } catch {
    return { ok: false, error: "Could not start the Round. Try again." };
  }

  if (!createRes.ok) {
    return {
      ok: false,
      error: (createData as { error: string }).error ?? "Could not start the Round.",
    };
  }

  const code = (createData as RoundState).round.code;
  const seeds = input.seedStops?.filter((s) => s.id && s.name) ?? [];

  for (const stop of seeds) {
    try {
      const stopRes = await fetchImpl(`/api/rounds/${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addStop",
          handle: input.handle,
          venueId: stop.id,
          venueName: stop.name,
        }),
      });
      // Idempotent addStop — soft-fail individual stops so a flaky one doesn't
      // strand the Round; the group can still walk / re-add.
      if (!stopRes.ok) {
        // continue seeding remaining stops
      }
    } catch {
      // network blip on one stop — keep going
    }
  }

  return { ok: true, code };
}
