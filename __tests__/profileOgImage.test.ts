// @vitest-environment node
import { describe, expect, it } from "vitest";

import Image from "@/app/u/[handle]/opengraph-image";

// The profile share card is the preview every /u/<handle> link unfurls to. It
// once threw on every handle: `@{handle}` renders two text children, and satori
// refuses a div with more than one child unless it is display:flex, so the
// route answered with an empty body. This drives the real ImageResponse render.

describe("profile share card", () => {
  it("renders a PNG for a handle", async () => {
    const response = await Image({ params: Promise.resolve({ handle: "karan" }) });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
