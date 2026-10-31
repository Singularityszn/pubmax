import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadResults, urlIdentity } from './evaluate.mjs';

function bindLabel(page, label) {
  const evidence = page.bodySha256 && label?.bodySha256 === page.bodySha256 ? label : {
    verdict: 'unresolved', relevant: null, reviewer: '', evidence: '', priceReviewComplete: false, priceRecords: [],
  };
  return { ...evidence, venueId: page.venueId, url: page.url, bodySha256: page.bodySha256,
    sourceUrl: page.sourceUrl, path: page.path, format: page.format };
}

const here = dirname(fileURLToPath(import.meta.url));
const run = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json')));
const annotationPath = process.argv[3] ? resolve(process.argv[3]) : resolve(run, 'annotations.json');
const annotations = existsSync(annotationPath) ? JSON.parse(readFileSync(annotationPath)) : { humanApproved: false, labels: [] };
const benchmarkResults = loadResults(run);
const results = [...benchmarkResults];
const referenceRoot = resolve(run, 'reference');
if (existsSync(referenceRoot)) {
  for (const entry of readdirSync(referenceRoot, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const file = resolve(referenceRoot, entry.name, 'result.json');
    if (existsSync(file)) results.push(JSON.parse(readFileSync(file)));
  }
}
const identity = urlIdentity(results);
const labels = new Map(annotations.labels.map((row) => [`${row.venueId}\t${identity(row.venueId, row.url)}`, row]));
const extractedPdfs = existsSync(resolve(run, 'extracted-pdfs.json'))
  ? new Map(JSON.parse(readFileSync(resolve(run, 'extracted-pdfs.json'))).documents.map((row) => [row.bodySha256, row])) : new Map();
const byVenue = new Map(manifest.venues.map((v) => [v.venueId, v]));
mkdirSync(resolve(run, 'review/images'), { recursive: true });
mkdirSync(resolve(run, 'review/documents'), { recursive: true });
const pages = new Map();
const leads = new Map();
for (const arm of results) {
  const venue = byVenue.get(arm.venueId);
  for (const page of arm.pages) {
    const url = identity(arm.venueId, page.url);
    const key = `${arm.venueId}\t${url}`;
    const old = pages.get(key);
    const label = labels.get(key);
    const extracted = extractedPdfs.get(page.bodySha256);
    const reviewText = page.text || extracted?.text || '';
    const imagePreview = page.contentType?.startsWith('image/jpeg') ? `images/${page.bodySha256}.jpeg` : null;
    if (imagePreview) copyFileSync(resolve(run, arm.arm === 'REFERENCE' ? `reference/${arm.venueId.replace('/', '-')}` : `${arm.venueId.replace('/', '-')}/${arm.arm}`, page.bodyFile), resolve(run, 'review', imagePreview));
    const retainedPdf = page.format === 'pdf' ? `documents/${page.bodySha256}.pdf` : null;
    if (retainedPdf) copyFileSync(resolve(run, arm.arm === 'REFERENCE' ? `reference/${arm.venueId.replace('/', '-')}` : `${arm.venueId.replace('/', '-')}/${arm.arm}`, page.bodyFile), resolve(run, 'review', retainedPdf));
    const row = { ...page, url, retainedPdf, venueId: arm.venueId, venue: venue.name, goldSample: venue.goldSample,
      format: imagePreview ? 'image' : page.format, imagePreview,
      reviewId: createHash('sha256').update(`${key}\t${page.bodySha256}`).digest('hex').slice(0, 12),
      text: reviewText, pdfExtractionWarnings: extracted?.warnings ?? null,
      postcode: venue.postcode, arms: [...new Set([...(old?.arms ?? []), arm.arm])],
      candidate: page.candidate || old?.candidate || false,
      variantHashes: [...new Set([...(old?.variantHashes ?? []), page.bodySha256])],
      evidenceFile: arm.arm === 'REFERENCE' ? `reference/${venue.venueId.replace('/', '-')}/${page.bodyFile}` : `${venue.venueId.replace('/', '-')}/${arm.arm}/${page.bodyFile}`,
      priceCandidates: reviewText.split('\n').map((line, index) => ({ line: index + 1, text: line.trim() }))
        .filter((line) => /£\s*\d/.test(line.text)).map((line) => ({ ...line, text: line.text.slice(0, 500) })),
    };
    row.label = bindLabel(row, label);
    pages.set(key, row);
    for (const link of page.links.filter((l) => l.keyword)) {
      const target = identity(arm.venueId, link.url);
      leads.set(`${arm.venueId}\t${target}`, { venueId: arm.venueId, venue: venue.name, goldSample: venue.goldSample,
        sourceUrl: page.url, url: target, anchor: link.anchor,
        path: [...page.path, link.url, ...(target === link.url ? [] : [target])], verified: false });
    }
  }
}
const rows = [...pages.values()].sort((a, b) => Number(b.goldSample) - Number(a.goldSample) || a.venue.localeCompare(b.venue) || a.url.localeCompare(b.url));
const uncrawled = [...leads].filter(([key]) => !pages.has(key)).map(([, row]) => row);
const packet = { schemaVersion: 1, humanApproved: false, generatedFrom: run,
  primaryGoldVenueIds: manifest.venues.filter((v) => v.goldSample).map((v) => v.venueId),
  venues: manifest.venues.map((v) => ({ ...v, armsCompleted: benchmarkResults.filter((r) => r.venueId === v.venueId).map((r) => r.arm),
    accessEvents: results.filter((r) => r.venueId === v.venueId).flatMap((r) => r.events.map((event) => ({ arm: r.arm, ...event }))) })),
  pages: rows, uncrawledMenuLeads: uncrawled,
};
writeFileSync(resolve(run, 'review-packet.json'), `${JSON.stringify(packet, null, 2)}\n`);
const serialise = (data) => JSON.stringify(data).replaceAll('<', '\\u003c');
const html = `<!doctype html><html lang="en" data-lavish-annotate="off"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>London menu discovery review</title><style>
:root{--paper:#f8f2ec;--panel:#eee7df;--ink:#17171a;--muted:#666670;--line:#dedcdf;--accent:#ff5a5f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 Inter,system-ui,sans-serif}main{max-width:1160px;padding:40px 24px;margin:auto}h1,h2{font-family:'Space Grotesk',Inter,system-ui,sans-serif;line-height:1.15}h1{font-size:clamp(32px,5vw,58px);max-width:850px;margin:12px 0 24px}p{max-width:80ch}small,.muted{color:var(--muted)}.kicker{font-size:12px;letter-spacing:.12em;text-transform:uppercase}.notice{border-left:4px solid var(--accent);padding:12px 20px;background:var(--panel)}.controls{position:sticky;top:0;background:var(--paper);border-bottom:1px solid var(--line);padding:16px 0;display:flex;gap:12px;flex-wrap:wrap;z-index:1}input,select,textarea,button{font:inherit;border:1px solid #b8b1ac;border-radius:8px;padding:9px 12px;background:#fff;color:var(--ink)}button{cursor:pointer}button.primary{background:var(--ink);color:white;border-color:var(--ink)}textarea{width:100%;min-height:90px}article{border-top:1px solid var(--line);padding:24px 0}article h2{font-size:23px;margin:4px 0}a{color:var(--ink);text-underline-offset:3px;overflow-wrap:anywhere}.tags{font-size:13px;color:var(--muted);margin:8px 0}.evidence{white-space:pre-wrap;max-height:300px;overflow:auto;background:var(--panel);padding:16px;border-radius:8px;font-size:14px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}label{display:block}label span{display:block;font-size:13px;margin-bottom:4px}details{margin:12px 0}summary{cursor:pointer;font-weight:600}.path{font-size:13px;overflow-wrap:anywhere}#status{min-height:24px}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid var(--line);padding:10px;overflow-wrap:anywhere}.scroll{overflow:auto}nav{display:flex;gap:18px;margin:20px 0}footer{border-top:1px solid var(--line);margin-top:40px;padding-top:20px;font-size:13px}@media(max-width:650px){main{padding:24px 16px}.fields{grid-template-columns:1fr}.controls{position:static}input{min-width:0;max-width:100%}}@media print{.controls,button{display:none}.evidence{max-height:none}}</style></head><body><main>
<div class="kicker">PUBMAXX research · 31 October 2026</div><h1>Official menu discovery, with every source open to review.</h1>
<p class="notice">The recommendation is to reject production adoption until the evidence and licence gates pass. Draft labels do not establish a human gold standard.</p>
<p>This page uses PUBMAXX's warm paper, coral, ink, and type stacks. It is a separate research artifact. Production ingestion stays unchanged.</p>
<nav><a href="#comparison">Comparison</a><a href="#review">Page review</a><a href="#leads">Uncrawled leads</a></nav>
<section id="comparison"><h2>One cohort, two bounded crawlers</h2><p>A uses breadth-first traversal and conventional keywords. B uses native PageSift 0.81.0 relevance ordering through the same access transport.</p><div id="metrics"></div></section>
<section><h2>The 12 primary reference venues</h2><p>Every inventory remains provisional. An access refusal does not establish that a pub has no menu.</p><div id="inventory" class="scroll"></div></section><section id="review"><h2>Review the evidence</h2><p>Confirm the pub's postcode and the menu contents. Mark another branch, a booking page, or a navigation page as not a menu. Leave uncertain cases unresolved.</p>
<div class="controls"><input id="search" type="search" placeholder="Find a pub or URL" aria-label="Find a pub or URL"><select id="scope" aria-label="Review scope"><option value="gold">12 primary gold venues</option><option value="all">All 60 venues</option><option value="candidate">All menu candidates</option><option value="unresolved">Unresolved candidates</option></select><button id="export" class="primary">Download annotation JSON</button></div><p id="status" role="status"></p><div id="rows"></div></section>
<section id="leads"><h2>Menu links that need a separate read</h2><p>These links are not verified menus. Their source pages expose them, but the benchmark did not capture their contents.</p><div id="leadRows"></div></section>
<footer>Access checks, failed requests, redirect hops, and robots requests count against each arm's 12-request cap. No paid API or model calls run here. Full response bodies stay private. Draft edits stay in this browser until you download them.</footer>
</main><script id="data" type="application/json">${serialise(packet)}</script><script id="comparisonData" type="application/json">${serialise(existsSync(resolve(run, 'comparison.json')) ? JSON.parse(readFileSync(resolve(run, 'comparison.json'))) : null)}</script><script>
${bindLabel.toString()}
const data=JSON.parse(document.getElementById('data').textContent);const comparison=JSON.parse(document.getElementById('comparisonData').textContent);const byId=new Map(data.pages.map(p=>[p.reviewId,p]));const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const cacheKey='pubmax-menu-review-'+data.generatedFrom;let storedDrafts={};try{const saved=JSON.parse(localStorage.getItem(cacheKey)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))storedDrafts=saved}catch{};for(const [i,v]of Object.entries(storedDrafts)){const page=byId.get(i);if(page?.bodySha256&&v?.bodySha256===page.bodySha256){page.label=bindLabel(page,v)}}
const format=n=>n==null?'Unknown':typeof n==='number'?Number(n.toFixed(3)).toLocaleString():String(n);if(comparison){const fields=[['venues','Venues'],['requests','Upstream requests'],['verifiedMenusFetched','Verified menu URLs'],['verifiedPdfMenus','Verified PDF URLs'],['verifiedHtmlMenus','Verified HTML URLs'],['precision','Judged-candidate precision'],['recall','Reviewed-inventory recall'],['unjudgedCandidates','Unjudged candidates'],['relevantPagesPer100RequestsLowerBound','Relevant pages / 100, lower bound'],['verifiedPriceRecordsPer100RequestsLowerBound','Price records / 100, lower bound'],['redirects','Redirects'],['fetchFailures','Fetch failures'],['blockedEvents','Blocked events'],['wallSecondsSum','Sum of venue seconds']];document.getElementById('metrics').innerHTML='<div class="scroll"><table><thead><tr><th>Metric</th><th>A: breadth-first</th><th>B: PageSift</th></tr></thead><tbody>'+fields.map(([k,label])=>'<tr><th>'+label+'</th>'+comparison.summary.map(a=>'<td>'+esc(format(a[k]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><p class="muted">The figures use provisional annotations. Unknown complete yields remain unknown. A sum of venue seconds differs from elapsed cohort time.</p>'}else{document.getElementById('metrics').textContent='The crawl or evaluation is still in progress. This page currently contains '+data.pages.length+' captured pages.'}
document.getElementById('inventory').innerHTML='<table><thead><tr><th>Venue</th><th>Reviewed menu URLs</th><th>Review scope and access limits</th></tr></thead><tbody>'+data.venues.filter(v=>v.goldSample).map(v=>{const captured=data.pages.filter(p=>p.venueId===v.venueId);const count=captured.filter(p=>p.label.verdict==='menu').length;const reasons=[...new Set(v.accessEvents.filter(e=>/refused|unreadable|restrict|challenge|cooldown/.test(e.reason)).map(e=>e.reason))];return '<tr><th>'+esc(v.name)+'<br><small>'+esc(v.postcode)+'</small></th><td>'+count+'</td><td>'+esc(captured.length?'Bounded captured-page review. Inventory incomplete.':'Access unresolved. Inventory incomplete.')+' '+esc(reasons.join(', '))+'</td></tr>'}).join('')+'</tbody></table>';
function save(i){const el=document.getElementById('p'+i);const page=byId.get(i);const label=page.label=bindLabel(page,page.label);label.verdict=el.querySelector('[name=verdict]').value;label.reviewer=el.querySelector('[name=reviewer]').value;label.evidence=el.querySelector('[name=evidence]').value;label.relevant=label.verdict==='menu'?true:label.verdict==='not-menu'?false:null;label.priceReviewComplete=el.querySelector('[name=complete]').checked;label.reviewerType='human-draft';if(label.verdict==='menu'){label.officialEvidence={sourceUrl:label.officialEvidence?.sourceUrl||byId.get(i).sourceUrl||byId.get(i).url,identityExcerpt:label.evidence,binding:label.evidence}}label.reviewedAt=new Date().toISOString();try{label.priceRecords=JSON.parse(el.querySelector('[name=prices]').value||'[]');el.querySelector('[name=prices]').setCustomValidity('')}catch{el.querySelector('[name=prices]').setCustomValidity('Enter a JSON array.');return}storedDrafts[i]=label;localStorage.setItem(cacheKey,JSON.stringify(storedDrafts));document.getElementById('status').textContent='Draft saved in this browser.'}
function render(){const query=document.getElementById('search').value.toLowerCase();const scope=document.getElementById('scope').value;const visible=[...byId].filter(([i,p])=>(scope!=='gold'||p.goldSample)&&(scope!=='candidate'||p.candidate)&&(scope!=='unresolved'||p.candidate&&p.label.verdict==='unresolved')&&(p.venue+' '+p.url).toLowerCase().includes(query));document.getElementById('status').textContent=visible.length+' pages match this view.';document.getElementById('rows').innerHTML=visible.map(([i,p])=>'<article id="p'+i+'"><div class="kicker">P-'+i.toUpperCase()+' · '+esc(p.arms.join(' + '))+' · '+(p.goldSample?'Primary gold venue':'Additional venue')+'</div><h2>'+esc(p.venue)+'</h2><a href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">'+esc(p.url)+'</a><div class="tags">'+esc(p.format.toUpperCase())+' · HTTP '+p.status+' · '+(p.candidate?'Menu candidate':'Context page')+' · expected postcode '+esc(p.postcode)+' · '+(p.identityPostcodePresent?'postcode present':'postcode needs verification')+'</div><p class="path">Source: '+esc(p.sourceUrl||'Manifest seed')+'<br>Path: '+esc(p.path.join(' → '))+'<br>Body SHA-256: '+esc(p.bodySha256)+'</p><details><summary>Read captured text and price leads</summary>'+(p.retainedPdf?'<p><a href="'+esc(p.retainedPdf)+'" target="_blank" rel="noopener noreferrer">Open retained PDF</a></p>':'')+(p.imagePreview?'<img src="'+esc(p.imagePreview)+'" alt="Captured menu image" style="display:block;max-width:100%;height:auto">':'')+'<div class="evidence">'+esc(p.text||'No text preview. Open the source document or review the retained body.')+'</div><p>'+p.priceCandidates.length+' pound-price lines require review. They are not verified price records.</p></details><div class="fields"><label><span>Verdict</span><select name="verdict"><option value="unresolved" '+(p.label.verdict==='unresolved'?'selected':'')+'>Unresolved</option><option value="menu" '+(p.label.verdict==='menu'?'selected':'')+'>Verified official menu or menu hub</option><option value="not-menu" '+(p.label.verdict==='not-menu'?'selected':'')+'>Not a menu</option></select></label><label><span>Reviewer name</span><input name="reviewer" value="'+esc(p.label.reviewer)+'"></label></div><label><span>Identity and content evidence</span><textarea name="evidence">'+esc(p.label.evidence)+'</textarea></label><details><summary>Verified price records</summary><label><span>Price records as a JSON array</span><textarea name="prices">'+esc(JSON.stringify(p.label.priceRecords||[],null,2))+'</textarea></label><label><input type="checkbox" name="complete" '+(p.label.priceReviewComplete?'checked':'')+'> I inspected the whole menu for prices.</label></details></article>').join('');for(const [i]of visible){document.getElementById('p'+i).addEventListener('change',()=>save(i))}document.getElementById('leadRows').innerHTML='<details><summary>'+data.uncrawledMenuLeads.length+' unverified leads</summary>'+data.uncrawledMenuLeads.filter(p=>p.goldSample).map(p=>'<p><strong>'+esc(p.venue)+'</strong><br><a href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">'+esc(p.anchor||p.url)+'</a><br><small>Source: '+esc(p.sourceUrl)+'</small></p>').join('')+'</details>'}
const annotation=()=>({schemaVersion:1,humanApproved:false,primaryGoldVenueIds:data.primaryGoldVenueIds,reviewScope:'Draft page labels. A human must confirm the inventory scope separately.',labels:[...byId.values()].map(p=>bindLabel(p,p.label)).filter(p=>p.verdict!=='unresolved')});document.getElementById('export').onclick=()=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(annotation(),null,2)],{type:'application/json'}));link.download='menu-annotations-draft.json';link.click();URL.revokeObjectURL(link.href);document.getElementById('status').textContent='Draft annotations downloaded. Human approval remains false.'};document.getElementById('scope').onchange=render;document.getElementById('search').oninput=render;render();
</script></body></html>`;
mkdirSync(resolve(run, 'review'), { recursive: true });
writeFileSync(resolve(run, 'review/index.html'), html);
console.log(JSON.stringify({ pages: rows.length, uncrawledLeads: uncrawled.length, review: resolve(run, 'review/index.html') }));
