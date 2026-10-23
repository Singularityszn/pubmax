"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { Check, Link2, Route } from "lucide-react";
import { useState } from "react";

import { styleLabels, type CrawlMode } from "@/components/map/ControlRail";
import type { Filters } from "@/lib/venues";
import { linkWithMapPlanDrinkSelection, type MapPlanDrinkSelection } from "@/lib/mapPlanDrinkPresentation";
import {
  ALT_CRAWL_STYLES,
  altStyleLabels,
  type AltCrawlStyle,
} from "@/lib/crawlUrl";

type RouteHeaderProps = {
  mode: CrawlMode;
  crawlStyle: Filters["crawlStyle"];
  crawlName?: string;
  crawlBlurb?: string;
  drinkLabel?: string;
  linkDrinkSelection?: MapPlanDrinkSelection | null;
  altStyle: AltCrawlStyle;
  onAltStyleChange: (style: AltCrawlStyle) => void;
};

export default function RouteHeader({
  mode,
  crawlStyle,
  crawlName,
  crawlBlurb,
  drinkLabel,
  linkDrinkSelection,
  altStyle,
  onAltStyleChange,
}: RouteHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  async function copyLink() {
    setCopyError("");
    try {
      const href = window.location.href;
      await navigator.clipboard.writeText(
        linkDrinkSelection ? linkWithMapPlanDrinkSelection(href, linkDrinkSelection) : href,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  return (
    <>
      <div className="routeHeader">
        <div>
          <p className="eyebrow">{mode === "build" ? "Your plan" : "Suggested plan"}</p>
          <h2>
            {drinkLabel ? crawlName || `${drinkLabel} plan` : mode === "build"
              ? crawlName || "Hand-built plan"
              : `${styleLabels[crawlStyle]} plan`}
          </h2>
          {drinkLabel && crawlName ? <p className="description muted">{drinkLabel} stops</p> : null}
          {crawlBlurb ? (
            <p className="description muted" style={{ margin: "4px 0 0" }}>
              {crawlBlurb}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="shareBtn"
          onClick={copyLink}
          aria-label="Copy a shareable link to this crawl"
        >
          {copied ? <Check size={14} /> : <Link2 size={14} />}
          {copied ? "Copied" : "Copy link"}
        </button>
        {copyError ? <p role="status">{copyError}</p> : null}
        <Route size={24} />
      </div>

      {drinkLabel ? null : <div
        className="altStylePicker"
        role="radiogroup"
        aria-label="Crawl style"
        data-testid="alt-style-picker"
      >
        {ALT_CRAWL_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            role="radio"
            aria-checked={altStyle === style}
            className={altStyle === style ? "altStyleBtn active" : "altStyleBtn"}
            onClick={() => onAltStyleChange(style)}
          >
            {altStyleLabels[style]}
          </button>
        ))}
      </div>}
    </>
  );
}
