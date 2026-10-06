import { describe, expect, it, vi } from "vitest";

import {
  FIREWALL_HEADER,
  FirewallDenyError,
  isFirewallDeny,
  untilNoFirewallDeny,
  untilNot429,
} from "../e2e/prod-smoke/firewall";

// A 429 from Vercel's edge firewall is infrastructure, and a 429 from the app is
// a limiter doing its job. The smoke run retries both, but it only names the
// first as infrastructure, because only the platform sets x-vercel-mitigated.

const deny = { status: 429, headers: { [FIREWALL_HEADER]: "deny" }, url: "https://x/api/saved-pubs" };
const appLimit = { status: 429, headers: {}, url: "https://x/api/saved-pubs" };
const ok = { status: 200, headers: {}, url: "https://x/api/saved-pubs" };
type Answer = typeof ok;
const noSleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
const asAnswer = (value: Answer): Answer => value;

describe("isFirewallDeny", () => {
  it("is true only for a 429 that carries the platform header", () => {
    expect(isFirewallDeny(deny)).toBe(true);
    expect(isFirewallDeny(appLimit)).toBe(false);
    expect(isFirewallDeny({ status: 200, headers: { [FIREWALL_HEADER]: "deny" } })).toBe(false);
  });

  it("reads the header whatever its case", () => {
    expect(isFirewallDeny({ status: 429, headers: { "X-Vercel-Mitigated": "deny" } })).toBe(true);
    expect(isFirewallDeny({ status: 429, headers: new Headers({ [FIREWALL_HEADER]: "deny" }) })).toBe(true);
  });
});

describe("untilNot429", () => {
  it("returns the first answer that is not a 429, pausing longer each time", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const attempt = vi.fn<() => Promise<Answer>>().mockResolvedValueOnce(deny).mockResolvedValueOnce(appLimit).mockResolvedValueOnce(ok);
    await expect(untilNot429(attempt, asAnswer, sleep)).resolves.toBe(ok);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2_000, 4_000]);
  });

  it("names a deny that outlasts the retries as infrastructure", async () => {
    const attempt = vi.fn<() => Promise<Answer>>().mockResolvedValue(deny);
    const failure = await untilNot429(attempt, asAnswer, noSleep).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FirewallDenyError);
    expect((failure as Error).message).toMatch(/^INFRASTRUCTURE: Vercel's edge firewall denied/);
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it("hands back the app's own 429 so the caller's assertion reports it", async () => {
    const attempt = vi.fn<() => Promise<Answer>>().mockResolvedValue(appLimit);
    await expect(untilNot429(attempt, asAnswer, noSleep)).resolves.toBe(appLimit);
  });
});

describe("untilNoFirewallDeny", () => {
  it("repeats the whole step when a deny landed during it", async () => {
    let denies = 0;
    const step = vi.fn(async () => {
      denies += step.mock.calls.length === 1 ? 1 : 0;
      return "saved";
    });
    await expect(untilNoFirewallDeny(step, () => denies, noSleep)).resolves.toBe("saved");
    expect(step).toHaveBeenCalledTimes(2);
  });

  it("repeats a step that threw because of a deny, and never one that threw otherwise", async () => {
    let denies = 0;
    const flaky = vi.fn(async () => {
      if (flaky.mock.calls.length === 1) {
        denies += 1;
        throw new Error("save control never appeared");
      }
      return "saved";
    });
    await expect(untilNoFirewallDeny(flaky, () => denies, noSleep)).resolves.toBe("saved");

    const broken = vi.fn(async () => {
      throw new Error("real defect");
    });
    await expect(untilNoFirewallDeny(broken, () => 0, noSleep)).rejects.toThrow("real defect");
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it("reports a deny that never clears as infrastructure", async () => {
    let denies = 0;
    const step = vi.fn(async () => {
      denies += 1;
      return "never";
    });
    await expect(untilNoFirewallDeny(step, () => denies, noSleep, undefined, "the save journey")).rejects.toThrow(
      /INFRASTRUCTURE.*the save journey/,
    );
    expect(step).toHaveBeenCalledTimes(4);
  });
});
