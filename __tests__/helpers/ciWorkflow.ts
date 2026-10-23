import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { defined } from "@/__tests__/helpers/defined";

type CiStep = {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

type CiJob = {
  name?: string;
  strategy?: { matrix?: { shard?: number[] }; "max-parallel"?: number };
  steps?: CiStep[];
};

/** The jobs in `.github/workflows/ci.yml`, as GitHub reads them. */
export function ciJobs(): Record<string, CiJob> {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  return (parse(workflow) as { jobs: Record<string, CiJob> }).jobs;
}

export function jobStep(job: CiJob, name: string): CiStep {
  return defined(
    job.steps?.find((step) => step.name === name),
    `step "${name}"`,
  );
}

type UnitShard = {
  shard: number;
  total: number;
  words: string[];
  env: Record<string, string>;
};

/**
 * The words each unit shard's coverage step runs, with that shard's matrix
 * value in place of `${{ matrix.shard }}`.
 */
export function unitShards(): UnitShard[] {
  const job = defined(ciJobs()["unit-tests"], "unit-tests job");
  const step = jobStep(job, "Unit tests with coverage");
  const shards = defined(job.strategy?.matrix?.shard, "unit-tests shard matrix");
  return shards.map((shard) => ({
    shard,
    total: shards.length,
    words: defined(step.run, "coverage step run")
      .replaceAll("${{ matrix.shard }}", String(shard))
      .trim()
      .split(/\s+/),
    env: step.env ?? {},
  }));
}
