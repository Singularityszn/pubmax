"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { readPalQuestStamps, type PalQuestStamp as Stamp } from "@/lib/palQuest";

import PalQuestStamp from "./PalQuestStamp";
import "./palQuest.css";

// The Pal's stamp book on /pal: one stamp for each day the person answered the
// Pal's price quest, newest first. It reads this device's book only
// (lib/palQuest.ts) and shows no total, because a stamp is a mark, not a score.
export default function PalQuestStamps({ palName, print }: { palName: string; print: readonly boolean[] }) {
  const [stamps, setStamps] = useState<Stamp[] | null>(null);
  useEffect(() => {
    const read = () => setStamps(readPalQuestStamps());
    queueMicrotask(read);
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);
  if (stamps === null) return null;
  return (
    <section className="palStampBook" aria-labelledby="pal-stamp-book-title" data-testid="pal-stamp-book">
      <h2 id="pal-stamp-book-title">Price stamps</h2>
      {stamps.length === 0 ? (
        <p className="palStampBookEmpty">
          {palName} hands out one price quest a day. Each one you answer leaves a stamp here.{" "}
          <Link href="/near" prefetch={false}>
            Find today&apos;s quest
          </Link>
        </p>
      ) : (
        <ul className="palStampBookList">
          {stamps.map((stamp) => (
            <li key={stamp.day}>
              <PalQuestStamp stamp={stamp} print={print} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
