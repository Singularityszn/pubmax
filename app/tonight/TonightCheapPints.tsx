"use client";

import { Component, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";

import { PintPriceBadge } from "@/components/PriceBadge";
import { RowList, RowListItem } from "@/components/ui/row-list";
import { formatSnapshotFrom } from "@/lib/dataFreshness";
import { oldestPintRead } from "@/lib/drinks";
import {
  TONIGHT_CHEAP_PINTS_TITLE,
  tonightCheapPintChainLabel,
  tonightCheapPintHref,
  type TonightCheapPint,
} from "@/lib/tonightCheapPints";

const WIDTH_QUERY = "(min-width: 600px)";
const READ_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

function subscribeWidth(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }
  const media = window.matchMedia(WIDTH_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function wideScreen(): boolean {
  return typeof window.matchMedia === "function" ? window.matchMedia(WIDTH_QUERY).matches : window.innerWidth >= 600;
}

type Presentation = ComponentType<{ rows: readonly TonightCheapPint[] }>;

class PresentationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/** The list remains visible until the matching presentation is ready. */
function PintPresentation({ rows }: { rows: readonly TonightCheapPint[] }) {
  const wide = useSyncExternalStore<boolean | null>(subscribeWidth, wideScreen, () => null);
  const [loaded, setLoaded] = useState<{ wide: boolean; component: Presentation } | null>(null);
  useEffect(() => {
    if (wide === null) return;
    let active = true;
    const request = wide ? import("./TonightPintBelt") : import("@/components/wild/BeerMats");
    void request.then((module) => {
      if (active) setLoaded({ wide, component: module.default });
    }).catch(() => {
      if (active) setLoaded(null);
    });
    return () => { active = false; };
  }, [wide]);
  if (!loaded || loaded.wide !== wide) return null;
  const View = loaded.component;
  return <PresentationBoundary key={wide ? "belt" : "mats"}><View rows={rows} /></PresentationBoundary>;
}

/** The selected row's own evidence, shown even when a presentation cannot load. */
function TonightPintEvidence({ row }: { row: TonightCheapPint }) {
  const date = row.observedAt ? new Date(row.observedAt) : null;
  const readable = date && Number.isFinite(date.getTime());
  return <>
    {row.drinkLabel || "Drink not recorded"} · {row.servingSize || "Serving not recorded"} ·{" "}
    {row.publisher ? <a href={row.publisher.url} target="_blank" rel="noreferrer" style={{ position: "relative", zIndex: 1 }}>{row.publisher.label}</a> : "Publisher not recorded"} ·{" "}
    {readable ? <time dateTime={row.observedAt ?? undefined}>{READ_DAY.format(date)}</time> : "Read date not recorded"}
  </>;
}

export default function TonightCheapPints({ rows = [], show = true }: {
  rows?: readonly TonightCheapPint[];
  show?: boolean;
}) {
  if (!show || rows.length === 0) return null;
  const observedAt = oldestPintRead(rows.map((row) => row.observedAt));
  return (
    <section className="tonightCheapPints tonightSection" aria-labelledby="tonight-cheap-pints-title">
      <h2 className="tonightCheapPintsTitle tonightSectionTitle" id="tonight-cheap-pints-title">{TONIGHT_CHEAP_PINTS_TITLE}</h2>
      {observedAt ? <p className="tonightCheapPintsCredit tonightSectionLine">{formatSnapshotFrom(new Date(observedAt))}</p> : null}
      <div className="tonightCheapPintsAnswer" data-testid="tonight-cheap-pints">
        <PintPresentation rows={rows} />
        <RowList className="tonightCheapPintsList tonightCheapPintsBeltList">
          {rows.map((row) => (
            <RowListItem key={row.venueId} className="tonightCheapPintsRow" href={tonightCheapPintHref(row)} title={row.name}
              meta={<>{row.borough}{row.chain ? <> · <span data-chain={row.chain}>{tonightCheapPintChainLabel(row.chain)}</span></> : null}<br /><TonightPintEvidence row={row} /></>}
              trailing={<PintPriceBadge priceGbp={row.priceGbp} venueId={row.venueId} />} />
          ))}
        </RowList>
      </div>
    </section>
  );
}
