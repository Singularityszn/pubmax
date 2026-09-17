import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";
import {
  loadPublicPintIndexSnapshot,
  loadPublicPintIndexSnapshotOrThrow,
} from "@/lib/publicPintIndexSnapshot.server";
import type { PintIndexSnapshot } from "@/lib/pintIndex";

const EMPTY: PintIndexSnapshot = {
  schemaVersion: 1,
  snapshotId: "empty-loader-fixture",
  status: "empty",
  generatedAt: "2026-09-12T00:00:00.000Z",
  observationWindow: null,
  classification: {
    version: LONDON_BOROUGH_CLASSIFIER_VERSION,
    method: "point_in_polygon",
    sourceArtifact: "data/london_boroughs_simplified.json",
    licence: "Open Government Licence v3.0",
  },
  sources: [],
  observations: [],
  excluded: [],
};

describe("public Pint Index snapshot reads", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts valid empty data in both loader contracts", async () => {
    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(EMPTY));
    await expect(loadPublicPintIndexSnapshot()).resolves.toEqual(EMPTY);
    await expect(loadPublicPintIndexSnapshotOrThrow()).resolves.toEqual(EMPTY);
  });

  it.each([
    { name: "missing file", value: new Error("ENOENT") },
    { name: "unreadable file", value: new Error("EACCES") },
    { name: "invalid JSON", value: "{" },
    { name: "invalid schema", value: "{}" },
  ])("keeps $name separate from empty and retries the next read", async ({ value }) => {
    const read = vi.spyOn(fs, "readFile");
    if (value instanceof Error) read.mockRejectedValue(value);
    else read.mockResolvedValue(value);

    await expect(loadPublicPintIndexSnapshot()).resolves.toBeNull();
    await expect(loadPublicPintIndexSnapshotOrThrow()).rejects.toThrow("Public Pint Index snapshot is unavailable");

    read.mockResolvedValue(JSON.stringify(EMPTY));
    await expect(loadPublicPintIndexSnapshotOrThrow()).resolves.toEqual(EMPTY);
    expect(read).toHaveBeenCalledTimes(3);
  });
});
