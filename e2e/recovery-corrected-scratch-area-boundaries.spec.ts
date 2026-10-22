import { expect, test, type Page } from '@playwright/test';
import { installDeterministicMapBasemap } from './helpers/mapNetworkFixtures';
import { writeFileSync } from 'node:fs';
const E='/Users/karanmanoharan/.codex/visualizations/2026/10/09/01a1221b-f805-78e1-82c3-4eeb27d73308/pr2078-reverification-20261011/raw/keyless';
const KINGSTON='Kingston Market Place closed following fire';
test.setTimeout(120_000);
async function setup(page:Page,width:number,theme:string,signals:any[],tubeLines:any[]=[],suggestDismiss=true){
 await page.setViewportSize({width,height:width===390?844:900});
 await page.emulateMedia({reducedMotion:'reduce',colorScheme:theme as 'light'|'dark'});
 await installDeterministicMapBasemap(page);
 await page.addInitScript(({theme,suggestDismiss})=>{
  localStorage.setItem('pubmax-theme',theme);
  localStorage.setItem('pubmax:map-first-visit-arrival:v1','dismissed');
  localStorage.setItem('pubmax-tour-v1-done','1');
  localStorage.setItem('pubmax_onboarding_dismissed','1');
  sessionStorage.setItem('pubmax_onboarding_dismissed','1');
  localStorage.setItem('pubmaxx:analytics-consent:v1','denied');
  if(suggestDismiss)sessionStorage.setItem('pubmax:citySuggestDismiss:v1','1');
 },{theme,suggestDismiss});
 await page.route('**/api/citymcp/status**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({signals,tubeLines,weather:null})}));
}
async function loaded(page:Page){await expect(page.locator('.mapLoading')).toBeHidden({timeout:45000});await expect(page.locator('.citySwitcherTrigger').filter({visible:true})).toBeVisible();}
async function choose(page:Page,name:string,match:RegExp|string){
 await page.locator('.citySwitcherTrigger').filter({visible:true}).click();
 await page.getByRole('button',{name:'This area',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search areas and postcodes'}).fill(name);
 await page.locator('.chooseAreaSheet').filter({visible:true}).getByRole('button',{name:match,exact:typeof match==='string'}).click();
 await expect(page.getByRole('searchbox',{name:'Search areas and postcodes'})).toBeHidden();
}
async function read(page:Page){return page.evaluate(()=>{const p=(window as any).__pubmaxMapCamera;if(!p)throw Error('camera absent');return p.read() as {center:[number,number],zoom:number,moving:boolean,settling:boolean};});}
async function settled(page:Page){await expect.poll(async()=>{const c=await read(page);return !c.moving&&!c.settling;}).toBe(true);}
async function pan(page:Page,target:[number,number]){
 for(let i=0;i<12&&(await read(page)).zoom>9.5;i++){await page.getByRole('button',{name:'Zoom out',exact:true}).click();await settled(page);}
 for(let i=0;i<18;i++){
  const c=await read(page);if(Math.abs(c.center[0]-target[0])<.012&&Math.abs(c.center[1]-target[1])<.012)break;
  const delta=await page.evaluate(target=>{const p=(window as any).__pubmaxMapCamera;const a=p.project(p.read().center),b=p.project(target);return {x:a.x-b.x,y:a.y-b.y};},target);
  await page.mouse.move(950,550);await page.mouse.down();await page.mouse.move(950+Math.max(-220,Math.min(220,delta.x)),550+Math.max(-220,Math.min(220,delta.y)),{steps:25});await page.mouse.up();await settled(page);
 }
 for(let i=0;i<5;i++){await page.getByRole('button',{name:'Zoom in',exact:true}).click();await settled(page);}
 const c=await read(page);expect(Math.abs(c.center[0]-target[0])).toBeLessThan(.015);expect(Math.abs(c.center[1]-target[1])).toBeLessThan(.015);return c;
}
for(const theme of ['light','dark']){
 test(`Kent Kingston public arrival stays non-London after local and Bermondsey pans ${theme}`,async({page})=>{
  await setup(page,1440,theme,[{headline:KINGSTON,severity:'major',areas:['Kingston']},{headline:'Bermondsey fire',severity:'major',areas:['Bermondsey']},{headline:'London-wide disruption',severity:'major',areas:['London']}],[{line:'Northern',status:'Severe Delays'}]);
  await page.goto('/map?place=Kingston&lat=51.2179817&lng=1.1512973');await loaded(page);await settled(page);
  await expect(page.locator('.ukPlaceArrival')).toContainText('Kingston');await expect(page.locator('.cityStatusStack')).toHaveCount(0);
  await page.screenshot({path:`${E}/kent-arrival-${theme}.png`});
  await page.mouse.move(950,550);await page.mouse.down();await page.mouse.move(1030,600,{steps:25});await page.mouse.up();await settled(page);
  await expect(page.locator('.cityStatusStack')).toHaveCount(0);
  const camera=await pan(page,[-.082,51.504]);await expect(page.locator('.cityStatusStack')).toHaveCount(0);await expect(page.locator('.ukPlaceArrival')).toContainText('Kingston');
  writeFileSync(`${E}/kent-to-bermondsey-${theme}.json`,JSON.stringify({camera,url:page.url(),bannerCount:await page.locator('.cityStatusStack').count()},null,2));
  await page.screenshot({path:`${E}/kent-to-bermondsey-${theme}.png`});
 });
 test(`London public arrival follows Kingston selection then settled Bermondsey pan ${theme}`,async({page})=>{
  await setup(page,1440,theme,[{headline:KINGSTON,severity:'major',areas:['Kingston']},{headline:'Bermondsey fire',severity:'major',areas:['Bermondsey']}]);
  await page.goto('/map?place=Bermondsey&lat=51.4924261&lng=-0.062629');await loaded(page);await choose(page,'Kingston','Kingston upon Thames');
  await expect(page.locator('.cityStatusBannerCopy')).toHaveText(KINGSTON,{timeout:30000});
  const camera=await pan(page,[-.082,51.504]);await expect(page.locator('.cityStatusBannerCopy')).toHaveText('Bermondsey fire',{timeout:30000});await expect(page.locator('.cityStatusBannerCopy')).toBeVisible();
  writeFileSync(`${E}/london-arrival-pan-${theme}.json`,JSON.stringify({camera,label:await page.locator('.citySwitcherTrigger').filter({visible:true}).getAttribute('aria-label')},null,2));
  await page.screenshot({path:`${E}/london-arrival-pan-${theme}.png`});
 });
 test(`Richmond info signal cannot borrow excluded TfL severity after movement ${theme}`,async({page})=>{
  await setup(page,1440,theme,[{headline:'Richmond information',severity:'info',areas:['Richmond upon Thames']}],[{line:'Northern',status:'Severe Delays'}]);
  await page.goto('/map');await loaded(page);await expect(page.locator('.cityStatusBannerCopy')).toContainText('Northern',{timeout:30000});
  await choose(page,'Richmond','Richmond');await settled(page);await expect(page.locator('.cityStatusStack')).toHaveCount(0);
  await page.screenshot({path:`${E}/richmond-info-no-promoted-toast-${theme}.png`});
 });
 test(`Initial 768px unrelated view keeps Kingston news absent ${theme}`,async({page})=>{
  await setup(page,768,theme,[{headline:KINGSTON,severity:'major',areas:['Kingston']}],[],false);
  await page.goto('/map');await loaded(page);
  await expect(page.locator('.citySwitcherTrigger').filter({visible:true})).toHaveAttribute('aria-label',/Map area: London/);await expect(page.locator('.cityStatusStack')).toHaveCount(0);
  await expect(page.locator('.citySuggestBanner')).toBeVisible();await page.screenshot({path:`${E}/initial-tablet-hidden-status-${theme}.png`});
 });
 for(const width of [390,768])test(`Near me keeps its label and settles in Bermondsey ${width}px ${theme}`,async({page,context})=>{
  await setup(page,width,theme,[{headline:'Bermondsey fire',severity:'major',areas:['Bermondsey']}]);await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:51.504,longitude:-.082});
  await page.goto('/map');await loaded(page);await page.locator('.citySwitcherTrigger').filter({visible:true}).click();await page.getByRole('button',{name:'This area',exact:true}).click();await page.locator('.chooseAreaSheet').filter({visible:true}).getByRole('button',{name:'Near me',exact:true}).click();
  await expect(page.locator('.citySwitcherTrigger').filter({visible:true})).toHaveAttribute('aria-label',/Map area: Near me/);await settled(page);
  if(width===768){await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.getByRole('button',{name:'Zoom in',exact:true}).click();await settled(page);await expect(page.locator('.cityStatusBannerCopy')).toHaveText('Bermondsey fire',{timeout:30000});await expect(page.locator('.cityStatusBannerCopy')).toBeVisible();}
  else await expect(page.locator('.cityStatusStack')).toHaveCount(0);
  const c=await read(page);expect(Math.abs(c.center[0]+.082)).toBeLessThan(.015);expect(Math.abs(c.center[1]-51.504)).toBeLessThan(.015);await page.screenshot({path:`${E}/near-me-${width}-${theme}.png`});
 });
 for(const width of [390,768,1440])test(`Tonight Pins venue selection and Layers work ${width}px ${theme}`,async({page})=>{
  await setup(page,width,theme,[]);
  const startsAt=new Date(Date.now()+3600000).toISOString();const row={id:'area-proof-quiz',venueId:'venue-xjf3n0',placeName:'The Arnos Arms',kind:'quiz',startsAt,title:'Public proof quiz',source:{label:'Venue site',url:'https://example.com/quiz'},observedAt:new Date().toISOString(),confidence:'listed'};
  await page.route('**/api/whats-on**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({rows:[row],asOf:new Date().toISOString(),servedAt:new Date().toISOString()})}));
  await page.goto('/map');await loaded(page);
  if(width===390){await page.getByRole('button',{name:'More map controls'}).click();await page.getByRole('tab',{name:'Events',exact:true}).click();}
  else await page.getByTestId('tonight-lane-chip').click();
  await expect(page.locator('.tonightLane--open').filter({visible:true})).toBeVisible();
  const pins=page.getByTestId('tonight-overlay-toggle').filter({visible:true});await expect(pins).toBeVisible();const initial=await pins.getAttribute('aria-pressed');await pins.click();await expect(pins).toHaveAttribute('aria-pressed',initial==='true'?'false':'true');
  await page.screenshot({path:`${E}/tonight-pins-${width}-${theme}.png`});
  await page.locator('button.tonightLaneCardTap').filter({visible:true}).click();await expect.poll(()=>new URL(page.url()).searchParams.get('sel')).toBe('venue-xjf3n0');
  await expect(page.locator('.appShell')).toHaveClass(/detail-open/);await page.screenshot({path:`${E}/tonight-venue-${width}-${theme}.png`});
  await page.keyboard.press('Escape');await expect(page.locator('.appShell')).not.toHaveClass(/detail-open/);
  if(width===390){if(!await page.locator('.mobileSheetPortal[data-sheet-kind="layers"]').isVisible())await page.getByRole('button',{name:'More map controls'}).click();await page.getByRole('tab',{name:'Layers',exact:true}).click();await expect(page.getByRole('tab',{name:'Layers',exact:true})).toHaveAttribute('aria-selected','true');}
  else{await page.locator('.mapLayersFab').click();await expect(page.locator('.mapLayersPanel')).toBeVisible();}
  const toggle=page.locator('.mapLayersPanel').filter({visible:true}).locator('button.mapLayersChip[aria-pressed]').first();await expect(toggle).toBeVisible();const before=await toggle.getAttribute('aria-pressed');await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed',before==='true'?'false':'true');
  await page.screenshot({path:`${E}/layers-${width}-${theme}.png`});
 });
}
