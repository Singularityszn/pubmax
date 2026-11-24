import { isAbsolute, join } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";

it("emits optional landing widgets outside the initial JavaScript chunks", async () => {
  const result = await build({
    configFile: false,
    envFile: false,
    publicDir: false,
    logLevel: "silent",
    resolve: { alias: { "@": process.cwd() } },
    css: { postcss: { plugins: [] } },
    build: {
      write: false,
      minify: false,
      lib: { entry: join(process.cwd(), "components/landing/LandingPage.tsx"), formats: ["es"] },
      rollupOptions: {
        external: (id) => !isAbsolute(id) && !id.startsWith(".") && !id.startsWith("@/"),
        preserveEntrySignatures: "strict",
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result])
    .flatMap((output) => "output" in output ? output.output : []);
  const chunks = outputs.filter((output) => output.type === "chunk");
  const entry = chunks.find((chunk) => chunk.isEntry);
  expect(entry).toBeDefined();
  const eager = new Set<string>();
  const pending = [entry!.fileName];
  while (pending.length) {
    const name = pending.pop()!;
    if (eager.has(name)) continue;
    eager.add(name);
    const chunk = chunks.find((candidate) => candidate.fileName === name);
    if (chunk) pending.push(...chunk.imports);
  }
  const modules = chunks.filter((chunk) => eager.has(chunk.fileName))
    .flatMap((chunk) => Object.keys(chunk.modules));
  expect(modules).toContain(join(process.cwd(), "components/landing/LandingPage.tsx"));
  for (const widget of [
    "PriceGlass", "DotFooter", "WildNightPreviewPicker", "RoundRota", "BoroughBingo",
    "NightFall", "PalHop", "LastOrdersBell", "PourLoader", "PintLine", "CrawlReceipt", "BeerMats", "PubSign",
  ]) {
    expect(modules).not.toContain(join(process.cwd(), `components/wild/${widget}.tsx`));
  }
});
