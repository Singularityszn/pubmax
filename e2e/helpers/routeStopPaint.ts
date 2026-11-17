import { expect, type Page } from "@playwright/test";

export async function expectSelectedRoutePaint(page: Page, point: [number, number]) {
  await expect.poll(async () => {
    const center = await page.evaluate((coordinate) => (window as typeof window & {
      __pubmaxMapCamera: { project(point: [number, number]): { x: number; y: number } };
    }).__pubmaxMapCamera.project(coordinate), point);
    const screenshot = await page.screenshot({ scale: "css", clip: {
      x: Math.floor(center.x) - 12, y: Math.floor(center.y) - 12, width: 24, height: 24,
    } });
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 33;
      canvas.height = 24;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--route-line").trim();
      context.fillRect(32, 0, 1, 1);
      const expected = context.getImageData(32, 0, 1, 1).data;
      return Math.max(...[[4, 4], [20, 4], [4, 20], [20, 20]].flatMap(([x, y]) => {
        const actual = context.getImageData(x!, y!, 1, 1).data;
        return [0, 1, 2].map((channel) => Math.abs(actual[channel]! - expected[channel]!));
      }));
    }, screenshot.toString("base64"));
  }, { message: "the selected route disc paints its route colour" }).toBeLessThan(16);
}
