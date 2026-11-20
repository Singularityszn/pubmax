"use client";

import { usePublicTonightListings } from "@/components/out/usePublicTonightListings";
import { LANDING_TONIGHT_LINK, landingTonightAnswer } from "@/lib/landingAnswers";

export default function LandingTonightAnswer({ hypedCount }: { hypedCount?: number }) {
  const { whatsOn, out } = usePublicTonightListings();
  let answer = LANDING_TONIGHT_LINK;
  if (whatsOn.status !== "idle" && !out.pending) {
    // eslint-disable-next-line react-hooks/purity -- expire dated rows on the live read's clock
    answer = landingTonightAnswer(whatsOn.rows, whatsOn.status, out, Date.now(), hypedCount);
  }
  return (
    <>
      <span className="lpAnswerTileLine">{answer.line}</span>
      {answer.stamp ? <span className="lpAnswerTileStamp">{answer.stamp}</span> : null}
    </>
  );
}
