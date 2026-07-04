// POST /api/heritage — "The Landlord" heritage Q&A for one pub.
// Grounded in retrieved facts only; never exposes API keys; never 500s the demo.

import { answerHeritage, NO_STORY_LINE, type HeritageContext } from "@/lib/heritage";

const MAX_QUESTION_LEN = 300;

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Malformed JSON." }, { status: 400 });
    }

    const record = (body ?? {}) as Record<string, unknown>;

    const venueName = typeof record.venueName === "string" ? record.venueName.trim() : "";
    if (!venueName) {
      return Response.json({ error: "venueName is required." }, { status: 400 });
    }

    const rawQuestion = typeof record.question === "string" ? record.question.trim() : "";
    if (!rawQuestion) {
      return Response.json({ error: "question is required." }, { status: 400 });
    }
    const question = rawQuestion.slice(0, MAX_QUESTION_LEN);

    const venueId = typeof record.venueId === "string" ? record.venueId : undefined;
    const context =
      record.context && typeof record.context === "object"
        ? (record.context as HeritageContext)
        : undefined;

    const response = await answerHeritage({ venueId, venueName, question, context });
    return Response.json(response, { status: 200 });
  } catch {
    // Never 500 the demo — degrade to the honest empty-line answer.
    return Response.json({ answer: NO_STORY_LINE, citations: [] }, { status: 200 });
  }
}
