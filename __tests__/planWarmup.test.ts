import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { loadConciergeVenuesMock, loadBaselineWhatsOnMock } = vi.hoisted(() => ({
	loadConciergeVenuesMock: vi.fn(async () => []),
	loadBaselineWhatsOnMock: vi.fn(async () => []),
}));

vi.mock("@/lib/concierge/venues.server", () => ({
	loadConciergeVenues: loadConciergeVenuesMock,
}));
vi.mock("@/lib/planGeneration.server", () => ({
	loadPlanGenerationBaselineWhatsOn: loadBaselineWhatsOnMock,
}));

import { __resetPlanWarmup, warmPlanGeneration } from "@/lib/planWarmup.server";

// GET /api/plans/generate is an unauthenticated, unrate-limited warmup ping.
// The latch must collapse repeat hits into one store read per TTL window.
describe("warmPlanGeneration", () => {
	beforeEach(() => {
		__resetPlanWarmup();
		loadConciergeVenuesMock.mockClear();
		loadBaselineWhatsOnMock.mockClear();
		loadBaselineWhatsOnMock.mockResolvedValue([]);
	});

	it("shares one run across concurrent pings for the same city", async () => {
		let release!: () => void;
		loadBaselineWhatsOnMock.mockImplementation(
			() => new Promise<never[]>((resolve) => {
				release = () => resolve([]);
			}),
		);
		const first = warmPlanGeneration("london");
		const second = warmPlanGeneration("london");
		await vi.waitFor(() => expect(loadBaselineWhatsOnMock).toHaveBeenCalledTimes(1));
		release();
		await Promise.all([first, second]);
		expect(loadConciergeVenuesMock).toHaveBeenCalledTimes(1);
		expect(loadBaselineWhatsOnMock).toHaveBeenCalledTimes(1);
	});

	it("skips the store read inside the TTL window and reruns after it", async () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
		try {
			await warmPlanGeneration("london");
			await warmPlanGeneration("london");
			expect(loadBaselineWhatsOnMock).toHaveBeenCalledTimes(1);

			clock.mockReturnValue(1_000 + 60_001);
			await warmPlanGeneration("london");
			expect(loadBaselineWhatsOnMock).toHaveBeenCalledTimes(2);
		} finally {
			clock.mockRestore();
		}
	});

	it("keeps one latch per city", async () => {
		await warmPlanGeneration("london");
		await warmPlanGeneration("manchester");
		expect(loadBaselineWhatsOnMock).toHaveBeenCalledTimes(2);
	});

	it("still resolves when the What's-On read degrades", async () => {
		loadBaselineWhatsOnMock.mockRejectedValueOnce(new Error("store down"));
		await expect(warmPlanGeneration("london")).resolves.toBeUndefined();
	});
});
