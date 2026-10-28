import { SEED_BOROUGH_MONTHLY_TARGET } from "@/lib/boroughCoverageStatus";
import {
  buildLeagueTable,
  latestPintIndexObservations,
  validatePintIndexSnapshot,
  type LondonBoroughName,
  type PintIndexSnapshot,
} from "@/lib/pintIndex";
import {
  pintIndexMeetsAdmissionFloor,
  pintIndexObservationsByMonth,
} from "@/lib/pintIndexArchive";

export type PintIndexDiagnosticGroup = {
  month: string;
  boroughCode: string;
  boroughName: LondonBoroughName;
  distinctPubCount: number;
  venueIds: string[];
  missingDistinctPubs: number;
  meetsFloor: boolean;
};

export type PintIndexDiagnosticRecord = {
  index: number;
  venueId: string | null;
  status: "qualified" | "rejected" | "blocked";
  reasons: string[];
};

export type PintIndexDiagnostic = {
  status: "valid" | "invalid";
  /** Null means validation failed, not that the borough lacks evidence. */
  admitted: boolean | null;
  targetDistinctPubs: number;
  validObservationCount: number | null;
  validationErrors: string[];
  records: PintIndexDiagnosticRecord[];
  groups: PintIndexDiagnosticGroup[];
  exclusions: PintIndexSnapshot["excluded"];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readExclusions(value: unknown): PintIndexSnapshot["excluded"] {
  return array(value).flatMap((entry) => {
    const row = record(entry);
    if (!row || typeof row.reason !== "string" || typeof row.note !== "string"
      || !Number.isSafeInteger(row.observationCount) || Number(row.observationCount) < 0) return [];
    return [{ reason: row.reason, note: row.note, observationCount: Number(row.observationCount) }];
  });
}

/** Explain existing validation and admission decisions without fetching or changing evidence. */
export function diagnosePintIndex(value: unknown): PintIndexDiagnostic {
  const validation = validatePintIndexSnapshot(value);
  const input = record(value);
  const observations = array(input?.observations);
  const sources = array(input?.sources);
  const errors = validation.ok ? [] : validation.errors;
  const records: PintIndexDiagnosticRecord[] = observations.map((entry, index) => {
    const observation = record(entry);
    const sourceIndexes = sources.flatMap((source, sourceIndex) =>
      record(source)?.id === observation?.sourceId ? [sourceIndex] : []);
    const reasons = errors.filter((error) => error.startsWith(`observation ${index} `)
      || sourceIndexes.some((sourceIndex) => error.startsWith(`source ${sourceIndex} `)));
    return {
      index,
      venueId: typeof observation?.venueId === "string" ? observation.venueId : null,
      status: validation.ok ? "qualified" : reasons.length ? "rejected" : "blocked",
      reasons,
    };
  });
  const groups: PintIndexDiagnosticGroup[] = [];
  if (validation.ok) {
    const snapshot = validation.snapshot;
    for (const [month, monthObservations] of pintIndexObservationsByMonth(snapshot.observations)) {
      const latest = latestPintIndexObservations(monthObservations);
      for (const borough of buildLeagueTable({ ...snapshot, observations: monthObservations })) {
        groups.push({
          month,
          boroughCode: borough.slug,
          boroughName: borough.name,
          distinctPubCount: borough.pubCount,
          venueIds: latest.filter((row) => row.boroughCode === borough.slug)
            .map((row) => row.venueId).sort(),
          missingDistinctPubs: Math.max(0, SEED_BOROUGH_MONTHLY_TARGET - borough.pubCount),
          meetsFloor: borough.pubCount >= SEED_BOROUGH_MONTHLY_TARGET,
        });
      }
    }
    groups.sort((left, right) => left.month.localeCompare(right.month)
      || left.boroughCode.localeCompare(right.boroughCode));
  }
  return {
    status: validation.ok ? "valid" : "invalid",
    admitted: validation.ok ? pintIndexMeetsAdmissionFloor(validation.snapshot) : null,
    targetDistinctPubs: SEED_BOROUGH_MONTHLY_TARGET,
    validObservationCount: validation.ok ? validation.snapshot.observations.length : null,
    validationErrors: errors,
    records,
    groups,
    exclusions: readExclusions(input?.excluded),
  };
}
