"use client";

import { useId, useState } from "react";

import {
  calculateCrawlCost,
  CRAWL_LIMITS,
  formatPence,
  parsePriceToPence,
  parseWholeNumber,
  type CrawlCostField,
} from "@/lib/crawlCostCalculator";

export type PriceSuggestion = { price: string; label: string };

type Values = Record<CrawlCostField, string>;

const FIELDS: ReadonlyArray<{ field: CrawlCostField; label: string; inputMode: "numeric" | "decimal"; prefix?: string }> = [
  { field: "people", label: "People", inputMode: "numeric" },
  { field: "stops", label: "Pubs", inputMode: "numeric" },
  { field: "drinksPerStop", label: "Drinks each at each pub", inputMode: "numeric" },
  { field: "pricePence", label: "Price of a drink", inputMode: "decimal", prefix: "£" },
];

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export default function CrawlCostCalculator({ suggestion }: { suggestion: PriceSuggestion | null }) {
  const baseId = useId();
  const [values, setValues] = useState<Values>({
    people: "4",
    stops: "4",
    drinksPerStop: "1",
    pricePence: suggestion?.price ?? "",
  });

  const priceEntered = values.pricePence.trim() !== "";
  const result = priceEntered
    ? calculateCrawlCost({
        people: parseWholeNumber(values.people),
        stops: parseWholeNumber(values.stops),
        drinksPerStop: parseWholeNumber(values.drinksPerStop),
        pricePence: parsePriceToPence(values.pricePence),
      })
    : null;
  const errorField = result && !result.ok ? result.field : null;

  return (
    <div className="crawlCost">
      <form className="crawlCostForm" onSubmit={(event) => event.preventDefault()} noValidate>
        {FIELDS.map(({ field, label, inputMode, prefix }) => {
          const inputId = `${baseId}-${field}`;
          const hintId = `${inputId}-hint`;
          const limits = CRAWL_LIMITS[field];
          const hint = field === "pricePence"
            ? suggestion && values.pricePence === suggestion.price
              ? suggestion.label
              : "Enter the price in pounds, for example 6.20"
            : `${limits.min} to ${limits.max}`;
          return (
            <div key={field} className="crawlCostField">
              <label htmlFor={inputId}>{label}</label>
              <div className="crawlCostInput">
                {prefix ? <span aria-hidden="true">{prefix}</span> : null}
                <input
                  id={inputId}
                  name={field}
                  type="text"
                  inputMode={inputMode}
                  autoComplete="off"
                  value={values[field]}
                  aria-invalid={errorField === field ? true : undefined}
                  aria-describedby={hintId}
                  onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
                />
              </div>
              <p id={hintId} className="crawlCostHint">{hint}</p>
            </div>
          );
        })}
      </form>

      <div className="crawlCostResult" aria-live="polite">
        {result === null ? (
          <p className="legalBody">Enter the price of a drink to see the cost.</p>
        ) : !result.ok ? (
          <p className="legalBody" role="alert">{result.message}</p>
        ) : (
          <>
            <dl className="legalRows">
              <div className="legalRow"><dt>Each person pays</dt><dd>{formatPence(result.perPersonPence)}</dd></div>
              <div className="legalRow"><dt>The whole crawl</dt><dd>{formatPence(result.totalPence)}</dd></div>
              <div className="legalRow"><dt>At each pub</dt><dd>{formatPence(result.perStopPence)}</dd></div>
              <div className="legalRow"><dt>One round</dt><dd>{formatPence(result.roundPence)}</dd></div>
              <div className="legalRow"><dt>Drinks each</dt><dd>{result.drinksEach}</dd></div>
            </dl>
            <p className="legalBody" data-rounds-verdict>
              {result.rounds.buyingOneMore === 0
                ? `In rounds, it is even: each person buys ${plural(result.rounds.fewest, "round", "rounds")}.`
                : `In rounds, ${plural(result.rounds.buyingOneMore, "person buys", "people buy")} ${plural(result.rounds.fewest + 1, "round", "rounds")} and the others buy ${result.rounds.fewest}. They pay ${formatPence(result.rounds.gapPence)} more. Split the bill to balance the drinks you chose.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
