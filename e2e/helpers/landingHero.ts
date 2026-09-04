// The landing's one primary action, by name. With a real pub behind the
// document it reads "Still £6.50?" and opens that pub's Pint Drop door; with
// no card it is the plain receipt door. Specs match the pattern rather than a
// figure, because the figure is the dataset's and rots in a string.
export const LANDING_PRIMARY_NAME = /^(Still £\d+\.\d\d\?|Log what you paid)$/;
// #1462 — the door carries the figure the label named, so the composer it
// opens holds it. The pattern, not the figure, for the same reason as above.
export const LANDING_PRIMARY_HREF =
  /^\/map\?sel=[^&]+&log=1&price=\d+\.\d\d$|^\/near\?locate=1$/;
