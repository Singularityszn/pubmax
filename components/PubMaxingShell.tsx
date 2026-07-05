"use client";

import dynamic from "next/dynamic";

const PubMap = dynamic(() => import("./PubMap"), {
  ssr: false,
  loading: () => (
    <main className="loadingShell">
      <div>
        <p className="eyebrow">PUBMAXXING</p>
        <h1>Loading London pub map...</h1>
      </div>
    </main>
  ),
});

export default function PubMaxingShell() {
  return <PubMap />;
}
