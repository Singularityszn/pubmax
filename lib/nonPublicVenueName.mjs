// Plain ESM with a `.d.mts` sidecar: lib/venueKindFilters.ts and the plain-node
// name cleaner (lib/curatedVenueName.mjs) share it.

// THE CHEAPEST-PINT RANKINGS ARE FOR BARS A STRANGER CAN WALK INTO. The listing
// we import holds real prices at bars a member of the public cannot use: a
// students' union bar (The Three Tuns, LSE SU, topped Westminster at £2.95), a
// working men's club, a services or social club. The price is real and the row
// stays in the dataset and on the map, but a "cheapest listed pints" answer that
// sends a reader to a door they will be turned away from is a wrong answer. The
// dataset has no access field, so the name is the only evidence we hold, and
// these are the words that say the bar is for members, students or staff.
const NON_PUBLIC_VENUE_NAME = new RegExp(
  [
    String.raw`\bstudents?['’]?\s*(?:['’]s\s*)?union\b`,
    String.raw`\bstudents?['’]?\s+bar\b`,
    String.raw`\bstaff\s+(?:bar|club)\b`,
    String.raw`\bmembers['’]?\s*(?:only|club|bar)\b`,
    String.raw`\bworking\s*men['’]?s['’]?\s+club\b`,
    String.raw`\bsocial\s+club\b`,
    String.raw`\bsports\s+(?:and|&)\s+social\b`,
    String.raw`\b(?:constitutional|conservative|labour|liberal|services|railway|supporters['’]?)\s+club\b`,
    String.raw`\bex[-\s]?servicemen\b`,
    String.raw`\b(?:royal\s+)?british\s+legion\b`,
    String.raw`\b(?:officers|sergeants)['’]?\s+mess\b`,
  ].join("|"),
  "i",
);

// "SU" alone is a students' union only in capitals, so it is matched with case.
const STUDENTS_UNION_INITIALS = /(?:^|[\s(\-–,])SU(?:$|[\s)\-–,])/;

// A university's initials run into the SU ("Eagle & Ball by BCUSU", Birmingham
// City University SU, which won Birmingham's cheapest pint in the 1 Nov 2026
// hunt). Capitals only and a whole word, two to six letters before the SU: on
// 1 Nov 2026 that matched exactly one of about 40,000 pub names we hold.
const STUDENTS_UNION_JOINED_INITIALS = /(?:^|[\s(\-–,])[A-Z]{2,6}SU(?:$|[\s)\-–,])/;

/** True when the venue's own name says it is not open to the public. */
export function isNonPublicVenueName(name) {
  const text = String(name ?? "");
  return (
    NON_PUBLIC_VENUE_NAME.test(text) ||
    STUDENTS_UNION_INITIALS.test(text) ||
    STUDENTS_UNION_JOINED_INITIALS.test(text)
  );
}
