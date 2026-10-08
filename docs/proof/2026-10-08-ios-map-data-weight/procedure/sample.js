const origin = ORIGIN;
await page.open(origin + '/places');
await page.eval(() => {localStorage.clear(); sessionStorage.clear(); return true;});
await page.open(origin + '/map?lane-e-proof=ROUND');
await page.eval(() => new Promise(resolve => setTimeout(resolve, 9_000)));
const collect = async (phase) => await page.eval(`() => {
const t0 = window.__laneET0 ?? 0;
const resources = performance.getEntriesByType('resource').filter(r => r.startTime >= t0);
const prices = resources.filter(r => r.name.includes('scope=provisional-base'));
const whats = resources.filter(r => r.name.includes('/api/whats-on?'));
const events = prices.flatMap(r => [[r.startTime,1],[r.responseEnd,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
let n=0, max=0; for (const e of events) {n+=e[1]; max=Math.max(n,max);}
const summary = rows => ({requests:rows.length,transferBytes:rows.reduce((n,r)=>n+r.transferSize,0),decodedBytes:rows.reduce((n,r)=>n+r.decodedBodySize,0),firstAnswerMs:rows.length?rows[0].responseEnd-t0:null,lastAnswerMs:rows.length?Math.max(...rows.map(r=>r.responseEnd))-t0:null,durationsMs:rows.map(r=>r.duration),statuses:rows.map(r=>r.responseStatus)});
const pins = performance.getEntriesByName('pubmax:pins-visible').filter(r=>r.startTime>=t0);
return {phase:'${phase}',price:{...summary(prices),ids:prices.flatMap(r=>new URL(r.name).searchParams.getAll('venueId')),maxConcurrent:max,waterfallMs:prices.length?Math.max(...prices.map(r=>r.responseEnd))-Math.min(...prices.map(r=>r.startTime)):null},whats:{...summary(whats),pubOnly:whats.map(r=>new URL(r.name).searchParams.get('pubOnly'))},firstPinsMs:pins.length?pins[0].startTime-t0:null,firstSurfaceAnswerMs:window.__laneEFirstAnswer??null,paintedPins:window.__pubmaxPaintedMapTapPoints?.().length??null,heapBytes:performance.memory?.usedJSHeapSize??null,camera:window.__pubmaxMapCamera?.read()??null};
}`);
const cold = await collect('cold-surface-map');
const navigate = async (path) => {
await page.eval(`() => {
performance.clearResourceTimings(); performance.clearMarks();
window.__laneET0=performance.now(); window.__laneEFirstAnswer=null;
window.__laneEObserver?.disconnect();
const observer = new MutationObserver(()=>{
const map = document.querySelector('button[aria-label^="On tonight:"][aria-label$=" listings"]');
const tonight = document.querySelector('.tonightPrimary');
if ((location.pathname==='/map' && map) || (location.pathname==='/tonight' && ['ready','empty'].includes(tonight?.dataset.status))) {
window.__laneEFirstAnswer=performance.now()-window.__laneET0; observer.disconnect();
}
});
observer.observe(document.body,{attributes:true,childList:true,subtree:true}); window.__laneEObserver=observer;
[...document.querySelectorAll('a[href="${path}"]')].find(a=>a.getBoundingClientRect().width)?.click(); return true;
}`);
await page.eval(() => new Promise(resolve => setTimeout(resolve, 3_000)));
};
await navigate('/tonight');
const firstTonight = await collect('first-tonight');
await navigate('/map');
const warmMap = await collect('warm-map');
await navigate('/tonight');
const warmTonight = await collect('warm-tonight');
console.log(JSON.stringify({cold,firstTonight,warmMap,warmTonight}));

