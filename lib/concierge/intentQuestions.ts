import { choice, noul, type Questions } from "@typesafe-ai/sdk";

import { CONCIERGE_MOODS, type ConciergeMood } from "@/lib/concierge/rank";
import {
  AREA_NONE,
  BUDGET_CHEAP,
  BUDGET_EXPLICIT,
  BUDGET_UNSTATED,
  GROUP_UNSTATED,
  moodQuestionId,
} from "@/lib/concierge/intentPolicy";

const MOOD_CRITERIA: Record<
  ConciergeMood,
  {
    question: string;
    focus: string;
    trueWhat: string;
    trueExamples: string[];
    falseWhat: string;
    falseExamples: string[];
  }
> = {
  balanced: {
    question: "Does `text` ask for a mixed or no-particular-vibe pub night?",
    focus: "Count 'balanced', 'bit of everything', or 'anything'. Not a named mood such as quiet or lively.",
    trueWhat: "The drinker wants a mixed night or has no strong atmosphere preference.",
    trueExamples: ["A bit of everything near Soho", "Anything around Camden for four"],
    falseWhat: "A specific atmosphere, garden, match, or meal is named.",
    falseExamples: ["Quiet garden near Soho", "Somewhere lively for the match"],
  },
  quiet: {
    question: "Does `text` ask for a quiet, calm, or low-key pub?",
    focus: "Count quiet, quiet-ish, calm, chat, or low-key. A garden or meal can sit beside this.",
    trueWhat: "The drinker wants a quieter room or a place to talk.",
    trueExamples: ["Quiet-ish near Bank", "Somewhere calm for a chat"],
    falseWhat: "No quiet or low-key request. Lively, match, or party nights do not count.",
    falseExamples: ["Lively bar in Soho", "Where is the football on?"],
  },
  lively: {
    question: "Does `text` ask for a lively, buzzing, or party atmosphere?",
    focus: "Count lively, buzzing, party, or atmosphere as a crowd request. Not merely 'nice atmosphere' for a date.",
    trueWhat: "The drinker wants energy, buzz, or a party room.",
    trueExamples: ["Somewhere lively in Shoreditch", "Buzzing bar for eight of us"],
    falseWhat: "Quiet, cosy, or date requests. A match screening is sports, not lively.",
    falseExamples: ["Cosy fireside pint", "Quiet chat in Marylebone"],
  },
  cosy: {
    question: "Does `text` ask for a cosy, snug, or fireside pub?",
    focus: "Count cosy, cozy, snug, or fireside. Not merely quiet.",
    trueWhat: "The drinker wants a snug, warm, or fireside room.",
    trueExamples: ["Cosy in Shoreditch for two", "Snug fireside pint"],
    falseWhat: "Quiet without cosy words, or a garden / riverside request.",
    falseExamples: ["Quiet near Bank", "Beer garden if it's sunny"],
  },
  garden: {
    question: "Does `text` ask for a garden, outdoor, or sunny outside space?",
    focus: "Count garden, outside, outdoor, or sunny as a request for outdoor drinking.",
    trueWhat: "The drinker wants a beer garden or outdoor tables.",
    trueExamples: ["Garden in Soho for 6", "Somewhere outdoor and sunny"],
    falseWhat: "Indoor moods with no outdoor ask.",
    falseExamples: ["Cosy fireside in Camden", "Quiet chat near Bank"],
  },
  riverside: {
    question: "Does `text` ask for a riverside, waterside, or by-the-water pub?",
    focus: "Count riverside, river, waterside, or by the water. Not a garden away from water.",
    trueWhat: "The drinker wants a pub on the river or water.",
    trueExamples: ["Riverside pints in Greenwich", "Somewhere by the water"],
    falseWhat: "Garden or street pubs with no water request.",
    falseExamples: ["Garden in Soho", "Quiet near Bank"],
  },
  sports: {
    question: "Does `text` ask for sport screens, a match, football, or rugby?",
    focus: "Count sport, sports, football, rugby, or match as a screening request.",
    trueWhat: "The drinker wants to watch sport in a pub.",
    trueExamples: ["Sports near Waterloo for 8", "Where is the football on?"],
    falseWhat: "No match or screening request.",
    falseExamples: ["Quiet garden near Soho", "Date night in Marylebone"],
  },
  date: {
    question: "Does `text` ask for a date or romantic pub night?",
    focus: "Count date or romantic. A table for two is not enough on its own.",
    trueWhat: "The drinker wants a date-night or romantic pub.",
    trueExamples: ["Date night in Soho", "Somewhere romantic for two"],
    falseWhat: "A pair of mates, a quiet pint, or a meal with no date wording.",
    falseExamples: ["Cosy in Shoreditch for two", "Dinner near King's Cross"],
  },
  food: {
    question: "Does `text` ask for food, dinner, or a meal at the pub?",
    focus: "Count food, dinner, eat, or meal. A pint-only request does not count.",
    trueWhat: "The drinker wants to eat as well as drink.",
    trueExamples: ["Dinner near King's Cross", "Pub with food in Camden"],
    falseWhat: "Drinks-only requests with no meal wording.",
    falseExamples: ["Quiet pint near Bank", "Cocktails in Soho"],
  },
  cocktails: {
    question: "Does `text` ask for cocktails or mixed drinks?",
    focus: "Count cocktail, cocktails, or mixed drinks. Beer or wine alone does not count.",
    trueWhat: "The drinker wants cocktails.",
    trueExamples: ["Cocktails in Soho for four", "Somewhere for mixed drinks"],
    falseWhat: "Beer, wine, or food requests with no cocktail wording.",
    falseExamples: ["Pint near Bank", "Dinner in Marylebone"],
  },
  heritage: {
    question: "Does `text` ask for a heritage, historic, or old pub?",
    focus: "Count heritage, historic, history, or old pub.",
    trueWhat: "The drinker wants a historic or old pub.",
    trueExamples: ["Historic pub in Greenwich", "Old pub with a story"],
    falseWhat: "Atmosphere or food requests with no history wording.",
    falseExamples: ["Quiet garden near Soho", "Lively bar in Shoreditch"],
  },
};

export type ConciergeIntentQuestionInput = {
  areaCandidates: readonly string[];
  groupSizeCandidates: readonly string[];
};

export function conciergeIntentQuestions(input: ConciergeIntentQuestionInput): Questions {
  const questions: Questions = {};
  for (const mood of CONCIERGE_MOODS) {
    const spec = MOOD_CRITERIA[mood];
    questions[moodQuestionId(mood)] = noul(
      {
        question: spec.question,
        inspect: "text",
        focus: spec.focus,
      },
      {
        true: { what: spec.trueWhat, examples: spec.trueExamples },
        false: { what: spec.falseWhat, examples: spec.falseExamples },
      },
    );
  }

  const areaCriteria: Record<string, { what: string; not_for: string }> = {
    [AREA_NONE]: {
      what: "The request does not name a neighbourhood, station, or district, or only says near me / here.",
      not_for: "A named place they want to drink in",
    },
  };
  for (const area of input.areaCandidates) {
    areaCriteria[area] = {
      what: `The request names ${area} as the place they want to drink.`,
      not_for: "A different place, or no place at all",
    };
  }
  questions.area = choice(
    {
      question: "Which place in `text` is the area they want to drink in?",
      inspect: "text",
      focus: "Pick the neighbourhood, station, or district named as the location. Pick none when they did not name a place.",
    },
    areaCriteria,
  );

  const groupCriteria: Record<string, { what: string; not_for: string }> = {
    [GROUP_UNSTATED]: {
      what: "The request does not say how many people are going.",
      not_for: "A named group size such as 4 of us or table for six",
    },
  };
  for (const size of input.groupSizeCandidates) {
    groupCriteria[size] = {
      what: `The drinking group is ${size} people.`,
      not_for: "A pint price, a walking time, or an unstated group",
    };
  }
  questions.groupSize = choice(
    {
      question: "Which number in `text` is the size of the drinking group?",
      inspect: "text",
      focus: "Count people, mates, of us, or a table for N. Ignore pint prices and minutes.",
    },
    groupCriteria,
  );

  questions.budgetSignal = choice(
    {
      question: "What budget signal does `text` carry for a pint?",
      inspect: "text",
      focus: "An explicit figure is a number such as under £7. Cheap is a word such as not pricey, with no figure. Unstated is neither.",
    },
    {
      [BUDGET_EXPLICIT]: {
        what: "The request names a pint-price cap as a number.",
        not_for: "Cheap or budget words with no figure",
        examples: ["under £7", "max 8 quid", "up to £5.50"],
      },
      [BUDGET_CHEAP]: {
        what: "The request asks for cheap, budget, affordable, or not-pricey pints without naming a figure.",
        not_for: "An explicit pound figure, or no budget talk at all",
        examples: ["not pricey", "somewhere cheap", "affordable pints"],
      },
      [BUDGET_UNSTATED]: {
        what: "The request does not mention price, cheapness, or a pint cap.",
        not_for: "Cheap words or an explicit figure",
        examples: ["Quiet garden near Soho", "Sports near Waterloo for 8"],
      },
    },
  );

  return questions;
}
