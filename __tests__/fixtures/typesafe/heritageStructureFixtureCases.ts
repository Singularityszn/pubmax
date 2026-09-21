import type { HeritageStructureState } from "@/lib/heritageListingStructure";

export type HeritageStructureFixtureCase = {
  id: string;
  /** Whether the listing is the pub building itself. */
  listingIsPubBuilding: boolean;
  state: HeritageStructureState;
};

export const HERITAGE_STRUCTURE_FIXTURE_CASES: HeritageStructureFixtureCase[] = [
  {
    id: "duke-hamilton-stables",
    listingIsPubBuilding: false,
    state: {
      listing: {
        name: "STABLES IN REAR YARD OF THE DUKE OF HAMILTON PUBLIC HOUSE (PUBLIC HOUSE NOT INCLUDED)",
      },
      pub: { name: "The Duke of Hamilton" },
    },
  },
  {
    id: "gate-public-house",
    listingIsPubBuilding: true,
    state: {
      listing: { name: "THE GATE PUBLIC HOUSE" },
      pub: { name: "The Gate" },
    },
  },
  {
    id: "prospect-of-whitby",
    listingIsPubBuilding: true,
    state: {
      listing: { name: "PROSPECT OF WHITBY PUBLIC HOUSE" },
      pub: { name: "The Prospect of Whitby" },
    },
  },
  {
    id: "tottenham-high-cross",
    listingIsPubBuilding: false,
    state: {
      listing: { name: "TOTTENHAM HIGH CROSS" },
      pub: { name: "The High Cross" },
    },
  },
  {
    id: "dove-public-house",
    listingIsPubBuilding: true,
    state: {
      listing: { name: "THE DOVE PUBLIC HOUSE" },
      pub: { name: "The Dove" },
    },
  },
  {
    id: "railings-to-crown",
    listingIsPubBuilding: false,
    state: {
      listing: { name: "RAILINGS TO THE CROWN PUBLIC HOUSE" },
      pub: { name: "The Crown" },
    },
  },
  {
    id: "gateway-to-george",
    listingIsPubBuilding: false,
    state: {
      listing: { name: "GATEWAY TO THE GEORGE INN" },
      pub: { name: "The George" },
    },
  },
  {
    id: "old-windmill-and-restaurant",
    listingIsPubBuilding: true,
    state: {
      listing: { name: "THE OLD WINDMILL PUBLIC HOUSE AND RESTAURANT" },
      pub: { name: "The Old Windmill" },
    },
  },
  {
    id: "hamilton-social-club",
    listingIsPubBuilding: false,
    state: {
      listing: { name: "DUKE OF HAMILTON SOCIAL CLUB" },
      pub: { name: "The Duke of Hamilton" },
    },
  },
  {
    id: "fountain-in-yard",
    listingIsPubBuilding: false,
    state: {
      listing: { name: "FOUNTAIN IN YARD OF THE RED LION" },
      pub: { name: "The Red Lion" },
    },
  },
  {
    id: "wells-tavern",
    listingIsPubBuilding: true,
    state: {
      listing: { name: "WELLS TAVERN" },
      pub: { name: "Wells Tavern" },
    },
  },
  {
    id: "wall-and-railings",
    listingIsPubBuilding: false,
    state: {
      listing: { name: "WALL AND RAILINGS TO THE FREEMASONS ARMS" },
      pub: { name: "The Freemasons Arms" },
    },
  },
];
