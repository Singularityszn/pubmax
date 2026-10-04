import { CITIES } from "../fetch_city_osm_pubs.mjs";

// Census resident totals determine discovery order, not the map's extent.
// England/Wales: 2021 local authorities; Scotland: 2022 council areas;
// Belfast: 2021 district. Bath uses Bath and North East Somerset; Durham uses
// County Durham; Llandudno uses Conwy. These administrative totals are not
// estimates of how many people or venues lie inside our smaller map boxes.
const POPULATIONS = {
  birmingham: 1144900, leeds: 812000, glasgow: 620700, durham: 522100,
  manchester: 552000, liverpool: 486100, bristol: 472500,
  bath: 193400, oxford: 162100, cambridge: 145700, llandudno: 114800,
};
const EXTRAS = [
  ["sheffield", "Sheffield", 556500, [53.30, -1.61, 53.48, -1.34]],
  ["bradford", "Bradford", 546400, [53.72, -1.86, 53.87, -1.67]],
  ["edinburgh", "Edinburgh", 514990, [55.88, -3.35, 56.00, -3.05]],
  ["leicester", "Leicester", 368600, [52.57, -1.20, 52.70, -1.05]],
  ["cardiff", "Cardiff", 362400, [51.44, -3.28, 51.56, -3.10]],
  ["coventry", "Coventry", 345300, [52.36, -1.61, 52.47, -1.42]],
  ["belfast", "Belfast", 345418, [54.51, -6.04, 54.67, -5.80]],
  ["nottingham", "Nottingham", 323600, [52.90, -1.23, 53.04, -1.05]],
  ["newcastle", "Newcastle upon Tyne", 300200, [54.93, -1.75, 55.06, -1.50]],
  ["milton-keynes", "Milton Keynes", 287060, [51.96, -0.86, 52.10, -0.65]],
  ["sunderland", "Sunderland", 277417, [54.84, -1.52, 54.95, -1.31]],
  ["brighton", "Brighton and Hove", 277100, [50.79, -0.24, 50.88, -0.06]],
  ["plymouth", "Plymouth", 264700, [50.33, -4.24, 50.45, -4.04]],
  ["wolverhampton", "Wolverhampton", 263700, [52.53, -2.22, 52.66, -2.04]],
  ["derby", "Derby", 261400, [52.86, -1.56, 52.99, -1.38]],
  ["stoke-on-trent", "Stoke-on-Trent", 258375, [52.95, -2.26, 53.10, -2.09]],
  ["southampton", "Southampton", 248900, [50.86, -1.47, 50.96, -1.31]],
  ["swansea", "Swansea", 238500, [51.57, -4.03, 51.70, -3.86]],
  ["aberdeen", "Aberdeen", 224190, [57.09, -2.23, 57.22, -2.02]],
  ["portsmouth", "Portsmouth", 208100, [50.76, -1.13, 50.88, -1.02]],
  ["reading", "Reading", 174200, [51.41, -1.06, 51.50, -0.91]],
];

export const POPULATION_SOURCES = [
  "https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationestimates/bulletins/populationandhouseholdestimatesenglandandwales/census2021",
  "https://www.scotlandscensus.gov.uk/2022-reports/scotlands-census-2022-rounded-population-estimates/",
  "https://www.nisra.gov.uk/statistics/2021-census/population-and-household-estimates",
];

export const DISCOVERY_CITIES = [
  ...Object.values(CITIES).map((city) => ({ ...city, population: POPULATIONS[city.id], publishable: true })),
  ...EXTRAS.map(([id, displayName, population, bbox]) => ({ id, displayName, population, bbox, publishable: false })),
].sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));
