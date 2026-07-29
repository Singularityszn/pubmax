// Measured against the committed UK OSM pub reference on 2026-07-29. Product
// rows formed one cluster through 3.87 km, then a clear gap to contradictions
// starting at 5.44 km. Five kilometres keeps that empirical separation.
export const POSTCODE_COORDINATE_MAX_DISTANCE_KM = 5;

const POSTCODE_PATTERN =
  /(?:^|[^A-Z0-9])([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[ABD-HJLNP-UW-Z]{2})(?=$|[^A-Z0-9])/i;

export function parseUkPostcode(value) {
  const match = String(value ?? "")
    .toUpperCase()
    .match(POSTCODE_PATTERN);
  if (!match) return null;
  return {
    postcode: `${match[1]} ${match[2]}`,
    outwardCode: match[1],
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function haversineDistanceKm(
  firstLatitude,
  firstLongitude,
  secondLatitude,
  secondLongitude,
) {
  const radians = Math.PI / 180;
  const latitudeDelta = (secondLatitude - firstLatitude) * radians;
  const longitudeDelta = (secondLongitude - firstLongitude) * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude * radians) *
      Math.cos(secondLatitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(haversine));
}

export function buildOutwardCodeReferences(osmPubs) {
  const grouped = new Map();
  for (const pub of osmPubs) {
    const parsed = parseUkPostcode(pub?.postcode);
    const latitude = Number(pub?.lat);
    const longitude = Number(pub?.lng);
    if (
      !parsed ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }
    const points = grouped.get(parsed.outwardCode) ?? new Map();
    points.set(`${latitude}|${longitude}`, { latitude, longitude });
    grouped.set(parsed.outwardCode, points);
  }

  return new Map(
    [...grouped].map(([outwardCode, uniquePoints]) => {
      const points = [...uniquePoints.values()];
      return [
        outwardCode,
        {
          outwardCode,
          latitude: median(points.map((point) => point.latitude)),
          longitude: median(points.map((point) => point.longitude)),
          sampleCount: points.length,
        },
      ];
    }),
  );
}

function describeException(index, message) {
  return `exception ${index}: ${message}`;
}

function validateExceptionShape(exception, index) {
  const errors = [];
  if (
    typeof exception?.appPriceId !== "string" ||
    exception.appPriceId.trim().length === 0
  ) {
    errors.push(describeException(index, "appPriceId must be non-empty"));
  }
  if (
    typeof exception?.pubName !== "string" ||
    exception.pubName.trim().length === 0
  ) {
    errors.push(describeException(index, "pubName must be non-empty"));
  }
  if (!parseUkPostcode(exception?.postcode)) {
    errors.push(
      describeException(index, "postcode must be a complete UK postcode"),
    );
  }
  if (
    !Number.isFinite(exception?.latitude) ||
    !Number.isFinite(exception?.longitude)
  ) {
    errors.push(
      describeException(index, "latitude and longitude must be finite numbers"),
    );
  }
  if (
    typeof exception?.reason !== "string" ||
    exception.reason.trim().length < 20
  ) {
    errors.push(
      describeException(index, "reason must contain at least 20 characters"),
    );
  }
  return errors;
}

export function findPostcodeCoordinateContradictions({
  rows,
  osmPubs,
  exceptionRegistry,
  maxDistanceKm = POSTCODE_COORDINATE_MAX_DISTANCE_KM,
}) {
  const references = buildOutwardCodeReferences(osmPubs);
  const findings = [];
  let checkedRows = 0;

  rows.forEach((row, rowIndex) => {
    const parsed = parseUkPostcode(row?.address);
    const reference = parsed
      ? references.get(parsed.outwardCode)
      : undefined;
    const latitude = Number(row?.latitude);
    const longitude = Number(row?.longitude);
    if (
      !parsed ||
      !reference ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return;
    }
    checkedRows += 1;
    const distanceKm = haversineDistanceKm(
      reference.latitude,
      reference.longitude,
      latitude,
      longitude,
    );
    if (distanceKm <= maxDistanceKm) return;
    findings.push({
      rowIndex,
      appPriceId: String(row.app_price_id ?? ""),
      pubName: String(row.pub_name ?? ""),
      postcode: parsed.postcode,
      outwardCode: parsed.outwardCode,
      latitude,
      longitude,
      distanceKm,
      reference,
    });
  });

  const exceptions = exceptionRegistry?.exceptions;
  const invalidExceptions = [];
  const appliedExceptionIds = new Set();
  const seenExceptionIds = new Set();

  if (!Array.isArray(exceptions)) {
    invalidExceptions.push("top-level exceptions must be an array");
  } else {
    exceptions.forEach((exception, index) => {
      const shapeErrors = validateExceptionShape(exception, index);
      invalidExceptions.push(...shapeErrors);
      if (shapeErrors.length > 0) return;

      if (seenExceptionIds.has(exception.appPriceId)) {
        invalidExceptions.push(
          describeException(
            index,
            `duplicate appPriceId ${exception.appPriceId}`,
          ),
        );
        return;
      }
      seenExceptionIds.add(exception.appPriceId);

      const row = rows.find(
        (candidate) => candidate?.app_price_id === exception.appPriceId,
      );
      if (!row) {
        invalidExceptions.push(
          describeException(
            index,
            `appPriceId ${exception.appPriceId} is not in the product dataset`,
          ),
        );
        return;
      }

      const rowPostcode = parseUkPostcode(row.address)?.postcode;
      const exceptionPostcode = parseUkPostcode(exception.postcode)?.postcode;
      if (
        row.pub_name !== exception.pubName ||
        rowPostcode !== exceptionPostcode ||
        Number(row.latitude) !== exception.latitude ||
        Number(row.longitude) !== exception.longitude
      ) {
        invalidExceptions.push(
          describeException(
            index,
            `identity fields do not exactly match ${exception.appPriceId}`,
          ),
        );
        return;
      }

      const finding = findings.find(
        (candidate) => candidate.appPriceId === exception.appPriceId,
      );
      if (!finding) {
        invalidExceptions.push(
          describeException(
            index,
            `${exception.appPriceId} is not a postcode-coordinate contradiction`,
          ),
        );
        return;
      }
      appliedExceptionIds.add(exception.appPriceId);
    });
  }

  return {
    checkedRows,
    referenceCount: references.size,
    contradictions: findings.filter(
      (finding) => !appliedExceptionIds.has(finding.appPriceId),
    ),
    appliedExceptions: findings.filter((finding) =>
      appliedExceptionIds.has(finding.appPriceId),
    ),
    invalidExceptions,
  };
}
