// Every outside source PUBMAXX shows data from, with its licence and the
// credit it asks for. /credits prints this table, and every surface that shows
// a source's data links there (components/legal/DataCreditsLink.tsx).
//
// ONE TABLE, AND THE DATA HOLDS IT TO ITSELF. A committed pack that declares a
// licence must belong to an entry here by licence and publisher
// (__tests__/dataCredits.test.tsx), so a new source cannot ship its data
// without its credit.
//
// The words are the publishers' own where they ask for exact words, and plain
// statements of fact everywhere else. Nothing here claims a licence the tree
// does not use the data under.

type DataLicence = {
  name: string;
  url: string;
};

export type DataCredit = {
  id: string;
  /** Who publishes it. */
  name: string;
  sourceUrl: string;
  /** Null where the data is used under the publisher's own terms rather than an open licence. */
  licence: DataLicence | null;
  /** The credit line, word for word where the publisher asks for exact words. */
  attribution: string;
  /** What PUBMAXX shows from it, in one sentence. */
  usedFor: string;
  /**
   * Words a committed pack's own attribution or source names this publisher
   * by. Only a source that ships a committed pack carries any.
   */
  packMarks: readonly string[];
};

const OGL_V3: DataLicence = {
  name: "Open Government Licence v3.0",
  url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
};
const ODBL: DataLicence = {
  name: "Open Database Licence (ODbL) 1.0",
  url: "https://opendatacommons.org/licenses/odbl/1-0/",
};
const CC0: DataLicence = {
  name: "CC0 1.0 (public domain dedication)",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
};
const CC_BY_SA_4: DataLicence = {
  name: "CC BY-SA 4.0",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
};
const CC_BY_4: DataLicence = {
  name: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
};

export const DATA_CREDITS: readonly DataCredit[] = [
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    licence: ODBL,
    attribution: "© OpenStreetMap contributors",
    usedFor:
      "Where pubs, bars, cafés and restaurants are across the UK, their names, addresses and place names, and the tags that link a pub to its hygiene rating and its Wikidata item.",
    packMarks: ["OpenStreetMap"],
  },
  {
    id: "fsa-fhrs",
    name: "Food Standards Agency, Food Hygiene Rating Scheme",
    sourceUrl: "https://ratings.food.gov.uk/open-data",
    licence: OGL_V3,
    attribution:
      "Food hygiene ratings from the Food Standards Agency. Contains public sector information licensed under the Open Government Licence v3.0.",
    usedFor: "The food hygiene rating on a pub's sheet, with the month the local authority awarded it.",
    packMarks: ["Food Standards Agency"],
  },
  {
    id: "historic-england-nhle",
    name: "Historic England, National Heritage List for England (NHLE)",
    sourceUrl: "https://historicengland.org.uk/listing/the-list/",
    licence: OGL_V3,
    attribution:
      "Listed-building data from Historic England's National Heritage List for England (NHLE), © Historic England, licensed under the Open Government Licence v3.0.",
    usedFor: "Whether a pub is a listed building, its grade, and a link to its official list entry.",
    packMarks: ["Historic England"],
  },
  {
    id: "wikidata",
    name: "Wikidata",
    sourceUrl: "https://www.wikidata.org/",
    licence: CC0,
    attribution: "Wikidata",
    usedFor:
      "What Wikidata records about a pub, such as its inception or heritage designation, each linked to the statement it came from.",
    packMarks: ["Wikidata"],
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/",
    licence: CC_BY_SA_4,
    attribution: "Text from Wikipedia, linked to the article it came from.",
    usedFor: "Short pub histories on the Lore tab, each linked to its Wikipedia article.",
    packMarks: [],
  },
  {
    id: "tfl",
    name: "Transport for London",
    sourceUrl: "https://tfl.gov.uk/info-for/open-data-users/",
    licence: null,
    attribution: "Powered by TfL Open Data",
    usedFor: "Last trains home, nearby bus departures, line disruption and the rail lines drawn on the map.",
    packMarks: [],
  },
  {
    id: "police-uk",
    name: "data.police.uk",
    sourceUrl: "https://data.police.uk/",
    licence: OGL_V3,
    attribution: "Contains public sector information licensed under the Open Government Licence v3.0.",
    usedFor: "The one calm or busy hint on the way home, read from street-level records for a whole area.",
    packMarks: [],
  },
  {
    id: "open-meteo",
    name: "Open-Meteo",
    sourceUrl: "https://open-meteo.com/",
    licence: CC_BY_4,
    attribution: "Weather data by Open-Meteo.com",
    usedFor: "The weather for each night area, and the pubs suited to it.",
    packMarks: [],
  },
  {
    id: "basemaps",
    name: "OpenFreeMap and CARTO",
    sourceUrl: "https://openfreemap.org/",
    licence: null,
    attribution: "Credited on the map itself, in the words each provider asks for.",
    usedFor: "The map tiles under the pins. CARTO is the fallback when OpenFreeMap is unavailable.",
    packMarks: [],
  },
  {
    id: "event-listings",
    name: "Ticketmaster, Skiddle, Eventbrite, football-data.org and TheSportsDB",
    sourceUrl: "https://pubmaxxing.com/tonight",
    licence: null,
    attribution: "Each listing names and links the service it came from.",
    usedFor: "Gigs, quizzes and match screenings on Tonight, under each service's own terms.",
    packMarks: [],
  },
  {
    id: "google-places",
    name: "Google Places",
    sourceUrl: "https://cloud.google.com/maps-platform/terms",
    licence: null,
    attribution: "Shown with Google's attribution wherever it appears.",
    usedFor: "Some venue details, each dated, under the Google Maps Platform terms.",
    packMarks: [],
  },
  {
    id: "wetherspoon",
    name: "J D Wetherspoon pub directory",
    sourceUrl: "https://www.jdwetherspoon.com/",
    licence: null,
    attribution: "Read from Wetherspoon's own published directory.",
    usedFor: "Which pubs Wetherspoon runs today, and where.",
    packMarks: [],
  },
  {
    id: "spoonme",
    name: "SpoonMe",
    sourceUrl: "https://spoonme.vercel.app/report",
    licence: null,
    attribution: "Oliver Clegg's SpoonMe report, credited and linked wherever its ranking is printed. It states no licence.",
    usedFor: "The Spoons value ranking, which is SpoonMe's reading of Wetherspoon menus, never ours.",
    packMarks: [],
  },
];

function licenceFamily(value: string): string | null {
  const text = value.toLowerCase();
  if (text.includes("odbl") || text.includes("open database")) return "odbl";
  if (text.includes("open government")) return "ogl";
  if (text.includes("cc0")) return "cc0";
  if (text.includes("by-sa")) return "cc-by-sa";
  if (/\bcc[ -]?by\b/.test(text)) return "cc-by";
  return null;
}

/**
 * The credit a committed pack belongs to, judged by its declared licence and
 * by the publisher its attribution or source names. Null when none does.
 */
export function creditForPack(pack: Record<string, unknown>): DataCredit | null {
  const declared = [pack.license, pack.licence, pack.$licence].find((value) => typeof value === "string");
  if (typeof declared !== "string") return null;
  const family = licenceFamily(declared);
  const named = [pack.attribution, pack.$attribution, pack.source, pack.$source]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return (
    DATA_CREDITS.find(
      (credit) =>
        credit.licence !== null &&
        licenceFamily(credit.licence.name) === family &&
        credit.packMarks.some((mark) => named.includes(mark)),
    ) ?? null
  );
}

export const DATA_CREDITS_PATH = "/credits";
