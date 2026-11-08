import type { Route } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { BOARD_READ_ACTION } from "@/lib/boardRead";

import "@/components/board/boardReader.css";

export default function NotOnTheBoard() {
  return (
    <main id="main" className="boardPage">
      <SiteNav />
      <Screen
        as="section"
        className="boardScreen"
        kicker={BOARD_READ_ACTION}
        title="This pub isn't on the map"
        titleId="board-title"
      >
        <Link prefetch={false} href={"/map" as Route}>Back to the map</Link>
      </Screen>
    </main>
  );
}
