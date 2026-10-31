"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { drinkProvenanceLabel, type Drink } from "@/lib/drinks";
import type { FoodItem } from "@/lib/food";
import { menuBasketItems, quoteMenuBasket } from "@/lib/menuBasket";
import { formatObservedDate } from "@/lib/dataFreshness";
import "./menuBasket.css";

const money = (pence: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

export default function MenuBasket({ venueId, food, drinks }: { venueId: string; food: readonly FoodItem[]; drinks: readonly Drink[] }) {
  const labelId = useId();
  const [quantities, setQuantities] = useState<Record<string, number | "">>({});
  const rows = menuBasketItems(venueId, food, drinks);
  const selected = rows.filter((item) => {
    const quantity = quantities[item.id] ?? 0;
    return quantity === "" || quantity > 0;
  });
  const pending = selected.some((item) => quantities[item.id] === "");
  const quote = selected.length && !pending ? quoteMenuBasket(venueId, rows, Object.fromEntries(Object.entries(quantities).map(([id, quantity]) => [id, Number(quantity)])), new Date().toISOString()) : null;
  if (!rows.length) return null;
  return (
    <details className="menuBasket">
      <summary>Add up food and drinks</summary>
      <div className="menuBasketBody">
        <p id={labelId}>Choose your items and quantities. These are listed menu prices, so check them with the venue.</p>
        <label className="menuBasketAdd">
          Add an item
          <select aria-label="Add an item" value="" onChange={(event) => {
            const id = event.target.value;
            if (rows.some((item) => item.id === id)) setQuantities((old) => ({ ...old, [id]: Math.min(100, (old[id] || 0) + 1) }));
          }}>
            <option value="">Choose food or a drink</option>
            {(["food", "drink"] as const).map((kind) => <optgroup key={kind} label={kind === "food" ? "Food" : "Drinks"}>
              {rows.filter((item) => item.kind === kind).map((item) => <option key={item.id} value={item.id}>
                {item.name}{item.serving ? ` (${item.serving})` : ""} · {item.unitPence === null ? "Price needs checking" : money(item.unitPence)}
              </option>)}
            </optgroup>)}
          </select>
        </label>
        <div role="group" aria-labelledby={labelId}>
          {selected.map((item) => {
            const quantity = quantities[item.id] ?? 0;
            const publisherLabel = drinkProvenanceLabel({ source: item.evidence.source, sourceUrl: item.evidence.url ?? undefined });
            return <div key={item.id} className="menuBasketRow">
              <label>
                <span>{item.name}</span>
                <span className="menuBasketMeta">{item.kind === "food" ? "Food" : "Drink"} · {item.serving ?? "Serving size not recorded"}</span>
                <span className="menuBasketAmount">{item.unitPence === null ? "Price needs checking" : money(item.unitPence)}</span>
                <input type="number" min={0} max={100} step={1} inputMode="numeric" aria-label={`Quantity of ${item.name}`} aria-invalid={quantity === "" || undefined} value={quantity} onChange={(event) => {
                  const next = event.target.valueAsNumber;
                  setQuantities((old) => ({ ...old, [item.id]: Number.isInteger(next) && next >= 0 && next <= 100 ? next : "" }));
                }} />
              </label>
              <span className="menuBasketMeta">
                {item.evidence.url ? <a href={item.evidence.url} target="_blank" rel="noopener noreferrer">{publisherLabel}</a> : publisherLabel}
                {item.evidence.observedAt ? <> · Collected <time dateTime={item.evidence.observedAt}>{formatObservedDate(new Date(item.evidence.observedAt))}</time></> : " · Collection date not recorded"}
              </span>
            </div>;
          })}
        </div>
        <div role="status" aria-live="polite" aria-atomic="true" className="menuBasketResult">
          {selected.length ? <>
            <p>Menu subtotal: <strong>{quote?.menuSubtotalPence == null ? "Incomplete" : money(quote.menuSubtotalPence)}</strong></p>
            {pending ? <p>Enter a whole quantity from 0 to 100 for each item.</p> : null}
            <p>Full cost unknown. Required fees, tax, deposits and availability need checking.</p>
            {quote?.reasons.some((r) => r.code === "stale") ? <p>Some prices need a new check. Their collection dates are shown above.</p> : null}
            <Button variant="ghost" type="button" onClick={() => setQuantities({})}>Clear items</Button>
          </> : <p>Choose an item to see the menu subtotal.</p>}
        </div>
      </div>
    </details>
  );
}
