import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { CDPSession, Page, TestInfo } from "@playwright/test";

const ARTIFACT = {
  commit: "4a3f77e283d4785929955379365d3bec39cee0cc",
  path: "/Users/karanmanoharan/Documents/projects/pubmaxx-audit/.next-audit-camera-profile-e2e/static/chunks/3xkn3-anz_5f3.js",
  urlPath: "/_next/static/chunks/3xkn3-anz_5f3.js",
  sha256: "b6198400905e467008766eac64c8fb23819ad915862ee04d3e725a0a8a95cd9b",
  bytes: 1_068_831,
  lineNumber: 803, columnNumber: 209182, endColumn: 209196,
  anchor: "t3.getCenter()",
};
const PREFIX = "PUBMAX_HALF_LAYER_4A3 ";
const hash = (source: string) => createHash("sha256").update(source).digest("hex");
type Phase = "before" | "after";
type FrameRead = <T>(phase: Phase, read: () => Promise<T>) => Promise<T>;
type Sample = { at?: number; timeOrigin?: number; observationError?: string; [key: string]: unknown };

// The reviewed false condition reads the pinned engine's immediate GeoJSON input.
// Source readiness and rendered queries do not prove successful compositing.
const CONDITION = String.raw`(() => {
  try {
    const map = t3;
    const id = 'venue-1kt3p9o';
    const originalCoordinate = [-0.10516941547393799, 51.51404080743336];
    const point = map.project(originalCoordinate);
    const source = map.getSource('pubs');
    const data = source?._data?.geojson;
    const hasCollection = data?.type === 'FeatureCollection' && Array.isArray(data.features);
    const target = hasCollection ? data.features.filter(feature => feature.properties?.id === id) : null;
    const filter = ['==', ['get', 'id'], id];
    const featureSummary = feature => ({
      layer: feature.layer?.id ?? null,
      id: feature.properties?.id ?? null,
      icon: feature.properties?.icon ?? null,
      story: feature.properties?.story ?? null,
      bucket: feature.properties?.bucket ?? null,
      serves: feature.properties?.serves ?? null,
      geometry: feature.geometry,
    });
    const limited = features => ({
      count: features.length,
      rows: features.slice(0, 4).map(featureSummary),
      overflow: Math.max(0, features.length - 4),
    });
    const layers = ['pubs-point-selected', 'pubs-point'].map(id => {
      if (!map.getLayer(id)) return { id, present: false };
      return {
        id, present: true,
        filter: map.getFilter(id),
        sortKey: map.getLayoutProperty(id, 'symbol-sort-key') ?? null,
        visibility: map.getLayoutProperty(id, 'visibility') ?? 'visible',
        allowOverlap: map.getLayoutProperty(id, 'icon-allow-overlap'),
        viewport: limited(map.queryRenderedFeatures({ layers: [id], filter })),
        point: limited(map.queryRenderedFeatures(point, { layers: [id], filter })),
      };
    });
    console.log('PUBMAX_HALF_LAYER_4A3 ' + JSON.stringify({
      at: performance.now(), timeOrigin: performance.timeOrigin, url: location.href,
      projectedContainerPoint: { x: point.x, y: point.y },
      source: {
        present: Boolean(source),
        ready: source ? map.isSourceLoaded('pubs') : null,
        geojsonAvailable: hasCollection,
        featureCount: hasCollection ? data.features.length : null,
        target: target ? limited(target) : null,
        icons: target ? target.slice(0, 4).map(feature => {
          const icon = feature.properties?.icon;
          return { icon: icon ?? null, present: typeof icon === 'string' ? map.hasImage(icon) : null };
        }) : null,
      },
      layers,
    }));
  } catch (error) {
    console.log('PUBMAX_HALF_LAYER_4A3 ' + JSON.stringify({ observationError: String(error) }));
  }
  return false;
})()`;

/** Diagnostic for one retained build and the first screenshot pair only. */
export async function observeHalfPinCapture4a3<T>(
  page: Page, testInfo: TestInfo, name: string, capture: (read: FrameRead) => Promise<T>,
): Promise<{ value: T; observationError?: Error }> {
  const requested = process.env.PW_HALF_PIN_LAYER_OBSERVATION;
  if (!requested || name !== "half-pin-before") {
    return { value: await capture((_phase, read) => read()) };
  }
  if (requested !== "4a3") throw new Error("Expected PW_HALF_PIN_LAYER_OBSERVATION=4a3");

  const deadline = Date.now() + 30_000;
  const operationDeadline = deadline - 6_000;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let timedOut = false;
  let stopped = false;
  const bounded = async <R>(work: () => Promise<R>, until: number, label: string): Promise<R> => {
    const remaining = until - Date.now();
    if (remaining <= 0) {
      timedOut = true;
      throw new Error(`Half-pin observation deadline: ${label}`);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error(`Half-pin observation deadline: ${label}`));
          }, remaining);
          timers.add(timer);
        }),
      ]);
    } finally {
      if (timer) { clearTimeout(timer); timers.delete(timer); }
    }
  };
  const step = <R>(work: () => Promise<R>, label: string) => {
    if (stopped) return Promise.reject<R>(new Error("Half-pin observation has stopped"));
    return bounded(work, Math.min(operationDeadline, Date.now() + 5_000), label);
  };
  const records: { boundary: Phase | null; sample: Sample }[] = [];
  const frames: Partial<Record<Phase, { at?: number; timeOrigin?: number }>> = {};
  const errors: string[] = [];
  const scripts = new Map<string, string>();
  let overflow = 0;
  let phase: Phase | null = null;
  let notifyRecord: (() => void) | undefined;
  let session: CDPSession | undefined;
  let breakpointId: string | undefined;
  let value: T | undefined;
  let failure: unknown;
  let failed = false;
  const evidence: Record<string, unknown> = { artifact: ARTIFACT, records, frames, errors };
  const origin = new URL(page.url());
  const onScript = (event: { scriptId: string; url: string }) => {
    try {
      const url = new URL(event.url);
      if (url.origin === origin.origin && url.pathname === ARTIFACT.urlPath) scripts.set(event.scriptId, event.url);
    } catch { /* Ignore scripts without an absolute URL. */ }
  };
  const onConsole = (event: { args: { value?: unknown }[] }) => {
    const text = event.args[0]?.value;
    if (typeof text !== "string" || !text.startsWith(PREFIX)) return;
    if (records.length === 2) overflow += 1;
    else {
      try {
        if (text.length > 65_536) throw new Error("Half-pin console record exceeds its size limit");
        const sample: unknown = JSON.parse(text.slice(PREFIX.length));
        if (!sample || typeof sample !== "object" || Array.isArray(sample)) throw new Error("Invalid half-pin record");
        records.push({ boundary: phase, sample: sample as Sample });
      } catch (error) { records.push({ boundary: phase, sample: { observationError: String(error) } }); }
    }
    notifyRecord?.();
  };
  const readFrame: FrameRead = async (nextPhase, read) => {
    if (stopped || timedOut) throw new Error("Half-pin observation cannot start another read");
    const index = nextPhase === "before" ? 0 : 1;
    if (records.length !== index || phase !== null) errors.push(`Unexpected ${nextPhase} boundary`);
    phase = nextPhase;
    const frameDeadline = Math.min(operationDeadline, Date.now() + 5_000);
    const arrived = new Promise<void>((resolve) => { notifyRecord = resolve; });
    try {
      const frame = await bounded(read, frameDeadline, `${nextPhase} frame`);
      if (stopped) throw new Error("Half-pin observation stopped during frame read");
      const unreadable = frame !== null && typeof frame === "object" && "observationError" in frame;
      if (!unreadable && records.length <= index) {
        await bounded(() => arrived, frameDeadline, `${nextPhase} console record`);
      }
      const timing = frame as { at?: number; timeOrigin?: number };
      frames[nextPhase] = { at: timing.at, timeOrigin: timing.timeOrigin };
      return frame;
    } finally {
      phase = null;
      notifyRecord = undefined;
    }
  };

  try {
    if (origin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) {
      throw new Error("Half-pin observation requires the owned local page");
    }
    const local = await step(() => readFile(ARTIFACT.path, "utf8"), "local artifact");
    evidence.localHash = hash(local);
    if (hash(local) !== ARTIFACT.sha256 || Buffer.byteLength(local) !== ARTIFACT.bytes ||
      local.split("\n")[ARTIFACT.lineNumber]?.slice(ARTIFACT.columnNumber, ARTIFACT.endColumn) !== ARTIFACT.anchor) {
      throw new Error("Half-pin local artifact or UTF-16 anchor changed");
    }
    const git = await step(() => promisify(execFile)("git", ["rev-parse", "HEAD"], {
      cwd: testInfo.config.rootDir, timeout: 1_000, maxBuffer: 1024,
    }), "fixture source identity");
    evidence.fixtureHead = git.stdout.trim();
    const version = await step(() => page.evaluate(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch("/api/version", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Version read failed");
        const body = await response.json();
        return { gitCommitSha: body.gitCommitSha, builtAt: body.builtAt };
      } finally { clearTimeout(timer); }
    }), "served version");
    evidence.version = version;
    if (version.gitCommitSha !== ARTIFACT.commit) throw new Error("Served build is not the reviewed 4a3 artifact");
    session = await step(() => page.context().newCDPSession(page), "CDP attachment");
    const cdp = session;
    cdp.on("Debugger.scriptParsed", onScript);
    cdp.on("Runtime.consoleAPICalled", onConsole);
    await step(() => cdp.send("Runtime.enable"), "console transport");
    await step(() => cdp.send("Debugger.enable"), "script inventory");
    if (scripts.size !== 1) throw new Error(`Expected one camera script; found ${scripts.size}`);
    const [scriptId, scriptUrl] = [...scripts][0];
    evidence.scriptUrl = scriptUrl;
    const served = await step(() => cdp.send("Debugger.getScriptSource", { scriptId }), "served script bytes");
    evidence.servedHash = hash(served.scriptSource);
    if (hash(served.scriptSource) !== ARTIFACT.sha256) throw new Error("Served camera script hash changed");
    const start = { scriptId, lineNumber: ARTIFACT.lineNumber, columnNumber: ARTIFACT.columnNumber };
    const end = { ...start, columnNumber: ARTIFACT.endColumn };
    const inside = (location: { scriptId: string; lineNumber: number; columnNumber?: number }) => location.scriptId === scriptId &&
      location.lineNumber === start.lineNumber && typeof location.columnNumber === "number" && location.columnNumber >= start.columnNumber &&
      location.columnNumber < end.columnNumber;
    const possible = await step(() => cdp.send("Debugger.getPossibleBreakpoints", {
      start, end, restrictToFunction: true,
    }), "exact V8 location");
    if (possible.locations.length !== 1 || !inside(possible.locations[0])) {
      throw new Error("Expected one V8 breakpoint inside the reviewed anchor");
    }
    const installed = await step(() => cdp.send("Debugger.setBreakpoint", {
      location: possible.locations[0], condition: CONDITION,
    }), "false breakpoint installation");
    breakpointId = installed.breakpointId;
    evidence.actualLocation = installed.actualLocation;
    if (!inside(installed.actualLocation)) throw new Error("V8 relocated the observation outside the anchor");
    value = await bounded(() => capture(readFrame), operationDeadline, "capture pair");
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    stopped = true;
    let cleanupFailed = false;
    if (session) {
      const cdp = session;
      if (breakpointId) {
        try {
          await bounded(() => cdp.send("Debugger.removeBreakpoint", { breakpointId: breakpointId! }),
            Math.min(deadline - 4_000, Date.now() + 2_000), "remove breakpoint");
        } catch (error) { cleanupFailed = true; errors.push(String(error)); }
      }
      try {
        await bounded(() => cdp.detach(), Math.min(deadline - 2_000, Date.now() + 2_000), "detach CDP");
      } catch (error) { cleanupFailed = true; errors.push(String(error)); }
      cdp.off("Debugger.scriptParsed", onScript);
      cdp.off("Runtime.consoleAPICalled", onConsole);
    }
    if (timedOut || cleanupFailed) {
      try { await bounded(() => page.close({ runBeforeUnload: false }), deadline, "close owned page"); }
      catch (error) { errors.push(`Owned page closure unconfirmed: ${String(error)}`); }
    }
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  const [before, after] = records;
  const matched = (entry: typeof before | undefined, expected: Phase) => {
    const frame = frames[expected];
    return entry?.boundary === expected && !entry.sample.observationError &&
      Number.isFinite(entry.sample.at) && Number.isFinite(entry.sample.timeOrigin) &&
      entry.sample.timeOrigin === frame?.timeOrigin && Number.isFinite(frame?.at) &&
      entry.sample.at! <= frame!.at!;
  };
  if (records.length !== 2 || overflow || !matched(before, "before") || !matched(after, "after") ||
    before.sample.timeOrigin !== after.sample.timeOrigin || before.sample.at! >= after.sample.at! ||
    after.sample.at! < frames.before!.at! || scripts.size !== 1) {
    errors.push("Refused before/after attribution: expected exactly two ordered records at the existing frame boundaries");
  }
  evidence.overflow = overflow;
  evidence.failure = failed ? String(failure) : null;
  evidence.accepted = !failed && errors.length === 0;
  if (evidence.accepted) evidence.samples = { before: before.sample, after: after.sample };
  try {
    await bounded(() => testInfo.attach(`${name}-layers-4a3.json`, {
      body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: "application/json",
    }), Math.min(deadline, Date.now() + 1_000), "attach evidence");
  } catch (error) {
    errors.push(String(error));
    testInfo.annotations.push({ type: "half-pin-observation-refused", description: errors.join("; ") });
  }
  if (failed) throw failure;
  return { value: value!, observationError: errors.length ? new Error(errors.join("; ")) : undefined };
}
