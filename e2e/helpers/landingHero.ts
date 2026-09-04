// The landing's one primary action, by name. With a real pub behind the
// document it reads "Still £6.50?" and opens that pub's Pint Drop door; with
// no card it is the plain receipt door. Specs match the pattern rather than a
// figure, because the figure is the dataset's and rots in a string.
export const LANDING_PRIMARY_NAME = /^(Still £\d+\.\d\d\?|Log what you paid)$/;
export const LANDING_PRIMARY_HREF = /^\/map\?sel=[^&]+&log=1$|^\/near\?locate=1$/;
