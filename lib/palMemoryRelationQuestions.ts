import { choice, type Questions } from "@typesafe-ai/sdk";

import { palMemoryRelationQuestionId } from "@/lib/palMemoryRelation";

const RELATION_CRITERIA = {
  add: {
    what: "`newFact` is about something else, or adds a detail that sits beside the memory without changing it",
    not_for: "The same fact again, a fact that replaces the memory, or one that withdraws it",
    examples: ["memory: likes cask ale / new: likes beer gardens", "memory: uses a wheelchair / new: likes quiz nights"],
  },
  update: {
    what: "`newFact` is about the same thing as the memory and should replace it: it contradicts it, or states it more exactly",
    not_for: "Two separate facts that can both stay true, or a fact that only withdraws the memory",
    examples: [
      "memory: loves lager / new: has gone off lager",
      "memory: likes quiet pubs / new: likes quiet pubs with a garden",
    ],
  },
  delete: {
    what: "`newFact` only says the memory is no longer true, and leaves nothing new to keep in its place",
    not_for: "A fact that says what is true now, which is an update",
    examples: ["memory: needs step-free access / new: no longer needs step-free access", "memory: lives in Hackney / new: forget where I live"],
  },
  noop: {
    what: "`newFact` says the same thing as the memory in other words, so there is nothing new to remember",
    not_for: "A fact that adds, changes or withdraws anything",
    examples: ["memory: prefers quiet pubs / new: likes it quiet", "memory: vegetarian / new: doesn't eat meat"],
  },
};

/** One Choice per candidate: how does the new fact relate to this one memory? */
export function buildPalMemoryRelationQuestions(candidateCount: number): Questions {
  const questions: Questions = {};
  for (let index = 0; index < candidateCount; index += 1) {
    const memory = `memory${index}`;
    questions[palMemoryRelationQuestionId(index)] = choice(
      {
        question: `How does \`newFact\` relate to the remembered fact \`${memory}\` about the same person?`,
        inspect: "newFact",
        compare: ["newFact", memory],
        focus:
          "Judge the meaning, not the wording. A contradiction or a more exact version is update; the same meaning is noop; an unrelated or additional fact is add.",
      },
      RELATION_CRITERIA,
    );
  }
  return questions;
}
