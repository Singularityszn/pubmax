import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const samples = [];
for (let round = 1; round <= 5; round++) {
for (const variant of ['before', 'after']) {
const data = JSON.parse(readFileSync(`artifacts/lane-e/original-replay/${variant}-${round}.json`, 'utf8'));
for (const phase of Object.values(data)) {
const ids = phase.price.ids.sort();
phase.price.requestedIdCount = ids.length;
phase.price.requestedIdsSha256 = createHash('sha256').update(JSON.stringify(ids)).digest('hex');
delete phase.price.ids;
delete phase.camera;
}
samples.push({ round, variant, ...data });
}
}
writeFileSync('docs/proof/2026-10-08-ios-map-data-weight/samples-original-replay.json', JSON.stringify(samples, null, 2) + '\n');
const metrics = {
waterfall: s => s.cold.price.waterfallMs,
requests: s => s.cold.price.requests,
priceBytes: s => s.cold.price.transferBytes,
firstPrice: s => s.cold.price.firstAnswerMs,
lastPrice: s => s.cold.price.lastAnswerMs,
firstPins: s => s.cold.firstPinsMs,
firstTonight: s => s.firstTonight.firstSurfaceAnswerMs,
warmMap: s => s.warmMap.firstSurfaceAnswerMs,
warmTonight: s => s.warmTonight.firstSurfaceAnswerMs,
warmMapListings: s => s.warmMap.whats.requests,
warmTonightListings: s => s.warmTonight.whats.requests,
warmListingBytes: s => s.warmMap.whats.transferBytes + s.warmTonight.whats.transferBytes,
};
for (const variant of ['before', 'after']) {
const group = samples.filter(s => s.variant === variant);
console.log(variant);
for (const [name, select] of Object.entries(metrics)) {
const values = group.map(select).filter(n => n !== null).sort((a, b) => a - b);
console.log(name, JSON.stringify({ median: values[2], min: values[0], max: values[4] }));
}
}
for (let i = 0; i < samples.length; i += 2) {
const before = samples[i].cold.price;
const after = samples[i + 1].cold.price;
if (before.requestedIdsSha256 !== after.requestedIdsSha256) throw new Error('Mismatched IDs');
if (![before, after].every(s => s.statuses.every(n => n === 200))) throw new Error('Non-200 response');
}

