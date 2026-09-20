import { noul } from "@typesafe-ai/sdk";

export const PUB_PAL_FENCE_QUESTION_IDS = {
  fitToTravelAfterDrinking: "fitToTravelAfterDrinking",
  getHomeTonight: "getHomeTonight",
} as const;

export const PUB_PAL_FENCE_QUESTIONS = {
  [PUB_PAL_FENCE_QUESTION_IDS.fitToTravelAfterDrinking]: noul(
    {
      question:
        "Is the user asking whether they are fit to drive, cycle or otherwise travel after drinking?",
      inspect: "message",
      focus:
        "Count questions about being too drunk, sober enough, or safe to operate a vehicle or bike after alcohol. Not pub recommendations or transport facts with no personal fitness ask.",
    },
    {
      true: {
        what:
          "The user wants a judgment about their own ability to travel after drinking.",
        examples: [
          "Can I drive?",
          "have I had too many?",
          "safe to cycle back?",
          "Am I too drunk to get the tube?",
        ],
      },
      false: {
        what:
          "General pub chat, prices, venues, or transport without asking about the user's sobriety or fitness to travel.",
        examples: [
          "What's the last train from Waterloo?",
          "Quiet garden near Soho",
          "How much is a pint there?",
        ],
      },
    },
  ),
  [PUB_PAL_FENCE_QUESTION_IDS.getHomeTonight]: noul(
    {
      question: "Is the user asking how to get home tonight?",
      inspect: "message",
      focus:
        "Count requests for a route, ride, or practical way home now. Not historical trivia or venue discovery.",
    },
    {
      true: {
        what: "The user wants help getting home from where they are tonight.",
        examples: [
          "How do I get home from here?",
          "Best way home after closing?",
          "Can you book me an Uber home?",
        ],
      },
      false: {
        what: "Other pub planning or chat without a get-home request.",
        examples: [
          "Where's a good pub near King's Cross?",
          "What time does the pub close?",
          "Should I try the beer garden?",
        ],
      },
    },
  ),
};
