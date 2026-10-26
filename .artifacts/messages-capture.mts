import { chromium, expect } from '@playwright/test';
import { installAuthDoubles, seedSignedIn } from '../e2e/helpers/authDoubles';
const phase = process.argv[2] ?? 'before';
const browser = await chromium.launch();
const page = await browser.newPage({ baseURL: 'http://127.0.0.1:3116', viewport: { width: 390, height: 844 } });
const stub = await installAuthDoubles(page);
await seedSignedIn(page, 'A');
await stub.signedInAs('A');
await page.addInitScript(() => {
 localStorage.setItem('pubmax-tour-v1-done','1');
 sessionStorage.setItem('pubmax_onboarding_dismissed','1');
});
const now = new Date().toISOString();
const conversations = [
 {id:'c1', kind:'direct', otherHandle:'maisie', otherDisplayName:'Maisie', lastBody:'Meet outside the Harp at seven?',lastAt:now,lastFromMe:false,unread:2},
 {id:'c2', kind:'group', title:'Friday regulars', otherHandle:'tom',memberHandles:['karan','tom','maisie'],lastBody:'I can make the first stop',lastAt:now,lastFromMe:true,unread:0},
 {id:'c3', kind:'direct',otherHandle:'tom',otherDisplayName:'Tom',lastBody:'See you there',lastAt:now,lastFromMe:false,unread:0}
];
await page.route('**/api/messages?**', route => route.fulfill({json:{conversations}}));
await page.route('**/api/messages/c1**', route => route.fulfill({json:{messages:[],conversation:{kind:'direct',members:['karan','maisie'],title:null}}}));
await page.route('**/api/messages/c2**', route => route.fulfill({json:{conversation:{kind:'group',members:['karan','tom','maisie'],title:'Friday regulars'},messages:[
 {id:'m1',conversationId:'c2',senderHandle:'tom',body:'The Harp at seven?',createdAt:now,read:true,flagged:false},
 {id:'m2',conversationId:'c2',senderHandle:'maisie',body:'See you there',createdAt:now,read:true,flagged:false}
]}}));
await page.goto('http://127.0.0.1:3116/messages');
await expect(page.locator('.conversationLink')).toHaveCount(3,{timeout:60000});
await page.screenshot({path:`.artifacts/messages-${phase}-inbox-phone.png`,fullPage:true});
await page.getByRole('button',{name:'Unread',exact:true}).click();
await expect(page.locator('.conversationLink')).toHaveCount(1);
await page.getByRole('button',{name:'Groups',exact:true}).click();
await expect(page.locator('.conversationLink')).toHaveCount(1);
await page.getByRole('link',{name:/Friday regulars/}).click();
await expect(page.locator('.messageSender')).toHaveText(['@tom','@maisie']);
await page.screenshot({path:`.artifacts/messages-${phase}-group-phone.png`,fullPage:true});
await page.goto('/messages/c1');
await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
await page.screenshot({path:`.artifacts/messages-${phase}-empty-phone.png`,fullPage:true});
await page.getByRole('group',{name:'Start the conversation'}).getByRole('button',{name:'Share a pub'}).click();
await expect(page.getByRole('searchbox',{name:'Search pubs',exact:true})).toBeFocused();
await page.getByRole('button',{name:'Cancel',exact:true}).click();
await page.getByRole('button',{name:'Share a plan',exact:true}).click();
await expect(page.getByRole('textbox',{name:'Which plan?',exact:true})).toBeFocused();
await page.getByRole('button',{name:'Cancel',exact:true}).click();
await page.setViewportSize({width:320,height:568});
await expect(page.getByRole('button',{name:'Send',exact:true})).toBeInViewport();
expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
await page.setViewportSize({width:1440,height:900});
await page.goto('http://127.0.0.1:3116/messages');
await expect(page.locator('.conversationLink')).toHaveCount(3);
await page.screenshot({path:`.artifacts/messages-${phase}-inbox-desktop.png`,fullPage:true});
await page.evaluate(()=>document.documentElement.dataset.theme='dark');
await page.screenshot({path:`.artifacts/messages-${phase}-inbox-desktop-dark.png`,fullPage:true});
console.log('PASS: All/Unread/Groups, group sender labels, pub/plan picker focus, 320px composer and overflow; phone/desktop/dark screenshots. Browser API fixtures only.');
await browser.close();
