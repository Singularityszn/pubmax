import type { SamePubPairState } from "@/lib/samePubIdentity";

export type SamePubFixtureCase = {
  id: string;
  /** Whether the pair is the same physical pub */
  same: boolean;
  state: SamePubPairState;
};

/** Unit-test cases plus dataset-shaped pairs for threshold calibration. */
export const SAME_PUB_FIXTURE_CASES: SamePubFixtureCase[] = [
  {
    id: "kings-head-tavern",
    same: true,
    state: {
      a: {
        name: "The Kings Head",
        address: "1 Market Pl, Kingston upon Thames",
        operator: null,
        website: null,
      },
      b: {
        name: "Kings Head Tavern",
        address: "Kingston upon Thames, Greater London",
        operator: null,
        website: null,
      },
      distanceMetres: 12,
    },
  },
  {
    id: "bell-vs-bell-and-crown",
    same: false,
    state: {
      a: { name: "The Bell", address: "London", operator: null, website: null },
      b: { name: "The Bell and Crown", address: "London", operator: null, website: null },
      distanceMetres: 20,
    },
  },
  {
    id: "moon-wetherspoon-suffix",
    same: true,
    state: {
      a: {
        name: "The Moon on the Hill",
        address: "373-375 Station Rd, Harrow HA1 2AW, UK",
        operator: null,
        website: null,
      },
      b: {
        name: "The Moon on the Hill - JD Wetherspoon",
        address: "373 Station Road, Harrow HA1 2AW",
        operator: "Wetherspoon",
        website: "https://www.jdwetherspoon.com",
      },
      distanceMetres: 56,
    },
  },
  {
    id: "new-cross-inn-house",
    same: false,
    state: {
      a: { name: "New Cross Inn", address: "New Cross, London", operator: null, website: null },
      b: { name: "New Cross House", address: "New Cross, London", operator: null, website: null },
      distanceMetres: 40,
    },
  },
  {
    id: "coach-and-horses-pub",
    same: true,
    state: {
      a: { name: "Coach and Horses", address: "Soho, London", operator: null, website: null },
      b: { name: "Coach and Horses Pub", address: "Soho, London", operator: null, website: null },
      distanceMetres: 8,
    },
  },
  {
    id: "crown-and-anchor",
    same: false,
    state: {
      a: { name: "The Crown", address: "London", operator: null, website: null },
      b: { name: "Crown and Anchor", address: "London", operator: null, website: null },
      distanceMetres: 25,
    },
  },
  {
    id: "old-hat-ealing",
    same: true,
    state: {
      a: { name: "Old Hat", address: "Ealing, London", operator: null, website: null },
      b: { name: "Old Hat Ealing", address: "Ealing Broadway, London", operator: null, website: null },
      distanceMetres: 30,
    },
  },
  {
    id: "canonbury-tavern",
    same: true,
    state: {
      a: { name: "Canonbury", address: "Canonbury, London N1", operator: null, website: null },
      b: { name: "Canonbury Tavern", address: "Canonbury Place, London N1", operator: null, website: null },
      distanceMetres: 15,
    },
  },
  {
    id: "red-lion-vs-slug",
    same: false,
    state: {
      a: { name: "Red Lion", address: "High Street, London", operator: null, website: null },
      b: { name: "Slug and Lettuce", address: "High Street, London", operator: null, website: null },
      distanceMetres: 50,
    },
  },
  {
    id: "rochester-castle-spoons",
    same: true,
    state: {
      a: {
        name: "The Rochester Castle",
        address: "145 Stoke Newington High St, London N16 0NY",
        operator: null,
        website: null,
      },
      b: {
        name: "The Rochester Castle - JD Wetherspoon",
        address: "145 Stoke Newington High Street, London N16 0NY",
        operator: "Wetherspoon",
        website: null,
      },
      distanceMetres: 5,
    },
  },
];
