import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const captureSource = readFileSync(
  resolve(process.cwd(), "components/moment/MomentCapture.tsx"),
  "utf8",
);
const editorSource = readFileSync(
  resolve(process.cwd(), "components/moment/MomentImageEditor.tsx"),
  "utf8",
);

describe("Moment photo editor wiring", () => {
  it("keeps editor package behind interaction-only dynamic import", () => {
    expect(captureSource).toContain('dynamic(() => import("./MomentImageEditor")');
    expect(captureSource).toContain("ssr: false");
    expect(captureSource).not.toContain("@unlayer/react-image-editor");
    expect(editorSource).toContain("@unlayer/react-image-editor");
  });

  it("replaces edited bytes before existing photo upload path", () => {
    expect(captureSource).toContain("setEditingMediaId(item.id)");
    expect(captureSource).toContain("onSave={finishPhotoEdit}");
    expect(captureSource).toContain('body.set("photo", item.blob, item.name)');
  });
});
