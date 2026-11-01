"use client";

import { useCallback, useState } from "react";
import { BookOpen, MessageCircle, Send, Sparkles } from "lucide-react";
import { discardBody } from "@/lib/responseBody";
import { venueKindNoun } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";
import { citationSourceLabel } from "@/lib/citationSourceLabel";
import { noteCrawlBingoAction } from "@/lib/crawlBingoNightLog";

type Context = {
  era?: string;
  heritageNote?: string;
  address?: string;
  borough?: string;
};

type Citation = { source: string; ref?: string };

type HeritageResponse = {
  answer: string;
  citations: Citation[];
  clarifyingQuestion?: string;
};

const SUGGESTIONS = ["How old is it?", "Is it listed?", "What's the story?"];
export default function LandlordPanel(props: {
  venueId: string;
  venueName: string;
  venueKind?: VenueKind;
  context?: Context;
}) {
  const { venueId, venueName, venueKind, context } = props;
  const venueNoun = venueKindNoun(venueKind);
  const defaultQuestion = `What's the story of this ${venueNoun}?`;

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<HeritageResponse | null>(null);
  const [error, setError] = useState(false);

  // VenueAskSection keys this panel by venue, so a new pub mounts a fresh
  // panel and the old pub's in-flight answer lands on an unmounted one.
  const ask = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || loading) return;
      setLoading(true);
      setError(false);
      setAnswer(null);
      try {
        const res = await fetch("/api/heritage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId, venueName, question: trimmed, context }),
        });
        if (!res.ok) {
          discardBody(res);
          throw new Error(`HTTP ${res.status}`);
        }
        setAnswer((await res.json()) as HeritageResponse);
        // Pub crawl bingo: the pub's story was asked and answered (lib/crawlBingo.ts).
        noteCrawlBingoAction("story", venueId);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [loading, venueId, venueName, context],
  );

  return (
    <section className="landlord">
      <div className="inspectorTitle">
        <MessageCircle size={14} /> Ask your venue guide
      </div>

      <button
        type="button"
        className="landlordBtn"
        disabled={loading}
        onClick={() => ask(defaultQuestion)}
      >
        <Sparkles size={16} /> Tell me about this {venueNoun}
      </button>

      <form
        className="landlordForm"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <input
          aria-label={`Ask about this ${venueNoun}`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Ask about this ${venueNoun}…`}
        />
        <button type="submit" aria-label="Send" disabled={loading}>
          <Send size={16} />
        </button>
      </form>

      <div className="landlordSuggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => ask(s)}>
            {s}
          </button>
        ))}
      </div>

      {/* Live region stays mounted so screen readers announce the async answer
          (or error) as it arrives. aria-busy reflects the in-flight fetch. */}
      <div role="status" aria-live="polite" aria-busy={loading}>
        {loading && <div className="landlordThinking">Pulling up the records…</div>}

        {error && !loading && (
          <p className="landlordMsg">Couldn&apos;t reach your venue guide. Try again.</p>
        )}

        {answer && !loading && (
          <>
            <div className="landlordAnswer">
              <p>{answer.answer}</p>
              {answer.clarifyingQuestion && (
                <p className="landlordClarify">{answer.clarifyingQuestion}</p>
              )}
            </div>
            {answer.citations.length > 0 && (
              <div className="landlordCitations">
                {answer.citations.map((c, i) =>
                  c.ref ? (
                    <a
                      key={`${c.source}-${i}`}
                      className="citationChip"
                      href={c.ref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <BookOpen size={14} />
                      {citationSourceLabel(c.source)}
                    </a>
                  ) : (
                    <span key={`${c.source}-${i}`} className="citationChip">
                      <BookOpen size={14} />
                      {citationSourceLabel(c.source)}
                    </span>
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
