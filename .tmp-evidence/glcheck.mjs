import { chromium } from "playwright";
for (const args of [[], ["--enable-unsafe-swiftshader"], ["--use-gl=angle", "--use-angle=swiftshader"]]) {
  const b = await chromium.launch({ args });
  const p = await b.newPage();
  const r = await p.evaluate(() => {
    const c = document.createElement("canvas");
    const g2 = c.getContext("webgl2");
    const c1 = document.createElement("canvas");
    const g1 = c1.getContext("webgl");
    return { webgl2: !!g2, webgl1: !!g1, renderer: g2 ? g2.getParameter(g2.getParameter ? 0x1f01 : 0) : null };
  });
  console.log(JSON.stringify(args), JSON.stringify(r));
  await b.close();
}
