/** Recognise a UK postcode or outward district, without claiming a location. */
export function isMapPostcodeQuery(query: string): boolean {
  return /^(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?(?:\s?\d[A-Z]{2})?)$/i.test(query.trim());
}
