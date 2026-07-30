export const POSTCODE_COORDINATE_MAX_DISTANCE_KM: number;
export const POSTCODE_COORDINATE_IDENTITY_TOLERANCE_DEGREES: number;

export type PostcodeCoordinateRow = {
  app_price_id?: string;
  pub_name?: string;
  address?: string;
  latitude?: number | string;
  longitude?: number | string;
};

export type OsmPub = {
  postcode?: string;
  lat?: number;
  lng?: number;
};

export type PostcodeCoordinateFinding = {
  rowIndex: number;
  appPriceId: string;
  pubName: string;
  postcode: string;
  outwardCode: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  reference: {
    outwardCode: string;
    latitude: number;
    longitude: number;
    sampleCount: number;
  };
};

export function parseUkPostcode(
  value: unknown,
): { postcode: string; outwardCode: string } | null;

export function matchesPostcodeCoordinateQuarantineIdentity(
  row: PostcodeCoordinateRow,
  entry: {
    pubName?: string;
    postcode?: string;
    latitude?: number | string;
    longitude?: number | string;
  },
): boolean;

export function haversineDistanceKm(
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number,
): number;

export function buildOutwardCodeReferences(
  osmPubs: OsmPub[],
): Map<
  string,
  {
    outwardCode: string;
    latitude: number;
    longitude: number;
    sampleCount: number;
  }
>;

export function validatePostcodeCoordinateQuarantine(options: {
  rows: PostcodeCoordinateRow[];
  osmPubs: OsmPub[];
  quarantineRegistry: unknown;
  maxDistanceKm?: number;
}): {
  checkedRows: number;
  referenceCount: number;
  appliedQuarantines: PostcodeCoordinateFinding[];
  unquarantinedContradictions: PostcodeCoordinateFinding[];
  invalidQuarantines: string[];
};

export function findPostcodeCoordinateContradictions(options: {
  rows: PostcodeCoordinateRow[];
  osmPubs: OsmPub[];
  exceptionRegistry: unknown;
  maxDistanceKm?: number;
}): {
  checkedRows: number;
  referenceCount: number;
  contradictions: PostcodeCoordinateFinding[];
  appliedExceptions: PostcodeCoordinateFinding[];
  invalidExceptions: string[];
};
