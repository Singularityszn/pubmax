import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PAL_DRAFT } from '../lib/pubPal';
import { ACCOUNTS, AUTH_STORAGE_KEY, DEVICE_ACCOUNTS_KEY, installAuthDoubles, seedSignedIn } from './helpers/authDoubles';
import { installDeterministicMapBasemap } from './helpers/mapNetworkFixtures';

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
  }, {pal, accounts: ACCOUNTS, accountsKey: DEVICE_ACCOUNTS_KEY});
}
async function switchToB(page: Page) {
  await page.getByRole('button', {name:/Account options/}).first().click();
  const menu=page.locator('.authAccountMenu');
  await menu.getByRole('button',{name:'Switch account',exact:true}).click();
  await menu.locator('.authSwitcherRow').filter({has:page.getByText('@'+ACCOUNTS.B.handle,{exact:true})}).click();
  await expect(page.getByRole('button',{name:'Account options for '+ACCOUNTS.B.name,exact:true})).toBeVisible();
}
async function shot(page: Page, name: string) {
  if (EVIDENCE) {
    await expect(page.locator(".mapLoading")).toBeHidden({timeout:60_000});
    await page.screenshot({path:`${EVIDENCE}/${name}.png`});
  }
}

// F12 is the oracle: personal shortcuts and portraits belong to the live account.
// These checks reject a retained marker, a detached callable action, and a stale chat portrait.
test('provider sign-out retires the open map marker while retaining the owner stamp', async ({ page }) => {
  await seed(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await installDeterministicMapBasemap(page);
  await page.route(`**/api/plans/${PLAN_ID}`, route => route.fulfill({json:{stops:STOPS.map((venueId,position)=>({venueId,venueName:venueId,position}))}}));
  await page.route(`**/api/plans/${PLAN_ID}/pals`, route => route.fulfill({json:{visibility:'member',pals:[]}}));
  await page.addInitScript(planId => localStorage.setItem('pubmax_active_plan',JSON.stringify({version:1,id:planId,startTime:new Date(Date.now()-3600000).toISOString(),stopIndex:0})),PLAN_ID);
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
  await expect(page.locator('.palSummon')).toHaveCount(0);
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
  await page.route('**/api/pub-pal', route => failed ? route.fulfill({status:503,json:{error:'disposable outage'}}) : route.fulfill({json:{pal:{...pal,name:'Server Raven',appearance:{...pal.appearance,species:'raven'},muted:true}}}));
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
    if (owner === ACCOUNTS.A.id) await route.fulfill({json:{pal:{...pal,name:'Server Raven',appearance:{...pal.appearance,species:'raven'}}}});
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
    await page.route('**/api/pub-pal',route=>route.fulfill({json:{pal:state==='hidden'?{...pal,hidden:true}:null}}));
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
  await page.route('**/api/pub-pal',route=>route.fulfill({json:{pal,adultOnFile:true}}));
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
