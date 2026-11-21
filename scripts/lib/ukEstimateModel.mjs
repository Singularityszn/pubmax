const MIN_SAMPLE = 3;
const RADIUS_KM = 2;
const EARTH_KM = 6371;

function distanceKm(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function area(postcode) {
  return /^([A-Z]{1,2})\d[A-Z\d]?\s*\d[A-Z]{2}$/i.exec(String(postcode ?? "").trim())?.[1].toUpperCase() ?? null;
}

function locality(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en-GB") : "";
}

function median(samples) {
  const values = samples.map((sample) => sample.priceGbp).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return Math.round((values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2) * 100) / 100;
}

function gridKey(lat, lng) {
  return `${Math.floor(lat / 0.025)}:${Math.floor(lng / 0.05)}`;
}

function add(map, key, sample) {
  if (!key) return;
  const rows = map.get(key) ?? [];
  rows.push(sample);
  map.set(key, rows);
}

export function buildUkEstimateModel(samples) {
  const seen = new Set();
  const grid = new Map();
  const localities = new Map();
  const areas = new Map();
  for (const sample of samples) {
    if (!sample.id || seen.has(sample.id) || !Number.isFinite(sample.lat) || !Number.isFinite(sample.lng) ||
      !Number.isFinite(sample.priceGbp) || sample.priceGbp < 2 || sample.priceGbp > 12) continue;
    seen.add(sample.id);
    add(grid, gridKey(sample.lat, sample.lng), sample);
    add(localities, locality(sample.locality), sample);
    add(areas, area(sample.postcode), sample);
  }
  return (pub) => {
    if (!Number.isFinite(pub.lat) || !Number.isFinite(pub.lng)) return null;
    const nearby = [];
    const latCell = Math.floor(pub.lat / 0.025);
    const lngCell = Math.floor(pub.lng / 0.05);
    for (let lat = latCell - 1; lat <= latCell + 1; lat++) {
      for (let lng = lngCell - 1; lng <= lngCell + 1; lng++) {
        for (const sample of grid.get(`${lat}:${lng}`) ?? []) {
          if (sample.id !== pub.id && distanceKm(pub, sample) <= RADIUS_KM) nearby.push(sample);
        }
      }
    }
    if (nearby.length >= MIN_SAMPLE) return { priceGbp: median(nearby), basis: "nearby", sampleSize: nearby.length, detail: RADIUS_KM };
    const town = (localities.get(locality(pub.locality)) ?? []).filter((sample) => sample.id !== pub.id && distanceKm(pub, sample) <= 30);
    if (town.length >= MIN_SAMPLE) return { priceGbp: median(town), basis: "locality", sampleSize: town.length, detail: pub.locality.trim() };
    const postcodeArea = area(pub.postcode);
    const regional = (areas.get(postcodeArea) ?? []).filter((sample) => sample.id !== pub.id);
    if (regional.length >= MIN_SAMPLE) return { priceGbp: median(regional), basis: "postcode_area", sampleSize: regional.length, detail: postcodeArea };
    return null;
  };
}
