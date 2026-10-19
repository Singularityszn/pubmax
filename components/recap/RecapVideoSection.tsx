"use client";

// The recap video's place on the public recap page. The Player and Remotion
// load only here, on demand and in the browser, so a recap with the flag off
// (`PUBMAX_RECAP_VIDEO`) ships none of their code.

import dynamic from "next/dynamic";

import type { RecapVideoInput } from "@/lib/recapVideo";

const RecapVideoPlayer = dynamic(() => import("@/components/recap/RecapVideoPlayer"), {
  ssr: false,
  loading: () => <div className="recapVideo__placeholder" aria-hidden="true" />,
});

export default function RecapVideoSection({ input }: { input: RecapVideoInput }) {
  return (
    <div className="recapVideo">
      <RecapVideoPlayer input={input} />
    </div>
  );
}
