export type TrialMark = "turn_started" | "first_text" | "first_audio" | "completed" | "cancelled";
export type DropReason = "cancelled" | "superseded" | "after_completion" | "ungrounded" | "malformed";
export type CancelCause = "user" | "superseded";

export type TrialEvent =
  | { type: "text"; text: string }
  | { type: "audio"; chunk: Uint8Array }
  | { type: "tool"; callId: string; fixtureId: string; output: unknown }
  | { type: "done" };

export interface LoopbackEndpoint {
  host: "127.0.0.1" | "::1";
  port: number;
}

export interface TrialTurn {
  turnId: string;
  utterance: string;
  signal: AbortSignal;
  emit: (event: TrialEvent) => void;
}

export interface TrialAdapter {
  endpoint?: LoopbackEndpoint;
  startTurn: (turn: TrialTurn) => void;
}

export type TrialLogEntry =
  | { kind: "mark"; turnId: string; mark: TrialMark; at: number; cause?: CancelCause }
  | { kind: "delivered"; turnId: string; type: TrialEvent["type"]; at: number }
  | { kind: "dropped"; turnId: string; type: unknown; reason: DropReason; at: number };

export interface TrialSession {
  startTurn(utterance: string): string;
  cancel(): boolean;
  activeTurn(): string | null;
  log(): TrialLogEntry[];
}

export interface TurnSummary {
  turnId: string;
  marks: Record<TrialMark, number | null>;
  cancelCause: CancelCause | null;
  delivered: number;
  dropped: Record<DropReason, number>;
  sinceStart: Record<Exclude<TrialMark, "turn_started">, number | null>;
}

export const TRIAL_MARKS: readonly TrialMark[];
export const DROP_REASONS: readonly DropReason[];

export function assertLoopbackEndpoint(
  endpoint: { host?: unknown; port?: unknown } | null | undefined,
): { host: string; port: number };

export function createTrialSession(options: {
  adapter: TrialAdapter;
  fixtureIds: Iterable<string>;
  now: () => number;
  onDeliver?: (turnId: string, event: TrialEvent) => void;
}): TrialSession;

export function summariseTrial(log: readonly TrialLogEntry[]): TurnSummary[];
