import { isNativeApp } from "@/lib/nativePlatform";
import type { OutingStepsSample } from "@/lib/outingSteps";

type OutingStepsPermission = "granted" | "denied" | "prompt";
export type OutingStepsStatus = { available: boolean; permission: OutingStepsPermission };

type OutingStepsPlugin = {
  status: () => Promise<unknown>;
  requestPermission: () => Promise<unknown>;
  sample: (input: { since: number; until: number; session: string }) => Promise<unknown>;
  stop: (input: { session: string }) => Promise<void>;
};

export type OutingStepsBridge = {
  status: () => Promise<OutingStepsStatus>;
  requestPermission: () => Promise<OutingStepsStatus>;
  sample: (window: { since: number; until: number; session: string }) => Promise<OutingStepsSample | null>;
  stop: (input: { session: string }) => Promise<void>;
};

const PERMISSIONS = new Set<OutingStepsPermission>(["granted", "denied", "prompt"]);

function parseStatus(value: unknown): OutingStepsStatus {
  const row = (value ?? {}) as Record<string, unknown>;
  const permission = PERMISSIONS.has(row.permission as OutingStepsPermission) ? row.permission as OutingStepsPermission : "denied";
  return { available: row.available === true, permission };
}

function parseOutingStepsSample(value: unknown): OutingStepsSample | null {
  const row = (value ?? {}) as Record<string, unknown>;
  if (row.platform === "ios" && typeof row.steps === "number") return { platform: "ios", steps: row.steps };
  if (row.platform === "android" && typeof row.bootCount === "number" && typeof row.continuous === "boolean"
    && (row.counter === null || typeof row.counter === "number")) {
    return { platform: "android", counter: row.counter, bootCount: row.bootCount, continuous: row.continuous };
  }
  return null;
}

async function loadPlugin(): Promise<OutingStepsPlugin | null> {
  const { Capacitor, registerPlugin } = await import("@capacitor/core");
  if (!Capacitor.isPluginAvailable("OutingSteps")) return null;
  const plugin = registerPlugin<OutingStepsPlugin>("OutingSteps");
  // Never return a Capacitor Proxy from an async loader: it has a native `then` method.
  return {
    status: () => plugin.status(),
    requestPermission: () => plugin.requestPermission(),
    sample: (input) => plugin.sample(input),
    stop: (input) => plugin.stop(input),
  };
}

/** Null on the web, during SSR and in a shell built before the step plugin. */
export async function loadOutingStepsBridge(
  deps: { isNative?: () => boolean; loadPlugin?: () => Promise<OutingStepsPlugin | null> } = {},
): Promise<OutingStepsBridge | null> {
  if (!(deps.isNative ?? isNativeApp)()) return null;
  let plugin: OutingStepsPlugin | null;
  try { plugin = await (deps.loadPlugin ?? loadPlugin)(); } catch { return null; }
  if (!plugin) return null;
  const native = plugin;
  return {
    status: async () => parseStatus(await native.status()),
    requestPermission: async () => parseStatus(await native.requestPermission()),
    sample: async (window) => parseOutingStepsSample(await native.sample(window)),
    stop: async (input) => { try { await native.stop(input); } catch { /* Nothing is listening. */ } },
  };
}
