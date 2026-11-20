"use client";

import { use } from "react";
import FairPintFrame from "./FairPintFrame";

const bootstrap = process.env.NEXT_RUNTIME
  ? import("./FairPintBootstrap").then(({ fairPintPreludeScript }) => fairPintPreludeScript())
  : null;

export default function FairPintPrelude({ area, nonce }: { area: string; nonce?: string }) {
  const script = bootstrap ? use(bootstrap) : "";
  return (
    <>
      <FairPintFrame prelude area={area} pence={550} reason={`Checking prices in ${area}…`} />
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}
