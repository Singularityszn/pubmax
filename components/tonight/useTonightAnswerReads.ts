"use client";

// The three small reads behind Tonight's answer cards. Each one starts only
// when its card needs it, settles once, and owns nothing the page does not
// already know.
//
// 1. The pubs within a walk of the reader, from the same slim venue cells the
//    map and /near read (lib/slimShards.ts), and only once a position or a
//    remembered area exists. No position, no read: the card answers from the
//    city's cheapest listed pint the page already holds.
// 2. The regular nights, from the three committed what's-on files, and only
//    when the what's-on read has no confirmed listing to show.
// 3. The last train, through the same /api/last-train read the get-home strip
//    makes. The surface cache joins the two into one request.
//
// React 19: every setState lands in an async resolution, never in the effect
// body, and an AbortController or a cancelled flag drops a late answer.

import { useEffect, useState } from "react";

import { coarsenViewerPoint } from "@/lib/geo";
import {
  parseRegularNights,
  REGULAR_NIGHT_SOURCE_PATHS,
  type RegularNight,
} from "@/lib/regularNights";
import type { SlimShardLoader } from "@/lib/slimShards";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import type { LastTrainResult } from "@/lib/tfl";
import type { TonightCheapestCandidate } from "@/lib/tonightAnswers";
import { summariseGetHome, type GetHomeSummary } from "@/lib/tonightGetHome";

type Coord = { lat: number; lng: number };

const EMPTY: readonly TonightCheapestCandidate[] = [];

// One loader for the page's life, made on first use. The shard loader is
// imported only then, so a reader who never shares a position or remembers an
// area downloads none of it.
let nearbyLoader: Promise<SlimShardLoader> | null = null;

function tonightSlimLoader(): Promise<SlimShardLoader> {
  nearbyLoader ??= import("@/lib/slimShards").then(({ createSlimShardLoader }) =>
    createSlimShardLoader("london"),
  );
  return nearbyLoader;
}

/** Priced pubs from the slim cells around `near`; an empty list until they land. */
export function useTonightNearbyVenues(near: Coord | null): readonly TonightCheapestCandidate[] {
  const [answer, setAnswer] = useState<{ key: string; rows: TonightCheapestCandidate[] } | null>(null);
  const lat = near?.lat ?? null;
  const lng = near?.lng ?? null;
  const key = lat === null || lng === null ? null : `${lat.toFixed(3)},${lng.toFixed(3)}`;

  useEffect(() => {
    if (lat === null || lng === null || key === null) return;
    let cancelled = false;
    void tonightSlimLoader()
      .then((loader) => loader.nearPoint(lat, lng))
      .then(
        (result) => {
          if (cancelled) return;
          setAnswer({
            key,
            rows: result.rows.filter((venue) => typeof venue.cheapestPrice === "number"),
          });
        },
        () => {
          // A loader that could not load leaves the card on the city's answer.
          if (!cancelled) setAnswer({ key, rows: [] });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [lat, lng, key]);

  return answer && answer.key === key ? answer.rows : EMPTY;
}

export type RegularNightsRead = {
  status: "idle" | "loading" | "ready" | "failed";
  nights: readonly RegularNight[];
};

type RegularNightFileName = keyof typeof REGULAR_NIGHT_SOURCE_PATHS;

const REGULAR_NIGHT_FILES = Object.entries(REGULAR_NIGHT_SOURCE_PATHS) as Array<
  [RegularNightFileName, string]
>;

// A committed what's-on file is an object carrying a rows array.
function isRowsFile(value: unknown): boolean {
  return Boolean(
    value && typeof value === "object" && Array.isArray((value as { rows?: unknown }).rows),
  );
}

// The files move only with a deploy, so a day-old held copy is still the file.
const REGULAR_NIGHTS_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * The regular nights, read once `enabled` turns true, through the shared
 * surface cache so a return visit paints from the held files. A failed read
 * is `failed`, never an empty week: the block then says it could not look.
 */
export function useRegularNights(enabled: boolean): RegularNightsRead {
  const [read, setRead] = useState<RegularNightsRead>({ status: "idle", nights: [] });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const held: Partial<Record<RegularNightFileName, unknown>> = {};
    let published = false;
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setRead((current) => (current.status === "ready" ? current : { status: "loading", nights: [] }));
      }
    });
    const publish = () => {
      if (REGULAR_NIGHT_FILES.some(([name]) => held[name] === undefined)) return;
      published = true;
      setRead({ status: "ready", nights: parseRegularNights(held) });
    };
    void Promise.all(
      REGULAR_NIGHT_FILES.map(([name, path]) =>
        loadSurfaceJson<unknown>(
          path,
          { signal: controller.signal, validate: isRowsFile, maxAgeMs: REGULAR_NIGHTS_MAX_AGE_MS },
          (value) => {
            held[name] = value;
            publish();
          },
        ),
      ),
    ).then((outcomes) => {
      if (controller.signal.aborted || published) return;
      if (outcomes.some((outcome) => outcome === "failed")) {
        setRead({ status: "failed", nights: [] });
      }
    });
    return () => controller.abort();
  }, [enabled]);

  return read;
}

export type LastTrainRead =
  | { status: "no-location" }
  | { status: "loading" }
  | { status: "ready"; summary: GetHomeSummary }
  | { status: "none" };

/** The last-train line for a shared position, through the strip's own read. */
export function useLastTrainSummary(origin: Coord | null): LastTrainRead {
  const [answer, setAnswer] = useState<{ key: string; read: LastTrainRead } | null>(null);
  const point = origin ? coarsenViewerPoint(origin) : null;
  const key = point ? `/api/last-train?lat=${point.lat}&lng=${point.lng}` : null;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    void loadSurfaceJson<LastTrainResult>(
      key,
      {
        signal: controller.signal,
        validate: (body) =>
          Boolean(body && typeof body === "object" && "station" in body && "trains" in body),
      },
      (body) => {
        const summary = summariseGetHome(body);
        setAnswer({ key, read: summary ? { status: "ready", summary } : { status: "none" } });
      },
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) {
        setAnswer({ key, read: { status: "none" } });
      }
    });
    return () => controller.abort();
  }, [key]);

  if (key === null) return { status: "no-location" };
  return answer && answer.key === key ? answer.read : { status: "loading" };
}
