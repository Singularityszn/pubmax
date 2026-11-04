"use client";

import { useSyncExternalStore } from "react";

import { christmasCrawlInSeason, planTemplatesFor, type PlanTemplate } from "@/lib/planTemplates";

// The template row reads London's date, which the server painting /plan
// cannot know for a reader: the document is prerendered and handed to every
// stranger. So the server paint and the hydrating render offer the evergreen
// row, and the browser's own clock decides the seasonal template once mounted.
// The answer is a boolean, so the store hands back the same value on every
// read within a day.
const noSubscription = () => () => {};
const readInSeason = () => christmasCrawlInSeason(new Date());
const serverInSeason = () => false;

/** The starting-point templates, with a seasonal one leading in its window. */
export default function PlanTemplateRow({ onPick }: { onPick: (template: PlanTemplate) => void }) {
  const inSeason = useSyncExternalStore(noSubscription, readInSeason, serverInSeason);
  return (
    <div className="planComposer__templateRow">
      {planTemplatesFor(inSeason).map((template) => (
        <button
          key={template.id}
          type="button"
          className="planComposer__template"
          title={template.blurb}
          onClick={() => onPick(template)}
        >
          {template.label}
        </button>
      ))}
    </div>
  );
}
