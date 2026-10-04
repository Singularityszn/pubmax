import { CITIES } from "../fetch_city_osm_pubs.mjs";

// Census resident totals determine discovery order, not the map's extent.
// England/Wales: 2021 local authorities; Scotland: 2022 council areas.
// Bath uses Bath and North East Somerset; Durham uses County Durham;
// Llandudno uses Conwy. These administrative totals are not estimates of how
// many people or venues lie inside our smaller map boxes.
const POPULATIONS = {
  birmingham: 1144900, leeds: 812000, glasgow: 620700, durham: 522100,
  manchester: 552000, liverpool: 486100, bristol: 472500,
  bath: 193400, oxford: 162100, cambridge: 145700, llandudno: 114800,
};

export const POPULATION_SOURCES = [
  "https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationestimates/bulletins/populationandhouseholdestimatesenglandandwales/census2021",
  "https://www.scotlandscensus.gov.uk/2022-reports/scotlands-census-2022-rounded-population-estimates/",
];

export const DISCOVERY_CITIES = Object.values(CITIES)
  .map((city) => ({ ...city, population: POPULATIONS[city.id] }))
  .sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));
