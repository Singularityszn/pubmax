import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const results = [];
for (const name of ['social-video.mp4','social-video-faststart.mp4']) {
  const encoded = readFileSync(`__tests__/fixtures/${name}`).toString('base64');
  await page.setContent('<video muted controls></video>');
  results.push(await page.evaluate(async ({name, encoded}) => {
    const video = document.querySelector('video');
    video.src = 'data:video/mp4;base64,' + encoded;
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error(`decode error ${video.error?.code}`));
    });
    await video.play();
    await new Promise(resolve => video.ontimeupdate = () => { if (video.currentTime > 0.2) resolve(); });
    video.pause(); video.currentTime = 1;
    await new Promise(resolve => video.onseeked = resolve);
    return { name, width: video.videoWidth, height: video.videoHeight, duration: video.duration, currentTime: video.currentTime, readyState: video.readyState, error: video.error?.code ?? null };
  }, {name, encoded}));
}
console.log(JSON.stringify(results, null, 2));
writeFileSync('__tests__/fixtures/social-video-playback.json', JSON.stringify(results, null, 2)+'\n');
await browser.close();
