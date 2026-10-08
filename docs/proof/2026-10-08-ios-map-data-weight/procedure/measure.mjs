import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const template=readFileSync(new URL('./sample.js', import.meta.url),'utf8');
mkdirSync('artifacts/lane-e/original-replay', { recursive: true });
for(let round=1;round<=5;round++) {
for (const [variant,port] of [['before',3481],['after',3482]]) {
const input=template.replace('ORIGIN',JSON.stringify(`http://127.0.0.1:${port}`)).replace('ROUND',String(round));
const raw=execFileSync('chrome-devtools-axi',['run'],{input,encoding:'utf8',timeout:60_000,env:{...process.env,CHROME_DEVTOOLS_AXI_SESSION:'pubmax-ios-lane-e'}});
const data=JSON.parse(raw.trim());
writeFileSync(`artifacts/lane-e/original-replay/${variant}-${round}.json`,JSON.stringify(data,null,2));
console.log(JSON.stringify({round,variant,cold:{requests:data.cold.price.requests,waterfall:data.cold.price.waterfallMs,pins:data.cold.firstPinsMs},warmMap:{prices:data.warmMap.price.requests,whats:data.warmMap.whats.requests,answer:data.warmMap.firstSurfaceAnswerMs},warmTonight:{whats:data.warmTonight.whats.requests,answer:data.warmTonight.firstSurfaceAnswerMs}}));
}
}

