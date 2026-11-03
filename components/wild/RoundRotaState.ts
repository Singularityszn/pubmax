export const ROUND_ROTA_SESSION_KEY = "pubmax:wild-round-rota:v1";
export const ROUND_ROTA_MAX_NAMES = 12;
export const ROUND_ROTA_NAME_LIMIT = 40;
const MAX_ROUNDS = 8;

export type RoundRotaState = { names: string[]; current: number };
type RotaEntry = RoundRotaState & { roundId: string };
type RotaRecord = { version: 1; ownerId: string; rounds: RotaEntry[] };
type RotaStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;

export function cleanRotaName(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

function nameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en-GB");
}

export function rotaNameIssue(raw: string, names: readonly string[]): string | null {
  const name = cleanRotaName(raw);
  if (!name) return "Add a name.";
  if (/\p{Cc}/u.test(raw) || name.length > ROUND_ROTA_NAME_LIMIT) return "Use a name of 40 characters or fewer, on one line.";
  if (names.length >= ROUND_ROTA_MAX_NAMES) return "This order can hold up to 12 names.";
  if (names.some((existing) => nameKey(existing) === nameKey(name))) return "That name is already in the order.";
  return null;
}

function validEntry(value: unknown): value is RotaEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RotaEntry>;
  if (typeof entry.roundId !== "string" || !entry.roundId || !Array.isArray(entry.names)
    || entry.names.length > ROUND_ROTA_MAX_NAMES || !Number.isInteger(entry.current)) return false;
  if (entry.names.some((name, index) => typeof name !== "string" || cleanRotaName(name) !== name
    || rotaNameIssue(name, entry.names!.slice(0, index)) !== null)) return false;
  return entry.names.length === 0 ? entry.current === 0 : entry.current! >= 0 && entry.current! < entry.names.length;
}

function readRecord(storage: RotaStorage): RotaRecord | null {
  try {
    const record = JSON.parse(storage?.getItem(ROUND_ROTA_SESSION_KEY) ?? "null") as Partial<RotaRecord> | null;
    if (record?.version !== 1 || typeof record.ownerId !== "string" || !record.ownerId
      || !Array.isArray(record.rounds) || record.rounds.length > MAX_ROUNDS || !record.rounds.every(validEntry)
      || new Set(record.rounds.map((entry) => entry.roundId)).size !== record.rounds.length) return null;
    return record as RotaRecord;
  } catch {
    return null;
  }
}

export function readRoundRota(ownerId: string, roundId: string, storage: RotaStorage): RoundRotaState {
  const record = readRecord(storage);
  const entry = record?.ownerId === ownerId ? record.rounds.find((row) => row.roundId === roundId) : null;
  return entry ? { names: [...entry.names], current: entry.current } : { names: [], current: 0 };
}

export function saveRoundRota(ownerId: string, roundId: string, value: RoundRotaState, storage: RotaStorage): boolean {
  if (!storage || !ownerId || !validEntry({ ...value, roundId })) return false;
  const old = readRecord(storage);
  const other = old?.ownerId === ownerId ? old.rounds.filter((row) => row.roundId !== roundId) : [];
  try {
    storage.setItem(ROUND_ROTA_SESSION_KEY, JSON.stringify({
      version: 1, ownerId,
      rounds: [...other.slice(-(MAX_ROUNDS - 1)), { roundId, names: value.names, current: value.current }],
    } satisfies RotaRecord));
    return true;
  } catch {
    return false;
  }
}

export function clearRoundRota(ownerId: string, roundId: string, storage: RotaStorage): boolean {
  if (!storage) return false;
  const record = readRecord(storage);
  if (!record || record.ownerId !== ownerId) return true;
  const rounds = record.rounds.filter((row) => row.roundId !== roundId);
  try {
    if (rounds.length) storage.setItem(ROUND_ROTA_SESSION_KEY, JSON.stringify({ ...record, rounds }));
    else storage.removeItem(ROUND_ROTA_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}
