import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const protocol = JSON.parse(readFileSync(resolve(here, 'protocol.json')));
const hash = (s) => createHash('sha256').update(s).digest('hex');
const osmPath = 'data/osm/uk/uk_osm_pubs.json';
const slimPath = 'public/data/venues_slim.json';
const osmBytes = readFileSync(resolve(root, osmPath));
const slimBytes = readFileSync(resolve(root, slimPath));
const osm = JSON.parse(osmBytes);
const slim = JSON.parse(slimBytes).rows;
const byName = new Map();
for (const row of slim) {
  const key = row.name.toLowerCase();
  byName.set(key, [...(byName.get(key) ?? []), row]);
}
const candidates = [];
for (const pub of osm.pubs) {
  if (!pub.website || !pub.postcode || pub.amenity !== 'pub') continue;
  let url;
  try { url = new URL(pub.website); } catch { continue; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
  // The name AND coordinates must match. A pub name alone can select another town.
  const match = (byName.get(pub.name.toLowerCase()) ?? []).find((row) => {
    const north = (row.lat - pub.lat) * 111.2;
    const east = (row.lng - pub.lng) * 69.2;
    return Math.hypot(north, east) <= 0.15 && row.borough;
  });
  if (!match) continue;
  const north = (pub.lat - 51.5074) * 111.2;
  const east = (pub.lng + 0.1278) * 69.2;
  const stratum = Math.hypot(north, east) <= 6 ? 'inner'
    : Math.abs(north) > Math.abs(east) ? (north > 0 ? 'north' : 'south')
      : east > 0 ? 'east' : 'west';
  candidates.push({
    venueId: pub.osmId, appVenueId: match.id, name: pub.name,
    website: url.href, postcode: pub.postcode, address: pub.address,
    borough: match.borough, lat: pub.lat, lng: pub.lng,
    operatorRecorded: pub.operator ?? null,
    stratum, host: url.hostname.toLowerCase().replace(/^www\./, ''),
    selectionKey: hash(`${protocol.seed}:${pub.osmId}`),
    source: { file: osmPath, osmId: pub.osmId, fetchedAt: osm.fetchedAt },
  });
}
const hostCounts = new Map();
for (const row of candidates) hostCounts.set(row.host, (hostCounts.get(row.host) ?? 0) + 1);
for (const row of candidates) row.hostingStratum = hostCounts.get(row.host) >= 3 ? 'shared-host' : 'venue-host';
const selected = [];
const usedSites = new Set();
const selectedHostCounts = new Map();
for (const stratum of ['inner', 'north', 'south', 'east', 'west']) {
  for (const [hosting, quota] of [['shared-host', 4], ['venue-host', 8]]) {
    const rows = candidates.filter((r) => r.stratum === stratum && r.hostingStratum === hosting)
      .sort((a, b) => a.selectionKey.localeCompare(b.selectionKey));
    let count = 0;
    for (const row of rows) {
      if (usedSites.has(row.website) || (selectedHostCounts.get(row.host) ?? 0) >= 3) continue;
      selected.push(row);
      usedSites.add(row.website);
      selectedHostCounts.set(row.host, (selectedHostCounts.get(row.host) ?? 0) + 1);
      if (++count === quota) break;
    }
    if (count !== quota) throw new Error(`Insufficient ${stratum}/${hosting}: ${count}/${quota}`);
  }
}
selected.sort((a, b) => a.selectionKey.localeCompare(b.selectionKey));
// Select review venues before crawling. No arm outcomes enter this selection.
const reviewIds = new Set();
for (const stratum of ['inner', 'north', 'south', 'east', 'west']) {
  for (const hosting of ['shared-host', 'venue-host']) {
    reviewIds.add(selected.find((r) => r.stratum === stratum && r.hostingStratum === hosting).venueId);
  }
}
for (const row of selected) { if (reviewIds.size < 12) reviewIds.add(row.venueId); }
for (const row of selected) {
  row.goldSample = reviewIds.has(row.venueId);
  row.armOrder = Number.parseInt(row.selectionKey.slice(0, 2), 16) % 2 ? ['B', 'A'] : ['A', 'B'];
}
const manifest = {
  schemaVersion: 1, protocolSha256: hash(readFileSync(resolve(here, 'protocol.json'))),
  sourceFiles: [{ path: osmPath, sha256: hash(osmBytes) }, { path: slimPath, sha256: hash(slimBytes) }],
  eligibleVenues: candidates.length, selection: 'Seeded hash, 12 per geographic stratum, including 4 shared-host and 8 venue-host websites. Maximum 3 venues per host. Postcode required. Name and coordinates within 150 metres must match the London app dataset.',
  limitations: 'A balanced stress sample, not a prevalence estimate. Existing London app inclusion and OSM website/postcode completeness affect selection. Hosting is not ownership. Menu format is unknown before crawling.',
  venues: selected,
};
writeFileSync(resolve(here, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ venues: selected.length, eligible: candidates.length, goldSample: reviewIds.size }));
