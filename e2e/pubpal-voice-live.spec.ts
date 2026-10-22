import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  chromium,
  devices,
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

// Live Pub Pal proof against a real deployment with ElevenLabs configured.
//
// PUB_PAL_PROOF_SELECTION picks one of two selections that never mix:
//
// - "historical" (the default when unset): the original token, text-ask,
//   typed-chat and voice tests, with their old behavior. They keep their
//   bearer, credential-file sign-in, init scripts and species API writes, and
//   are skipped under "final".
// - "final": desktop 1440x900 then mobile web 390x844, one intentional Start
//   each, in a browser each case launches and owns. See the FINAL section.
//
// The browser tests drive the real /pal page in headless Chromium. The fake
// microphone plays PUB_PAL_PROOF_WAV into a real ElevenLabs voice session, and
// the spec reads the session's own WebSocket frames to prove the spoken line
// was transcribed and the Pal answered with audio. Evidence lands in
// artifacts/pubpal-voice-proof/ (gitignored) for the PR description.

const LIVE_PROOF = process.env.PUB_PAL_PROOF_BASE_URL?.replace(/\/+$/, "");
const storageState = process.env.PUB_PAL_PROOF_STORAGE_STATE?.trim();
const wav = process.env.PUB_PAL_PROOF_WAV?.trim();
const EVIDENCE_DIR = "artifacts/pubpal-voice-proof";
const ROUTE_ACTIVATION_KEY = "pubmaxx.pub-pal-route-activation.v1";

const PROOF_SELECTION = process.env.PUB_PAL_PROOF_SELECTION?.trim() || "historical";
if (PROOF_SELECTION !== "historical" && PROOF_SELECTION !== "final") {
  throw new Error(
    `PUB_PAL_PROOF_SELECTION must be "historical" or "final", not "${PROOF_SELECTION}"`,
  );
}
const FINAL_SELECTED = PROOF_SELECTION === "final";

const PROOF_SPECIES = (process.env.PUB_PAL_PROOF_SPECIES ?? "fox,robin")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const PROOF_BROWSER_CHANNEL = process.env.PUB_PAL_PROOF_BROWSER_CHANNEL?.trim();

/** Spoken line in PUB_PAL_PROOF_WAV; used to assert user_transcript, not wall-clock timing. */
const PROOF_EXPECTED_UTTERANCE = (
  process.env.PUB_PAL_PROOF_EXPECTED_UTTERANCE ?? "What pub should we start at?"
).trim();

function transcriptMatchesUtterance(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ");
  const tokens = PROOF_EXPECTED_UTTERANCE.toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);
  const hits = tokens.filter((word) => normalized.includes(word));
  return hits.length >= Math.min(2, tokens.length);
}

// The historical options. launchOptions and channel are worker-scoped, and
// Playwright refuses worker-scoped options inside a describe, so they stay
// file-level but apply only when FINAL is not selected. FINAL uses no browser,
// context or page fixture: each FINAL case launches and owns its browser and
// inherits none of these.
test.use(
  FINAL_SELECTED
    ? {}
    : {
        ...(storageState ? { storageState } : {}),
        ...(PROOF_BROWSER_CHANNEL ? { channel: PROOF_BROWSER_CHANNEL } : {}),
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            ...(wav ? [`--use-file-for-fake-audio-capture=${wav}`] : []),
          ],
        },
      },
);

function requireProofEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live Pub Pal proof`);
  return value;
}

type VoiceFrame = { at: number; type: string; text?: string; audioBytes?: number };

function readVoiceFrame(payload: string | Buffer, at: number): VoiceFrame | null {
  try {
    const event = JSON.parse(payload.toString()) as {
      type?: string;
      user_transcription_event?: { user_transcript?: string };
      tentative_user_transcription_event?: { user_transcript?: string };
      agent_response_event?: { agent_response?: string };
      audio_event?: { audio_base_64?: string };
    };
    if (event.type === "user_transcript" || event.type === "tentative_user_transcript") {
      const text =
        event.user_transcription_event?.user_transcript ??
        event.tentative_user_transcription_event?.user_transcript ??
        "";
      return { at, type: "user_transcript", text };
    }
    if (event.type === "agent_response") {
      return { at, type: "agent_response", text: event.agent_response_event?.agent_response ?? "" };
    }
    if (event.type === "audio") {
      const audio = event.audio_event?.audio_base_64 ?? "";
      return { at, type: "audio", audioBytes: Buffer.from(audio, "base64").length };
    }
    return null;
  } catch {
    return null;
  }
}

type QaCredentials = { handle: string; password: string; email: string; userId: string };

function qaCredentials(): QaCredentials {
  const path = resolve(process.cwd(), ".e2e", "qa-credentials.json");
  return JSON.parse(readFileSync(path, "utf8")) as QaCredentials;
}

function supabaseAuthStorageKey(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for the live Pub Pal proof");
  const ref = new URL(url).hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}

async function ensureQaSignedIn(page: Page, request: APIRequestContext): Promise<void> {
  const credentials = qaCredentials();
  const response = await request.post(`${LIVE_PROOF}/api/auth/handle-password`, {
    data: { handle: credentials.handle, password: credentials.password },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    session?: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      expires_at: number;
      token_type: string;
    };
  };
  expect(body.session?.access_token).toBeTruthy();
  const authStorageKey = supabaseAuthStorageKey();
  await page.addInitScript(
    ({ authStorageKey, session, userId, email }) => {
      localStorage.setItem(
        authStorageKey,
        JSON.stringify({
          ...session,
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email,
            app_metadata: {},
            user_metadata: {},
          },
        }),
      );
    },
    {
      authStorageKey,
      session: body.session,
      userId: credentials.userId,
      email: credentials.email,
    },
  );
}

async function prepareReturningVisitor(page: Page) {
  await page.addInitScript((key) => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, activatedAt: new Date().toISOString() }),
    );
  }, ROUTE_ACTIVATION_KEY);
}

async function setPalSpecies(request: APIRequestContext, bearer: string, species: string) {
  const palResponse = await request.get(`${LIVE_PROOF}/api/pub-pal`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  expect(palResponse.status()).toBe(200);
  const { pal } = (await palResponse.json()) as { pal?: { appearance?: Record<string, unknown> } };
  expect(pal?.appearance).toBeTruthy();
  const patch = await request.patch(`${LIVE_PROOF}/api/pub-pal`, {
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    data: {
      appearance: { ...pal!.appearance, species },
    },
  });
  expect(patch.status()).toBe(200);
}

async function runVoiceSession(
  page: Page,
  context: BrowserContext,
  request: APIRequestContext,
  species: string,
) {
  const origin = new URL(LIVE_PROOF!).origin;
  await context.grantPermissions(["microphone"], { origin });

  const started = Date.now();
  const frames: VoiceFrame[] = [];
  page.on("websocket", (socket) => {
    if (!/elevenlabs/i.test(socket.url())) return;
    socket.on("framereceived", ({ payload }) => {
      const frame = readVoiceFrame(payload, Date.now() - started);
      if (frame) frames.push(frame);
    });
  });

  await prepareReturningVisitor(page);
  await ensureQaSignedIn(page, request);
  await expect(async () => {
    await page.goto(`${LIVE_PROOF}/pal`);
    await expect(page.getByRole("button", { name: "Start voice chat" })).toBeVisible({
      timeout: 10_000,
    });
  }).toPass({ timeout: 45_000 });

  await expect(async () => {
    await page.getByRole("button", { name: "Start voice chat" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Pal is listening" })).toBeVisible({
      timeout: 10_000,
    });
  }).toPass({ timeout: 45_000 });
  const connectedAt = Date.now() - started;

  await expect
    .poll(
      () => frames.some((frame) => frame.type === "audio" && (frame.audioBytes ?? 0) > 0),
      { timeout: 60_000 },
    )
    .toBe(true);
  const firstAgentAudioBytes = frames
    .filter((frame) => frame.type === "audio")
    .reduce((total, frame) => total + (frame.audioBytes ?? 0), 0);

  const matchingTranscript = () =>
    frames.find(
      (frame) =>
        frame.type === "user_transcript" &&
        frame.text?.trim() &&
        transcriptMatchesUtterance(frame.text),
    );
  await expect.poll(() => matchingTranscript()?.at, { timeout: 120_000 }).toBeDefined();
  const heardAt = matchingTranscript()!.at;

  await expect
    .poll(
      () =>
        frames.some(
          (frame) =>
            frame.type === "agent_response" && frame.at >= heardAt && frame.text?.trim(),
        ) &&
        frames.some(
          (frame) => frame.type === "audio" && frame.at >= heardAt && (frame.audioBytes ?? 0) > 0,
        ),
      { timeout: 120_000 },
    )
    .toBe(true);

  const transcript = matchingTranscript()?.text ?? "";
  const reply = frames.find(
    (frame) => frame.type === "agent_response" && frame.at >= heardAt && frame.text?.trim(),
  );
  const audioReplyBytes = frames
    .filter((frame) => frame.type === "audio" && frame.at >= heardAt)
    .reduce((total, frame) => total + (frame.audioBytes ?? 0), 0);

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: `${EVIDENCE_DIR}/voice-session-${species}.png`, fullPage: true });
  const sessionEvidence = {
    at: new Date().toISOString(),
    baseUrl: LIVE_PROOF,
    species,
    connectedAtMs: connectedAt,
    expectedUtterance: PROOF_EXPECTED_UTTERANCE,
    firstAgentAudioBytes,
    transcript,
    agentResponse: reply?.text ?? "",
    frameCounts: {
      user_transcript: frames.filter((frame) => frame.type === "user_transcript").length,
      agent_response: frames.filter((frame) => frame.type === "agent_response").length,
      audio: frames.filter((frame) => frame.type === "audio").length,
    },
    audioReplyBytes,
    frames,
  };
  await writeFile(
    `${EVIDENCE_DIR}/voice-session-${species}.json`,
    `${JSON.stringify(sessionEvidence, null, 2)}\n`,
  );

  await page.getByRole("button", { name: "End", exact: true }).click();

  return sessionEvidence;
}

test.describe("Pub Pal live voice", () => {
  test.skip(!LIVE_PROOF, "live proof runs on demand: set PUB_PAL_PROOF_BASE_URL");
  test.skip(FINAL_SELECTED, "historical token, API and voice tests never run in the FINAL selection");
  const baseUrl = LIVE_PROOF;

  test("voice token returns a signed session and species voice override", async ({ request }) => {
    const bearer = requireProofEnv("PUB_PAL_PROOF_BEARER");
    for (const species of PROOF_SPECIES) {
      await setPalSpecies(request, bearer, species);
      const response = await request.post(`${baseUrl}/api/pub-pal/voice-token`, {
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.signedUrl).toBeTruthy();
      expect(body.overrides?.voiceId).toBeTruthy();
      await mkdir(EVIDENCE_DIR, { recursive: true });
      await writeFile(
        `${EVIDENCE_DIR}/voice-token-${species}.json`,
        `${JSON.stringify({ species, voiceId: body.overrides?.voiceId, retention: body.retention }, null, 2)}\n`,
      );
      await request.post(`${baseUrl}/api/pub-pal/voice-token`, {
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        data: { action: "release", conversationId: body.conversationId },
      });
    }
  });

  test("text ask answers through the concierge bridge", async ({ request }) => {
    const bearer = requireProofEnv("PUB_PAL_PROOF_BEARER");
    const response = await request.post(`${baseUrl}/api/ask`, {
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      data: { query: "Cheapest pint near Camden tonight" },
    });
    expect(response.status()).toBe(200);
  });

  test("a person types to the Pal in the browser and gets a reply", async ({ page }) => {
    await prepareReturningVisitor(page);
    await page.goto(`${baseUrl}/pal/chat`);
    await page.getByRole("textbox", { name: /Where, how many, what budget/i }).fill(
      "Cheapest pint in Camden tonight",
    );
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".palChatBubble--error")).toHaveCount(0);
    const answer = page
      .locator(".palChatRow--pal")
      .last()
      .locator(".palChatBubble:not(.palChatBubble--error):not(.palChatBubble--pending)")
      .first();
    await expect(answer).not.toBeEmpty();

    await mkdir(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: `${EVIDENCE_DIR}/typed-chat.png`, fullPage: true });
  });

  test("a person talks to the Pal in the browser and hears it answer", async ({
    page,
    request,
    context,
  }) => {
    requireProofEnv("PUB_PAL_PROOF_STORAGE_STATE");
    requireProofEnv("PUB_PAL_PROOF_WAV");
    const bearer = requireProofEnv("PUB_PAL_PROOF_BEARER");
    test.setTimeout(300_000 * PROOF_SPECIES.length);

    const sessions = [];
    for (const species of PROOF_SPECIES) {
      await setPalSpecies(request, bearer, species);
      const evidence = await runVoiceSession(page, context, request, species);
      sessions.push({ species, ...evidence });
    }

    await writeFile(
      `${EVIDENCE_DIR}/voice-sessions-summary.json`,
      `${JSON.stringify({ at: new Date().toISOString(), baseUrl, sessions }, null, 2)}\n`,
    );
  });
});

// ---------------------------------------------------------------------------
// FINAL selection (PUB_PAL_PROOF_SELECTION=final). Run with --workers=1; it
// refuses retries and --repeat-each. Every prerequisite is checked before any
// live operation, and a missing one is a prerequisite, never something this
// spec creates:
//
//   PUB_PAL_PROOF_BASE_URL            https origin of the deployment under proof
//   PUB_PAL_FINAL_DEPLOYMENT_COMMIT   expected /api/version gitCommitSha
//   PUB_PAL_FINAL_DEPLOYMENT_ID       expected /api/version deploymentId
//   PUB_PAL_FINAL_QA_LABEL            nonsecret label of the disposable QA session
//   PUB_PAL_FINAL_QA_ATTESTATION      nonsecret attestation, recorded as supplied
//   PUB_PAL_PROOF_STORAGE_STATE       Playwright storageState exported from that
//                                     session after sign-in, consent and Pal
//                                     setup in the normal UI
//   PUB_PAL_PROOF_WAV                 approved synthetic WAV; its path has no "%"
//   PUB_PAL_FINAL_WAV_SHA256          expected SHA-256 of that WAV
//   PUB_PAL_FINAL_WAV_PROVENANCE      where it came from and who approved it
//   PUB_PAL_PROOF_EXPECTED_UTTERANCE  its exact line, e.g. "Find me four pubs in
//                                     Soho and show them on the map."
//
// FINAL hands the storageState path to the browser context and never reads it.
// It makes no API writes, no init scripts and no sign-in requests; its only
// direct request is the public GET /api/version, before and after. Evidence is
// CONTROLLED INPUT: Chromium's fake capture plays the WAV once (%noloop, which
// fake_audio_input_stream.cc ChooseSource parses into looping=false) through
// the product's normal microphone path. It is not physical phone, microphone
// or speaker proof, and map, 3D and memory stay manual acceptance: this spec
// claims none of them.
// ---------------------------------------------------------------------------

const FINAL_EVIDENCE_DIR = `${EVIDENCE_DIR}/final`;
const FINAL_CONSENT_KEY = "pubmaxx:analytics-consent:v1";
/** Hard ceiling for one provider connection, measured from the Start tap. */
const FINAL_CONNECTION_LIMIT_MS = 45_000;
/** Independent deadline: closes the owned browser whatever the test is awaiting. */
const FINAL_WATCHDOG_MS = 40_000;
/** Visible End and the provider socket close must finish by here, inside the watchdog. */
const FINAL_END_BY_MS = 37_000;
/** Transcript, reply and screenshot must finish by here, leaving time for End. */
const FINAL_INTERACTION_MS = 32_000;
const FINAL_COMBINED_LIMIT_MS = 180_000;
/** Deliberate spoken plus typed turns for the whole final acceptance; FINAL spends one per viewport. */
const FINAL_TURN_BUDGET = 16;
const FINAL_AUDIO_CAP_BYTES = 8 * 1024 * 1024;
const FINAL_MAX_INPUT_WAV_BYTES = 16 * 1024 * 1024;
const FINAL_REPLY_SETTLE_MS = 1_500;
/** ElevenLabs pcm_<rate> output is 16-bit signed little-endian mono. Any other format builds no WAV. */
const FINAL_PCM_RATES = new Map<string, number>([
  ["pcm_8000", 8_000],
  ["pcm_16000", 16_000],
  ["pcm_22050", 22_050],
  ["pcm_24000", 24_000],
  ["pcm_44100", 44_100],
  ["pcm_48000", 48_000],
]);
const FINAL_COUNT_WORDS = new Map<string, number>(
  ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].map(
    (word, index) => [word, index + 1],
  ),
);
const FINAL_LIMIT_LABEL = "NOT PHYSICAL PHONE, MICROPHONE OR SPEAKER PROOF";
const FINAL_VIEWPORTS = [
  { name: "desktop", label: "DESKTOP 1440x900", width: 1440, height: 900, mobile: false },
  { name: "mobile-web", label: "MOBILE WEB 390x844", width: 390, height: 844, mobile: true },
] as const;
const FINAL_MOBILE_USER_AGENT = devices["Pixel 7"]?.userAgent;

type FinalViewport = (typeof FINAL_VIEWPORTS)[number];
type FinalPrereqs = {
  baseUrl: string;
  origin: string;
  deploymentCommit: string;
  deploymentId: string;
  qaLabel: string;
  qaAttestation: string;
  storageStatePath: string;
  wavPath: string;
  wavSha256: string;
  wavProvenance: string;
  expectedUtterance: string;
  wantsMap: boolean;
};
type VersionObservation = {
  at: string;
  status: number;
  gitCommitSha: string | null;
  deploymentId: string | null;
  matches: boolean;
};
type FinalTurn = { at: number; text: string };
type OwnedBrowser = {
  browser?: Browser;
  closing?: Promise<void>;
  closedBy?: string;
  closeRequestedAt?: number;
  closeConfirmedAt?: number;
  closeError?: string;
};
type FinalResult = {
  viewport: string;
  started: boolean;
  passed: boolean;
  connectionMs: number | null;
  failures: string[];
};

// One worker runs both cases serially, so this is the whole run's state.
let finalHalted = false;
let finalProviderMsUsed = 0;
let finalActive: OwnedBrowser | undefined;
const finalResults: FinalResult[] = [];

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
/** Playwright reads a 0 timeout as "no limit", so an exhausted budget becomes 1ms. */
const msUntil = (at: number) => Math.max(1, at - Date.now());

function describeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

/**
 * FINAL's own match for the approved Soho request, never the historical
 * any-two-words matcher. Every slot must be there: intent "find", area "Soho",
 * the count four or 4 and no other count, "pubs", and "map" when the approved
 * line asks for the map. Case and punctuation are ignored.
 */
function sohoRequestProblems(text: string, wantsMap: boolean): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const problems: string[] = [];
  if (!words.includes("find")) problems.push('intent "find"');
  if (!words.includes("soho")) problems.push('area "Soho"');
  if (!words.includes("pubs")) problems.push('"pubs"');
  if (wantsMap && !words.includes("map")) problems.push('"map"');
  const counts = words.flatMap((word) => {
    const count = /^\d+$/.test(word) ? Number(word) : FINAL_COUNT_WORDS.get(word);
    return count === undefined ? [] : [count];
  });
  if (!counts.includes(4)) problems.push('count "four" or "4"');
  const wrong = counts.filter((count) => count !== 4);
  if (wrong.length > 0) problems.push(`conflicting count ${wrong.join(", ")}`);
  return problems;
}

function finalPrerequisites(): FinalPrereqs {
  const problems: string[] = [];
  const env = (name: string): string => {
    const value = process.env[name]?.trim() ?? "";
    if (!value) problems.push(`${name} is required`);
    return value;
  };
  const baseUrl = env("PUB_PAL_PROOF_BASE_URL").replace(/\/+$/, "");
  const deploymentCommit = env("PUB_PAL_FINAL_DEPLOYMENT_COMMIT");
  const deploymentId = env("PUB_PAL_FINAL_DEPLOYMENT_ID");
  const qaLabel = env("PUB_PAL_FINAL_QA_LABEL");
  const qaAttestation = env("PUB_PAL_FINAL_QA_ATTESTATION");
  const storageStateInput = env("PUB_PAL_PROOF_STORAGE_STATE");
  const wavInput = env("PUB_PAL_PROOF_WAV");
  const wavSha256 = env("PUB_PAL_FINAL_WAV_SHA256").toLowerCase();
  const wavProvenance = env("PUB_PAL_FINAL_WAV_PROVENANCE");
  const expectedUtterance = env("PUB_PAL_PROOF_EXPECTED_UTTERANCE");

  let origin = "";
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      origin = url.origin;
      if (url.protocol !== "https:" || origin !== baseUrl) {
        problems.push("PUB_PAL_PROOF_BASE_URL must be a bare https origin");
      }
    } catch {
      problems.push("PUB_PAL_PROOF_BASE_URL is not a URL");
    }
  }

  // Existence only: the browser context is handed this path and the spec never reads it.
  const storageStatePath = storageStateInput ? resolve(storageStateInput) : "";
  if (storageStatePath && !(existsSync(storageStatePath) && statSync(storageStatePath).isFile())) {
    problems.push(`PUB_PAL_PROOF_STORAGE_STATE ${storageStatePath} is not a file`);
  }

  const wavPath = wavInput ? resolve(wavInput) : "";
  if (wavPath.includes("%")) {
    problems.push(
      "PUB_PAL_PROOF_WAV must not contain %: Chromium reads what follows % as fake capture parameters",
    );
  } else if (wavPath && !(existsSync(wavPath) && statSync(wavPath).isFile())) {
    problems.push(`PUB_PAL_PROOF_WAV ${wavPath} is not a file`);
  } else if (wavPath && statSync(wavPath).size > FINAL_MAX_INPUT_WAV_BYTES) {
    problems.push(`PUB_PAL_PROOF_WAV is over ${FINAL_MAX_INPUT_WAV_BYTES} bytes`);
  } else if (wavPath) {
    const bytes = readFileSync(wavPath);
    if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
      problems.push("PUB_PAL_PROOF_WAV is not a RIFF/WAVE file");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (wavSha256 && digest !== wavSha256) {
      problems.push(`PUB_PAL_PROOF_WAV SHA-256 is ${digest}, not PUB_PAL_FINAL_WAV_SHA256`);
    }
  }

  const wantsMap = /\bmap\b/i.test(expectedUtterance);
  const utteranceProblems = expectedUtterance
    ? sohoRequestProblems(expectedUtterance, wantsMap)
    : [];
  if (utteranceProblems.length > 0) {
    problems.push(
      `PUB_PAL_PROOF_EXPECTED_UTTERANCE is not the approved Soho request: missing or wrong ${utteranceProblems.join(", ")}`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`FINAL prerequisite missing, nothing was started: ${problems.join("; ")}`);
  }
  return {
    baseUrl,
    origin,
    deploymentCommit,
    deploymentId,
    qaLabel,
    qaAttestation,
    storageStatePath,
    wavPath,
    wavSha256,
    wavProvenance,
    expectedUtterance,
    wantsMap,
  };
}

/** Public identity GET. Keeps only the status and the two observed fields. */
async function observeVersion(prereqs: FinalPrereqs): Promise<VersionObservation> {
  const response = await fetch(`${prereqs.baseUrl}/api/version`, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const body: unknown = await response.json().catch(() => null);
  const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const gitCommitSha = typeof fields.gitCommitSha === "string" ? fields.gitCommitSha : null;
  const deploymentId = typeof fields.deploymentId === "string" ? fields.deploymentId : null;
  return {
    at: new Date().toISOString(),
    status: response.status,
    gitCommitSha,
    deploymentId,
    matches:
      response.status === 200 &&
      gitCommitSha === prereqs.deploymentCommit &&
      deploymentId === prereqs.deploymentId,
  };
}

/** An ElevenLabs WebSocket. The signed URL itself is never kept. */
function isProviderSocket(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "elevenlabs.io" || host.endsWith(".elevenlabs.io");
  } catch {
    return false;
  }
}

function pcm16MonoWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Idempotent. The first caller (watchdog, finally or afterEach) closes; later callers await that close. */
function closeOwned(owned: OwnedBrowser, by: string): Promise<void> {
  const browser = owned.browser;
  if (!browser) return Promise.resolve();
  owned.closing ??= (async () => {
    owned.closedBy = by;
    owned.closeRequestedAt = Date.now();
    try {
      await browser.close();
      if (!browser.isConnected()) owned.closeConfirmedAt = Date.now();
    } catch (error) {
      owned.closeError = describeError(error);
    }
  })();
  return owned.closing;
}

/** Observes already-received frames and never acts. Stops at the deadline or once the owned browser closes. */
async function waitForFrame<T>(
  probe: () => T | undefined,
  by: number,
  owned: OwnedBrowser,
  what: string,
): Promise<T> {
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (owned.closing) throw new Error(`the owned browser closed while waiting for ${what}`);
    if (Date.now() >= by) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

async function anyVisible(locator: Locator): Promise<boolean> {
  for (const candidate of await locator.all()) {
    if (await candidate.isVisible()) return true;
  }
  return false;
}

/**
 * Fails before Start unless the visible UI shows a signed-in, prepared Pal with
 * consent answered. No hydration guess and no retried tap are needed here:
 * PubPalVoice renders "Start voice chat" only inside PubPalVoiceSession, which
 * it imports with next/dynamic ssr:false behind a client-side availability
 * probe, so the button is never server painted. Once it is visible and enabled,
 * React rendered it on the client with its onClick attached.
 */
async function expectPreparedPal(page: Page): Promise<void> {
  const refuse = (why: string) =>
    new Error(`FINAL prerequisite missing, Start was not pressed: ${why}`);
  const path = new URL(page.url()).pathname;
  if (path !== "/pal") {
    throw refuse(
      `/pal landed on ${path}; the storageState is not a signed-in QA session with a prepared Pal`,
    );
  }
  const start = page.getByRole("button", { name: "Start voice chat" });
  const offline = page.getByRole("status").filter({ hasText: /^Voice is (unavailable|muted)/ });
  try {
    await expect(start.or(offline).first()).toBeVisible({ timeout: 20_000 });
  } catch {
    throw refuse(
      "no Start voice chat on /pal; sign in, prepare the Pal and finish its first visit in the normal UI before exporting storageState",
    );
  }
  if (await anyVisible(offline)) {
    throw refuse("the Pal says voice is unavailable or muted on this deployment");
  }
  try {
    await expect(start).toBeEnabled({ timeout: 5_000 });
  } catch {
    throw refuse("Start voice chat is visible but disabled");
  }
  const signIn = page
    .getByRole("link", { name: /^(sign in|log in)$/i })
    .or(page.getByRole("button", { name: /^(sign in|log in)$/i }));
  if (await anyVisible(signIn)) {
    throw refuse("the page shows a sign-in prompt; the storageState is not signed in");
  }
  const consentPrompt = page
    .getByRole("dialog", { name: /consent|cookie|analytics|privacy/i })
    .or(page.getByRole("alertdialog", { name: /consent|cookie|analytics|privacy/i }));
  // Presence only: reads whether the normal UI recorded a consent answer, never sets one.
  const consentAnswered = await page.evaluate(
    (key) => window.localStorage.getItem(key) !== null,
    FINAL_CONSENT_KEY,
  );
  if (!consentAnswered || (await anyVisible(consentPrompt))) {
    throw refuse(
      "analytics consent is unanswered; answer it in the normal UI before exporting storageState",
    );
  }
}

/** Normal cleanup through the visible End. Never throws: an unconfirmed close comes back as detail. */
async function endVisibly(
  page: Page,
  mobile: boolean,
  openSockets: () => number,
  by: number,
): Promise<{ endClickedAt?: number; socketsClosedAt?: number; detail?: string }> {
  const result: { endClickedAt?: number; socketsClosedAt?: number; detail?: string } = {};
  try {
    const end = page.getByRole("button", { name: "End", exact: true });
    if (await end.isVisible()) {
      if (mobile) await end.tap({ timeout: msUntil(by) });
      else await end.click({ timeout: msUntil(by) });
      result.endClickedAt = Date.now();
    }
    while (openSockets() > 0) {
      if (Date.now() >= by) {
        throw new Error("the provider WebSocket was still open at the End deadline");
      }
      await sleep(100);
    }
    result.socketsClosedAt = Date.now();
  } catch (error) {
    result.detail = describeError(error);
  }
  return result;
}

async function runFinalViewport(viewport: FinalViewport, testInfo: TestInfo): Promise<void> {
  if (testInfo.retry !== 0 || testInfo.project.repeatEach !== 1 || testInfo.config.workers !== 1) {
    throw new Error(
      "FINAL needs --workers=1, retries 0 and no --repeat-each: anything else could repeat a billable Start",
    );
  }
  if (finalHalted) {
    throw new Error("an earlier FINAL case failed or closed ambiguously; no further connection starts");
  }
  const connectionsUsed = finalResults.filter((result) => result.started).length;
  if (
    connectionsUsed >= FINAL_VIEWPORTS.length ||
    finalProviderMsUsed + FINAL_CONNECTION_LIMIT_MS > FINAL_COMBINED_LIMIT_MS
  ) {
    throw new Error(
      `FINAL connection budget is spent: ${connectionsUsed} connections, ${finalProviderMsUsed}ms`,
    );
  }
  const prereqs = finalPrerequisites();
  const base = `${FINAL_EVIDENCE_DIR}/${viewport.name}`;
  await mkdir(FINAL_EVIDENCE_DIR, { recursive: true });
  // A failed case must never sit beside an earlier run's files and pass for its evidence.
  await Promise.all(
    [".json", ".png", "-reply.wav"].map((suffix) => rm(`${base}${suffix}`, { force: true })),
  );
  if (finalResults.length === 0) await rm(`${FINAL_EVIDENCE_DIR}/result.json`, { force: true });

  const failures: string[] = [];
  const owned: OwnedBrowser = {};
  finalActive = owned;
  const userTranscripts: FinalTurn[] = [];
  const agentResponses: FinalTurn[] = [];
  const audioChunks: { at: number; pcm: Buffer }[] = [];
  const frameCounts = new Map<string, number>();
  const timing: Record<string, number | undefined> = {};
  let audioFormat: string | undefined;
  let receivedAudioBytes = 0;
  let retainedAudioBytes = 0;
  let audioOverflow = false;
  let lastAudioAt = 0;
  let socketsOpened = 0;
  let openSockets = 0;
  let socketsClosedAt: number | undefined;
  let clickAt: number | undefined;
  let watchdogFiredAt: number | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let heard: FinalTurn | undefined;
  let selectedReply: FinalTurn | undefined;
  let before: VersionObservation | undefined;
  let screenshotPath: string | undefined;
  const since = () => (clickAt === undefined ? 0 : Date.now() - clickAt);
  const rel = (at: number | undefined) =>
    at === undefined || clickAt === undefined ? undefined : at - clickAt;

  // Allowlisted fields only: no raw frames, signed URL or auth leave this handler.
  const onProviderFrame = (payload: string | Buffer) => {
    let event: {
      type?: unknown;
      conversation_initiation_metadata_event?: { agent_output_audio_format?: unknown };
      user_transcription_event?: { user_transcript?: unknown };
      agent_response_event?: { agent_response?: unknown };
      audio_event?: { audio_base_64?: unknown };
    };
    try {
      event = JSON.parse(payload.toString());
    } catch {
      frameCounts.set("unparsed", (frameCounts.get("unparsed") ?? 0) + 1);
      return;
    }
    const type =
      typeof event.type === "string" && /^[a-z_]{1,64}$/.test(event.type) ? event.type : "other";
    if (frameCounts.has(type) || frameCounts.size < 32) {
      frameCounts.set(type, (frameCounts.get(type) ?? 0) + 1);
    }
    const at = since();
    if (type === "conversation_initiation_metadata") {
      const format = event.conversation_initiation_metadata_event?.agent_output_audio_format;
      if (typeof format === "string") audioFormat = format.slice(0, 64);
    } else if (type === "user_transcript") {
      const text = event.user_transcription_event?.user_transcript;
      if (typeof text === "string" && userTranscripts.length < 20) {
        userTranscripts.push({ at, text: text.slice(0, 2_000) });
      }
    } else if (type === "agent_response") {
      const text = event.agent_response_event?.agent_response;
      if (typeof text === "string" && agentResponses.length < 20) {
        agentResponses.push({ at, text: text.slice(0, 4_000) });
      }
    } else if (type === "audio") {
      const encoded = event.audio_event?.audio_base_64;
      if (typeof encoded !== "string" || !encoded) return;
      const pcm = Buffer.from(encoded, "base64");
      receivedAudioBytes += pcm.length;
      lastAudioAt = at;
      if (audioOverflow || retainedAudioBytes + pcm.length > FINAL_AUDIO_CAP_BYTES) {
        audioOverflow = true;
        return;
      }
      retainedAudioBytes += pcm.length;
      audioChunks.push({ at, pcm });
    }
  };

  try {
    before = await observeVersion(prereqs);
    if (!before.matches) {
      throw new Error(
        `/api/version before is ${before.status} ${before.gitCommitSha} ${before.deploymentId}, not the supplied deployment`,
      );
    }
    // One owned browser per case: a fresh single-pass fake capture, and a close
    // that can never touch a shared browser.
    const browser = await chromium.launch({
      ...(PROOF_BROWSER_CHANNEL ? { channel: PROOF_BROWSER_CHANNEL } : {}),
      timeout: 20_000,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${prereqs.wavPath}%noloop`,
      ],
    });
    owned.browser = browser;
    const context = await browser.newContext({
      storageState: prereqs.storageStatePath,
      viewport: { width: viewport.width, height: viewport.height },
      ...(viewport.mobile
        ? {
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 3,
            ...(FINAL_MOBILE_USER_AGENT ? { userAgent: FINAL_MOBILE_USER_AGENT } : {}),
          }
        : {}),
    });
    await context.grantPermissions(["microphone"], { origin: prereqs.origin });
    const page = await context.newPage();
    page.on("websocket", (socket) => {
      if (!isProviderSocket(socket.url())) return;
      socketsOpened += 1;
      openSockets += 1;
      timing.firstSocketOpenMs ??= since();
      socket.on("close", () => {
        openSockets -= 1;
        if (openSockets === 0) socketsClosedAt = Date.now();
      });
      socket.on("framereceived", ({ payload }) => onProviderFrame(payload));
    });

    await page.goto(`${prereqs.baseUrl}/pal`, { waitUntil: "load", timeout: 30_000 });
    await expectPreparedPal(page);
    if (socketsOpened > 0) {
      throw new Error("a provider WebSocket opened before Start; Start was not pressed");
    }

    // The single intentional Start: no toPass, no retry, no second call after a failure.
    const start = page.getByRole("button", { name: "Start voice chat" });
    const clickedAt = Date.now();
    clickAt = clickedAt;
    // The independent deadline. It closes this case's own browser, and with it
    // the page, context and provider socket, whatever the test is awaiting.
    watchdog = setTimeout(() => {
      watchdogFiredAt = Date.now();
      void closeOwned(owned, "watchdog");
    }, FINAL_WATCHDOG_MS);
    const interactionBy = clickedAt + FINAL_INTERACTION_MS;
    try {
      if (viewport.mobile) await start.tap({ timeout: 5_000 });
      else await start.click({ timeout: 5_000 });
      await page
        .getByRole("status")
        .filter({ hasText: "Pal is listening" })
        .waitFor({ state: "visible", timeout: msUntil(interactionBy) });
      timing.listeningMs = since();

      const spoken = await waitForFrame(
        () => userTranscripts.find((turn) => turn.text.trim() !== ""),
        interactionBy,
        owned,
        "the first final user_transcript",
      );
      heard = spoken;
      timing.userTranscriptMs = spoken.at;
      const missing = sohoRequestProblems(spoken.text, prereqs.wantsMap);
      if (missing.length > 0) {
        throw new Error(
          `user_transcript "${spoken.text}" is not the approved request: missing or wrong ${missing.join(", ")}`,
        );
      }
      const reply = await waitForFrame(
        () => agentResponses.find((turn) => turn.at >= spoken.at && turn.text.trim() !== ""),
        interactionBy,
        owned,
        "an agent_response after the spoken request",
      );
      selectedReply = reply;
      timing.agentResponseMs = reply.at;
      const firstReplyAudio = await waitForFrame(
        () => audioChunks.find((chunk) => chunk.at >= reply.at),
        interactionBy,
        owned,
        "audio after the selected agent response",
      );
      timing.firstReplyAudioMs = firstReplyAudio.at;
      // Let the reply finish streaming; a reply cut off at the deadline is not accepted.
      while (since() - lastAudioAt < FINAL_REPLY_SETTLE_MS) {
        if (owned.closing) throw new Error("the owned browser closed while the reply was streaming");
        if (Date.now() >= interactionBy) {
          throw new Error(
            "reply audio was still streaming at the interaction deadline; its WAV would be truncated",
          );
        }
        await sleep(100);
      }
      timing.replySettledMs = since();
      await page.screenshot({
        path: `${base}.png`,
        fullPage: true,
        timeout: msUntil(clickedAt + FINAL_END_BY_MS - 3_000),
      });
      screenshotPath = `${base}.png`;
    } finally {
      if (!owned.closing) {
        const ended = await endVisibly(
          page,
          viewport.mobile,
          () => openSockets,
          clickedAt + FINAL_END_BY_MS,
        );
        timing.endClickedMs = rel(ended.endClickedAt);
        timing.endSocketsClosedMs = rel(ended.socketsClosedAt);
        if (ended.detail) {
          failures.push(`visible End did not confirm the provider socket closed: ${ended.detail}`);
        }
      }
    }
  } catch (error) {
    failures.push(describeError(error));
  } finally {
    // Every path ends here: close this case's own browser, then disarm the watchdog.
    await closeOwned(owned, "finally");
    if (watchdog) clearTimeout(watchdog);
    finalActive = undefined;
  }

  let connectionMs: number | null = null;
  if (clickAt !== undefined) {
    const endedAt = Math.min(
      openSockets === 0 && socketsClosedAt !== undefined ? socketsClosedAt : Infinity,
      owned.closeConfirmedAt ?? Infinity,
    );
    connectionMs = Number.isFinite(endedAt) ? endedAt - clickAt : null;
    finalProviderMsUsed += connectionMs ?? FINAL_CONNECTION_LIMIT_MS;
    if (connectionMs === null) {
      failures.push("neither the provider socket close nor the owned browser close was confirmed");
    } else if (connectionMs > FINAL_CONNECTION_LIMIT_MS) {
      failures.push(
        `the connection lasted ${connectionMs}ms, over the ${FINAL_CONNECTION_LIMIT_MS}ms ceiling`,
      );
    }
    if (watchdogFiredAt !== undefined) {
      failures.push(`the ${FINAL_WATCHDOG_MS}ms watchdog fired and closed the owned browser`);
    }
    if (socketsOpened !== 1) {
      failures.push(`${socketsOpened} provider WebSockets opened after Start; expected exactly one`);
    }
    const spokenTurns = userTranscripts.filter((turn) => turn.text.trim() !== "").length;
    if (spokenTurns > 1) {
      failures.push(`${spokenTurns} final user transcripts in one connection; the WAV plays once`);
    }
    if (audioOverflow) {
      failures.push(
        `provider audio passed the ${FINAL_AUDIO_CAP_BYTES}-byte cap; the evidence would be truncated`,
      );
    }
  }
  if (
    owned.browser &&
    (owned.closeError !== undefined || owned.closeConfirmedAt === undefined)
  ) {
    failures.push(
      `the owned browser close was not confirmed${owned.closeError ? `: ${owned.closeError}` : ""}`,
    );
  }

  const sampleRate = audioFormat ? FINAL_PCM_RATES.get(audioFormat) : undefined;
  let replyAudioBytes = 0;
  let wavPath: string | undefined;
  if (heard && selectedReply) {
    const selectedReplyAt = selectedReply.at;
    const pcm = Buffer.concat(
      audioChunks.filter((chunk) => chunk.at >= selectedReplyAt).map((chunk) => chunk.pcm),
    );
    replyAudioBytes = pcm.length;
    if (!sampleRate) {
      failures.push(
        `provider output format ${audioFormat ?? "(not declared)"} is not an allowlisted 16-bit LE mono PCM format; no WAV built`,
      );
    } else if (pcm.length === 0 || pcm.length % 2 !== 0) {
      failures.push(`reply PCM is ${pcm.length} bytes, not whole 16-bit samples; no WAV built`);
    } else if (!audioOverflow) {
      wavPath = `${base}-reply.wav`;
      await writeFile(wavPath, pcm16MonoWav(pcm, sampleRate));
    }
  }

  let after: VersionObservation | undefined;
  if (before) {
    try {
      after = await observeVersion(prereqs);
      if (!after.matches) {
        failures.push(
          `/api/version after is ${after.status} ${after.gitCommitSha} ${after.deploymentId}, not the supplied deployment`,
        );
      }
    } catch (error) {
      failures.push(`/api/version after failed: ${describeError(error)}`);
    }
  }

  const evidence = {
    labels: ["CONTROLLED INPUT", viewport.mobile ? "MOBILE WEB" : "DESKTOP WEB", FINAL_LIMIT_LABEL],
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    qa: {
      label: prereqs.qaLabel,
      attestation: prereqs.qaAttestation,
      storageState: "supplied Playwright storageState path handed to the browser context; never read by this spec",
    },
    input: {
      wavPath: prereqs.wavPath,
      sha256: prereqs.wavSha256,
      provenance: prereqs.wavProvenance,
      expectedUtterance: prereqs.expectedUtterance,
      route:
        "Chromium --use-file-for-fake-audio-capture=<PUB_PAL_PROOF_WAV>%noloop with --use-fake-device-for-media-stream, through the product microphone path",
    },
    deployment: {
      expected: { gitCommitSha: prereqs.deploymentCommit, deploymentId: prereqs.deploymentId },
      before: before ?? null,
      after: after ?? null,
    },
    timing: {
      startedAt: clickAt === undefined ? null : new Date(clickAt).toISOString(),
      ...timing,
      watchdogMs: FINAL_WATCHDOG_MS,
      watchdogFiredMs: rel(watchdogFiredAt) ?? null,
      closedBy: owned.closedBy ?? null,
      closeRequestedMs: rel(owned.closeRequestedAt) ?? null,
      closeConfirmedMs: rel(owned.closeConfirmedAt) ?? null,
      connectionMs,
      connectionLimitMs: FINAL_CONNECTION_LIMIT_MS,
    },
    provider: {
      socketsOpened,
      agentOutputAudioFormat: audioFormat ?? null,
      frameCounts: Object.fromEntries(frameCounts),
    },
    transcript: {
      matched: heard?.text ?? null,
      selectedReply: selectedReply ?? null,
      userTranscripts,
      agentResponses,
    },
    audio: {
      receivedBytes: receivedAudioBytes,
      replyBytes: replyAudioBytes,
      sampleRate: sampleRate ?? null,
      capBytes: FINAL_AUDIO_CAP_BYTES,
      overflow: audioOverflow,
      wavPath: wavPath ?? null,
      note: "This WAV contains provider-declared PCM received on or after the selected agent_response. Its reply boundary and text are recorded in transcript.selectedReply; physical speaker output was not tested.",
    },
    screenshotPath: screenshotPath ?? null,
    turns: { spoken: clickAt === undefined ? 0 : 1, typed: 0 },
    failures,
  };
  await writeFile(`${base}.json`, `${JSON.stringify(evidence, null, 2)}\n`);

  finalResults.push({
    viewport: viewport.name,
    started: clickAt !== undefined,
    passed: failures.length === 0,
    connectionMs,
    failures,
  });
  const spokenUsed = finalResults.filter((result) => result.started).length;
  const result = {
    labels: ["CONTROLLED INPUT", "DESKTOP WEB", "MOBILE WEB", FINAL_LIMIT_LABEL],
    selection: PROOF_SELECTION,
    deployment: { gitCommitSha: prereqs.deploymentCommit, deploymentId: prereqs.deploymentId },
    qaLabel: prereqs.qaLabel,
    input: {
      sha256: prereqs.wavSha256,
      provenance: prereqs.wavProvenance,
      expectedUtterance: prereqs.expectedUtterance,
    },
    connections: spokenUsed,
    providerMsUsed: finalProviderMsUsed,
    combinedLimitMs: FINAL_COMBINED_LIMIT_MS,
    turns: {
      budgetTotal: FINAL_TURN_BUDGET,
      spokenUsed,
      typedUsed: 0,
      remainingForManualMapAndMemory: FINAL_TURN_BUDGET - spokenUsed,
    },
    manualAcceptance: "Map, 3D and memory checks remain manual; this spec claims none of them.",
    viewports: finalResults,
  };
  await writeFile(`${FINAL_EVIDENCE_DIR}/result.json`, `${JSON.stringify(result, null, 2)}\n`);

  if (failures.length > 0) finalHalted = true;
  expect(failures, `FINAL ${viewport.label} failed; evidence in ${FINAL_EVIDENCE_DIR}`).toEqual([]);
}

test.describe("Pub Pal FINAL voice proof", () => {
  test.skip(!FINAL_SELECTED, "FINAL runs only with PUB_PAL_PROOF_SELECTION=final");
  // Serial: a failed desktop case skips mobile web, so no further connection starts.
  test.describe.configure({ mode: "serial", retries: 0 });
  // Lifecycle backstop: if a case body is abandoned on a timeout, its owned browser still closes.
  test.afterEach(async () => {
    if (finalActive) await closeOwned(finalActive, "afterEach");
  });

  for (const viewport of FINAL_VIEWPORTS) {
    // eslint-disable-next-line no-empty-pattern
    test(`FINAL ${viewport.label}: one controlled spoken Soho request`, async ({}, testInfo) => {
      test.setTimeout(150_000);
      try {
        await runFinalViewport(viewport, testInfo);
      } catch (error) {
        finalHalted = true;
        throw error;
      }
    });
  }
});
