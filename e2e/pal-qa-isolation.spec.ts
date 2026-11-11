import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PAL_DRAFT } from '../lib/pubPal';
import { ACCOUNTS, AUTH_STORAGE_KEY, DEVICE_ACCOUNTS_KEY, installAuthDoubles, seedSignedIn } from './helpers/authDoubles';
import { installDeterministicMapBasemap } from './helpers/mapNetworkFixtures';
import { createPlanIntakeDraft } from '../lib/planIntake';

test.describe.configure({ timeout: 120_000 });

const PLAN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STOPS = ['venue-1ufn31x', 'venue-1t8siin', 'venue-xiesdn'];
const EVIDENCE = process.env.PUBMAX_TEST_EVIDENCE_DIR;
const pal = {
  ...DEFAULT_PAL_DRAFT, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ownerId: ACCOUNTS.A.id,
  name: 'Ripley', adultAttestedAt: '2026-10-04T12:00:00.000Z', muted: false, hidden: false,
  proposalPreferences: {}, masteryPoints: 0, createdAt: '2026-10-04T12:00:00.000Z', updatedAt: '2026-10-04T12:00:00.000Z',
};
async function seed(page: Page) {
  await installAuthDoubles(page);
  await seedSignedIn(page, 'A');
  await page.addInitScript(({ pal, accounts, accountsKey }) => {
    if (sessionStorage.getItem('pal-privacy-seeded')) return;
    sessionStorage.setItem('pal-privacy-seeded', '1');
    localStorage.setItem('pubmax_account_owner', pal.ownerId);
    localStorage.setItem('pubmax_pub_pal_v1', JSON.stringify(pal));
    localStorage.setItem('pubmax:map-first-visit-arrival:v1', 'dismissed');
    localStorage.setItem('pubmax-tour-v1-done', '1');
    localStorage.setItem('pubmax_onboarding_dismissed', '1');
    localStorage.setItem('pubmax-theme', 'light');
    localStorage.setItem('pubmax:e2e-defer-shell:v1', 'now');
    localStorage.setItem(accountsKey, JSON.stringify(Object.values(accounts).map(account => ({userId:account.id,refreshToken:account.refreshToken,email:account.email,handle:account.handle,lastActiveAt:Date.now()}))));
  }, {pal, accounts: ACCOUNTS, accountsKey: DEVICE_ACCOUNTS_KEY});  // The map pill waits for the server's age rule; a test's own stub, added later, wins.
  await page.route('**/api/pub-pal', route => route.request().method()==='GET'
    ? route.fulfill({json:{under18:false,adultOnFile:true,pal}})
    : route.fallback());
}
async function switchToB(page: Page) {
  await page.getByRole('button', {name:/Account options/}).first().click();
  const menu=page.locator('.authAccountMenu');
  await menu.getByRole('button',{name:'Switch account',exact:true}).click();
  await menu.locator('.authSwitcherRow').filter({has:page.getByText('@'+ACCOUNTS.B.handle,{exact:true})}).click();
  await expect(page.getByRole('button',{name:'Account options for '+ACCOUNTS.B.name,exact:true})).toBeVisible();
  // Keep subsequent document navigations on the account selected through the UI.
  await page.evaluate(() => localStorage.setItem('__e2e_signed_in_account', 'B'));
}
async function shot(page: Page, name: string) {
  if (EVIDENCE) {
    await expect(page.locator(".mapLoading")).toBeHidden({timeout:60_000});
    await page.screenshot({path:`${EVIDENCE}/${name}.png`});
  }
}

test('account B opens Plan without account A\'s saved request or accessibility answers', async ({ page }) => {
  await seed(page);
  await page.goto('/plan');
  await expect(page.getByRole('button',{name:'Account options for '+ACCOUNTS.A.name,exact:true})).toBeVisible();
  const query = page.locator('#plan-describe-first-query');
  await query.fill('A private outing in Soho');
  await expect.poll(() => page.evaluate(() => {
    const raw = sessionStorage.getItem('pubmax:plan-draft:v2');
    return raw ? JSON.parse(raw).draft.conciergeQuery : null;
  })).toBe('A private outing in Soho');
  const intake = createPlanIntakeDraft({kind:'patch',id:'soho'});
  intake.answers.accessibilityNeeds = ['step-free'];
  await page.evaluate(({intake, stops}) => {
    const now = new Date().toISOString();
    // Additional private persisted inputs use the approved account-clearing
    // contract. The query itself was entered and saved by the real form.
    localStorage.setItem('pubmax:plan-intake:v1',JSON.stringify({
      storageVersion:1,savedAt:now,expiresAt:new Date(Date.now()+86400000).toISOString(),draft:intake,
    }));
    for (const key of ['pubmaxx:plan-route-draft:v1','pubmax:plan-route-draft:v2']) {
      localStorage.setItem(key,JSON.stringify({stops:stops.map(venueId=>({venueId,venueName:venueId}))}));
    }
  }, {intake,stops:STOPS});
  await expect(query).toHaveValue('A private outing in Soho');
  await shot(page, 'plan-private-account-a');
  await page.goto('/pal/chat');
  await switchToB(page);
  for (const key of ['pubmaxx:plan-draft:v1','pubmax:plan-draft:v2']) {
    expect(await page.evaluate(key => sessionStorage.getItem(key),key)).toBeNull();
  }
  for (const key of ['pubmaxx:plan-route-draft:v1','pubmax:plan-route-draft:v2','pubmax:plan-intake:v1']) {
    expect(await page.evaluate(key => localStorage.getItem(key),key)).toBeNull();
  }
  await page.goto('/plan');
  await expect(page.getByRole('button',{name:'Account options for '+ACCOUNTS.B.name,exact:true})).toBeVisible();
  await expect(page.locator('#plan-describe-first-query')).toHaveValue('');
  await expect(page.getByRole('button',{name:/Step.free/i,pressed:true})).toHaveCount(0);
  await shot(page, 'plan-private-account-b');
});

// #2539: the test above leaves /plan before the switch. This one keeps the form
// mounted, where A's request lived on in React state and B's edit saved it again.
test('a mounted Plan form drops account A\'s request when B takes over', async ({ page }) => {
  await seed(page);
  await page.goto('/plan');
  await expect(page.getByRole('button',{name:'Account options for '+ACCOUNTS.A.name,exact:true})).toBeVisible();
  const query = page.locator('#plan-describe-first-query');
  const savedRequest = () => page.evaluate(() => {
    const raw = sessionStorage.getItem('pubmax:plan-draft:v2');
    return raw ? JSON.parse(raw).draft.conciergeQuery : null;
  });
  await query.fill('A private outing in Soho');
  await expect.poll(savedRequest).toBe('A private outing in Soho');
  await shot(page, 'plan-mounted-account-a');
  await switchToB(page);
  await shot(page, 'plan-mounted-switched-to-b');
  await expect(query).toHaveValue('');
  expect(await savedRequest()).toBeNull();
  await query.fill('Two pubs near Borough');
  await expect.poll(savedRequest).toBe('Two pubs near Borough');
  const stored = await page.evaluate(() => JSON.stringify({...sessionStorage})+JSON.stringify({...localStorage}));
  expect(stored).not.toContain('A private outing in Soho');
  await shot(page, 'plan-mounted-account-b');
});

// F12 is the oracle: personal shortcuts and portraits belong to the live account.
// These checks reject a retained marker, a detached callable action, and a stale chat portrait.
test('provider sign-out retires the open map marker while retaining the owner stamp', async ({ page }) => {
  await seed(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await installDeterministicMapBasemap(page);
  await page.route(`**/api/plans/${PLAN_ID}`, route => route.fulfill({json:{stops:STOPS.map((venueId,position)=>({venueId,venueName:venueId,position}))}}));
  await page.route(`**/api/plans/${PLAN_ID}/pals`, route => route.fulfill({json:{visibility:'member',pals:[]}}));
  await page.addInitScript(({planId, ownerId}) => localStorage.setItem('pubmax_active_plan',JSON.stringify({version:1,ownerId,id:planId,startTime:new Date(Date.now()-3600000).toISOString(),stopIndex:0})),{planId:PLAN_ID,ownerId:ACCOUNTS.A.id});
  await page.goto('/map');
  const marker = page.locator('.palMapMarker:not([data-pal-crew])');
  await expect(marker).toHaveAttribute('role','button',{timeout:60000});
  const oldMarker = await marker.elementHandle();
  const canvas = await page.locator('.maplibregl-canvas').elementHandle();
  await expect(page.locator('.palSummon')).toContainText('Ripley');
  await shot(page,'provider-before');
  await page.evaluate(key => {
    localStorage.removeItem(key);
    const channel = new BroadcastChannel(key);
    channel.postMessage({event:'SIGNED_OUT',session:null});
    setTimeout(()=>channel.close(),100);
  },AUTH_STORAGE_KEY);
  await expect(marker).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('pubmax_account_owner'))).toBe(ACCOUNTS.A.id);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pubmax_pub_pal_v1')!).name)).toBe('Ripley');
  // The signed-out sign-in chip may share the berth; no personal pill remains.
  await expect(page.locator('.palSummon:not(.palSummonSignIn)')).toHaveCount(0);
  expect(await oldMarker!.evaluate(el=>el.isConnected)).toBe(false);
  const url = page.url();
  await oldMarker!.evaluate(el=>{(el as HTMLElement).click();el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
  await expect(page).toHaveURL(url);
  expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
  await shot(page,'provider-after');
});

test('chat uses the server Pal and removes it when its cache retires during a failed refresh', async ({ page }) => {
  await seed(page);
  let failed = false;
  await page.route('**/api/pub-pal', route => failed ? route.fulfill({status:503,json:{error:'disposable outage'}}) : route.fulfill({json:{under18:false,pal:{...pal,name:'Server Raven',appearance:{...pal.appearance,species:'raven'},muted:true}}}));
  await page.goto('/pal/chat');
  const companion = page.locator('.palChatCompanion');
  await expect(companion.getByRole('img',{name:/Server Raven/})).toBeVisible();
  await expect(companion.locator('.palPortrait')).toHaveAttribute('data-pal-state','sleeping');
  await shot(page,'chat-server-wins');
  failed = true;
  await page.evaluate(()=>{localStorage.removeItem('pubmax_pub_pal_v1');window.dispatchEvent(new Event('pubmax:local-pal-changed'));});
  await expect(companion.getByRole('img',{name:/Server Raven/})).toHaveCount(0);
  await expect(companion.locator('[data-genome]')).toHaveCount(0);
  await shot(page,'chat-cache-retired');
});

test('chat discards account A while account B waits for its own server answer', async ({ page }) => {
  await seed(page);
  await page.route('**/api/pub-pal', async route => {
    const bearer=route.request().headers().authorization ?? '';
    const token = bearer.replace(/^Bearer /, '');
    const owner = token.includes('.') ? JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sub : token.endsWith('-A') ? ACCOUNTS.A.id : null;
    if (owner === ACCOUNTS.A.id) await route.fulfill({json:{under18:false,pal:{...pal,name:'Server Raven',appearance:{...pal.appearance,species:'raven'}}}});
    else await route.fulfill({status:503,json:{error:'disposable outage'}});
  });
  await page.goto('/pal/chat');
  const companion=page.locator('.palChatCompanion');
  await expect(companion.getByRole('img',{name:/Server Raven/})).toBeVisible();
  await switchToB(page);
  await expect(companion.getByRole('img',{name:/Server Raven/})).toHaveCount(0);
  await expect(companion.locator('[data-genome]')).toHaveCount(0);
  await shot(page,'chat-account-b');
});

test('a mounted venue price portrait retires on an account switch', async ({ page }) => {
  await seed(page);
  await installDeterministicMapBasemap(page);
  await page.goto('/map?sel=venue-xjf3n0');
  const needle=page.getByTestId('venue-pint-needle').first();
  await expect(needle.locator('.venuePintNeedlePal')).toBeAttached({timeout:60000});
  await needle.scrollIntoViewIfNeeded();
  await shot(page,'needle-account-a');
  await switchToB(page);
  await expect(needle.locator('.venuePintNeedlePal')).toHaveCount(0);
  await expect(needle).toBeAttached();
  await shot(page,'needle-account-b');
});

test('a mounted nearby price quest retires on an account switch', async ({ page }) => {
  await seed(page);
  await page.route('**/api/price-missions**',route=>route.fulfill({json:{status:'ready',mission:{venueId:new URL(route.request().url()).searchParams.get('venueId'),reason:'provisional',drinkCategory:'beer',observedAt:Date.now()-3600000}}}));
  await page.goto('/near?patch=soho');
  const quest=page.getByTestId('pal-quest');
  await expect(quest).toContainText('Ripley',{timeout:60000});
  await shot(page,'quest-account-a');
  await switchToB(page);
  await expect(quest).toHaveCount(0);
  await shot(page,'quest-account-b');
});

test('a mounted crawl celebration retires on an account switch', async ({ page }) => {
  await seed(page);
  await installDeterministicMapBasemap(page);
  await page.goto(`/map?mode=build&pubs=${STOPS.join(',')}`);
  const panel=page.locator('.mapDrawer.left .routePanel');
  const toggle=page.getByRole('button',{name:/^(Plan an outing|Close plan)$/});
  await expect(async()=>{
    if(await toggle.getAttribute('aria-pressed')!=='true') await toggle.click();
    await expect(panel).toBeVisible({timeout:1000});
  }).toPass({timeout:30000});
  await panel.getByRole('button',{name:'Start this crawl',exact:true}).click();
  await panel.getByRole('button',{name:'Mark complete',exact:true}).click();
  const cheer=page.getByTestId('crawl-celebration').getByTestId('pal-cheer');
  await expect(cheer).toContainText('Ripley');
  await shot(page,'celebration-account-a');
  await switchToB(page);
  await expect(cheer).toHaveCount(0);
  await shot(page,'celebration-account-b');
});

test('a mounted private recap postcard retires on an account switch', async ({ page, request }) => {
  const creation=await request.post('/api/plans',{headers:{'idempotency-key':crypto.randomUUID()},data:{title:'Privacy test night',creatorName:'Disposable host',startTime:new Date().toISOString(),stops:STOPS.map(venueId=>({venueId,venueName:venueId}))}});
  expect(creation.ok()).toBe(true);
  const created=await creation.json();
  const id=created.plan.plan.id;
  await seed(page);
  await page.route(`**/api/plans/${id}/recap`,route=>route.fulfill({json:{visibility:'member',completed:true,stopCount:3,shareText:'Privacy test night',view:{title:'Privacy test night',completedAt:new Date().toISOString(),route:STOPS.map((venueId,position)=>({venueId,position,venueName:venueId,caption:null})),pints:[],photos:[],ending:null,guardian:null,closingLine:'A night kept.',stats:{stopCount:3,pintCount:0,totalGbp:null,cheapestPintGbp:null}}}}));
  await page.goto(`/plan/${id}/recap`);
  const postcard=page.getByTestId('pal-postcard');
  await expect(page.getByRole('heading',{name:'A postcard from Ripley',exact:true})).toBeVisible();
  await postcard.scrollIntoViewIfNeeded();
  await shot(page,'postcard-account-a');
  await switchToB(page);
  await expect(postcard).toHaveCount(0);
  await shot(page,'postcard-account-b');
});

for (const state of ['hidden','deleted'] as const) {
  test(`chat respects the server ${state} state despite a visible cached Pal`, async ({ page }) => {
    await seed(page);
    await page.route('**/api/pub-pal',route=>route.fulfill({json:{under18:false,pal:state==='hidden'?{...pal,hidden:true}:null}}));
    await page.goto('/pal/chat');
    const companion=page.locator('.palChatCompanion');
    await expect(companion).toBeVisible();
    await expect(page.locator('.siteNavPal')).toContainText('Ripley');
    await expect(companion.locator('[data-genome]')).toHaveCount(0);
    await shot(page,`chat-server-${state}`);
  });
}

test('the Pal page retires personal memories when the live account changes', async ({ page }) => {
  await seed(page);
  await page.route('**/api/pub-pal',route=>route.fulfill({json:{under18:false,pal,adultOnFile:true}}));
  await page.route('**/api/pub-pal/memories',route=>route.fulfill({json:{memories:[{id:'private-memory-a',palId:pal.id,ownerId:ACCOUNTS.A.id,kind:'preference',provenance:'user_confirmed',value:'Private account A memory',createdAt:pal.createdAt,updatedAt:pal.updatedAt}]}}));
  await page.goto('/pal');
  await expect(page.getByRole('heading',{name:'Ripley',exact:true})).toBeVisible();
  await expect(page.getByText('Private account A memory',{exact:true})).toBeVisible();
  await shot(page,'pal-private-account-a');
  await switchToB(page);
  await expect(page.getByRole('heading',{name:'Ripley',exact:true})).toHaveCount(0);
  await expect(page.getByText('Private account A memory',{exact:true})).toHaveCount(0);
  await shot(page,'pal-private-account-b');
});

// F12 requires raw cache transitions to retire a server portrait even when both
// snapshots are hidden. A stale server answer is the deliberate adversary here.
for (const transition of ['hidden', 'removed'] as const) {
  test(`chat retires a stale server portrait after hidden-to-${transition} cache changes`, async ({ page }) => {
    await seed(page);
    let failed = false;
    await page.route('**/api/pub-pal', route => failed
      ? route.fulfill({status:503,json:{error:'Disposable outage'}})
      : route.fulfill({json:{under18:false,pal:{...pal,name:'Pending hide Raven'}}}));
    await page.goto('/pal/chat');
    const companion = page.locator('.palChatCompanion');
    await expect(companion.getByRole('img',{name:/Pending hide Raven/})).toBeVisible();
    const optimisticRead = page.waitForResponse(response => response.url().endsWith('/api/pub-pal'));
    await page.evaluate(pal => {
      localStorage.setItem('pubmax_pub_pal_v1', JSON.stringify({...pal,hidden:true}));
      window.dispatchEvent(new Event('pubmax:local-pal-changed'));
    },pal);
    await optimisticRead;
    await expect(companion.getByRole('img',{name:/Pending hide Raven/})).toBeVisible();
    failed = true;
    await page.evaluate(({transition, pal}) => {
      if (transition === 'removed') localStorage.removeItem('pubmax_pub_pal_v1');
      else localStorage.setItem('pubmax_pub_pal_v1',JSON.stringify({...pal,hidden:true,updatedAt:'2026-11-06T12:00:01.000Z'}));
      window.dispatchEvent(new Event('pubmax:local-pal-changed'));
    },{transition,pal});
    await expect(companion.locator('[data-genome]')).toHaveCount(0);
    await shot(page, `chat-hidden-to-${transition}`);
  });
}

async function seedActiveNight(page: Page) {
  const now = new Date(Date.now()-3600000).toISOString();
  await page.route(`**/api/plans/${PLAN_ID}/**`, route => route.fulfill({json:
    route.request().url().endsWith('/session') ? {active:true,role:'host',collaborationAuthorized:true} : {visibility:'member',pals:[],stops:[]}
  }));
  await page.route(`**/api/plans/${PLAN_ID}`, route => route.fulfill({json:{
    plan:{id:PLAN_ID,title:'Disposable private night',startTime:now,createdAt:now,status:'active',routeRevision:1},
    stops:STOPS.map((venueId,position)=>({venueId,venueName:['The Nellie Dean','The Crown & Two Chairmen','The Dog & Duck'][position],position})),crew:[],actions:[],context:{nightArea:'soho'},
  }}));
  await page.addInitScript(({id,ownerId,startTime})=>{
    if(sessionStorage.getItem('private-night-seeded')) return;
    sessionStorage.setItem('private-night-seeded','1');
    localStorage.setItem('pubmax_active_plan',JSON.stringify({version:1,id,ownerId,startTime,stopIndex:0,role:'host'}));
  },{id:PLAN_ID,ownerId:ACCOUNTS.A.id,startTime:now});
}

test('B opens Pal and returns to the map without inheriting A\'s night', async ({page})=>{
  await seed(page);
  await seedActiveNight(page);
  await installDeterministicMapBasemap(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/pub-pal',route=>route.fulfill({json:{under18:false,pal:{...pal,ownerId:ACCOUNTS.B.id,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',name:'Moss'},adultOnFile:true}}));
  await page.route('**/api/pub-pal/memories',route=>route.fulfill({json:{memories:[]}}));
  await page.goto('/map');
  await expect(page.locator('.palMapMarker[role="button"]')).toBeVisible({timeout:60000});
  await switchToB(page);
  await page.locator('a[href="/pal"]').first().click();
  await expect(page.getByRole('heading',{name:'Moss',exact:true})).toBeVisible();
  await page.locator('a[href="/map"]').first().click();
  await expect(page.locator('.palSummon')).toContainText('Moss');
  await expect(page.locator('.palSummon small')).not.toContainText(/Stop|kept/i);
  await expect(page.locator('.palMapMarker[role="button"]')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pubmax_active_plan')!).ownerId)).toBe(ACCOUNTS.A.id);
  await shot(page,'map-b-no-inherited-night');
});

test('B receives a clean choice for the same leg after A chose a way on the map', async ({page})=>{
  await seed(page);
  await seedActiveNight(page);
  await installDeterministicMapBasemap(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/leg-options**',route=>{
    const params=new URL(route.request().url()).searchParams;
    const point=(key:string)=>params.get(key)!.split(',').map(Number).reverse();
    return route.fulfill({json:{status:'ok',options:[{id:'private-way-a',kind:'transit',minutes:6,farePence:null,estimate:false,fastest:false,cheapest:false,parts:[{mode:'tube',line:'Central',minutes:6,path:[point('from'),point('to')]}]}]}});
  });
  await page.goto('/tonight');
  await page.getByRole('button',{name:"Show tonight's plan"}).click();
  await page.getByRole('button',{name:'Ways to get there',exact:true}).click();
  await page.locator('.nightWays__option').click();
  await expect(page).toHaveURL(/\/map/);
  await expect(page.locator('.palMapMarkerSay')).toHaveText("TfL won't say the fare. Bold choice.",{timeout:60000});
  await shot(page,'chosen-way-account-a');
  await switchToB(page);
  // Install B's disposable active plan with the identical leg without reloading
  // the document. A reload would erase module state and conceal the regression.
  await page.evaluate(({pal,ownerId})=>{
    localStorage.setItem('pubmax_pub_pal_v1',JSON.stringify({...pal,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',ownerId,name:'Moss'}));
    const prior=JSON.parse(localStorage.getItem('pubmax_active_plan')!);
    localStorage.setItem('pubmax_active_plan',JSON.stringify({...prior,ownerId}));
    window.dispatchEvent(new Event('pubmax:local-pal-changed'));
    window.dispatchEvent(new Event('pubmax:active-plan'));
  },{pal,ownerId:ACCOUNTS.B.id});
  await expect(page.locator('.palSummon')).toContainText('Moss');
  await expect(page.locator('.palMapMarker[role="button"]')).toBeVisible();
  await expect(page.locator('.palMapMarkerSay')).not.toHaveText("TfL won't say the fare. Bold choice.");
  await page.locator('a[href="/tonight"]').first().click();
  await page.getByRole('button',{name:"Show tonight's plan"}).click();
  await page.getByRole('button',{name:'Ways to get there',exact:true}).click();
  await expect(page.locator('.nightWays__option')).toHaveAttribute('aria-pressed','false');
  await shot(page,'chosen-way-account-b-clean');
  await page.locator('.nightWays__option').click();
  await expect(page.locator('.palMapMarkerSay')).toHaveText("TfL won't say the fare. Bold choice.",{timeout:60000});
  await shot(page,'chosen-way-account-b-own-choice');
});

test('crew portraits retire with A\'s active night when B signs in', async ({page})=>{
  await seed(page);
  await seedActiveNight(page);
  await installDeterministicMapBasemap(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route(`**/api/plans/${PLAN_ID}/pals`,route=>route.fulfill({json:{visibility:'member',pals:[{id:'crew-pal-private-a',name:'Private crew A',species:'fox',personality:pal.personality,muted:false}]}}));
  await page.goto('/map');
  const crew=page.locator('.palMapMarker[data-pal-crew]');
  await expect(crew).toHaveCount(1,{timeout:60000});
  await shot(page,'crew-private-account-a');
  await switchToB(page);
  await expect(crew).toHaveCount(0);
  await shot(page,'crew-private-account-b');
});

test('the voice panel and written chat reject A\'s next-stop shortcut for B', async ({page})=>{
  await seed(page);
  await seedActiveNight(page);
  await installDeterministicMapBasemap(page);
  await page.route('**/api/pub-pal',route=>route.fulfill({json:{under18:false,pal:{...pal,ownerId:ACCOUNTS.B.id,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',name:'Moss'},adultOnFile:true}}));
  await page.route('**/api/pub-pal/memories',route=>route.fulfill({json:{memories:[]}}));
  await page.route('**/api/pub-pal/voice-token',route=>route.fulfill({json:{available:true,retention:'provider_default'}}));
  let questions = 0;
  await page.route('**/api/pub-pal/chat',route=>{
    if (route.request().method() === 'POST') questions += 1;
    return route.fulfill({json:{answer:'Disposable answer for account B.',cards:[],proposals:[],sources:[],conversationId:'conv_privacyshortcuts'}});
  });
  await page.goto('/map');
  await expect(page.locator('.palMapMarker[role="button"]')).toBeVisible({timeout:60000});
  await switchToB(page);
  await page.locator('a[href="/pal"]').first().click();
  await expect(page.getByRole('heading',{name:'Moss',exact:true})).toBeVisible();
  const voiceInput=page.getByRole('textbox',{name:/^Message your Pub Pal/});
  await voiceInput.fill('next stop');
  await voiceInput.press('Enter');
  await expect(page).toHaveURL(/\/pal\/chat\?/);
  await expect.poll(()=>questions).toBe(1);
  await expect(page).not.toHaveURL(/\/map/);
  const written=page.getByRole('textbox',{name:'Where, how many, what budget',exact:true});
  await written.fill('next stop');
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  await expect(page).not.toHaveURL(/\/map/);
  await expect.poll(()=>questions).toBe(2);
  await shot(page,'pal-shortcuts-account-b');
});
