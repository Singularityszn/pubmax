"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import Screen from "@/components/ui/screen";
import { trackEvent } from "@/lib/analytics";
import { useClientReady } from "@/lib/useClientReady";
import { errorMessageFrom, offlineOrMessage, readApiJson } from "@/lib/apiErrorMessage";
import { authedFetch } from "@/lib/authedFetch";
import { PLAN_SHORTLIST_MAX, PLAN_SHORTLIST_MOODS, type ShortlistOption } from "@/lib/planShortlist";
import { ShortlistOptionDetails } from "./PlanShortlistCard";

const MOOD_LABELS: Record<(typeof PLAN_SHORTLIST_MOODS)[number], string> = {
  balanced: "Any vibe",
  quiet: "Quiet",
  lively: "Lively",
  garden: "Outdoor space",
  food: "Food",
  heritage: "Historic",
};

export default function PlanShortlistEntry({
  areas,
  children,
}: {
  areas: { slug: string; name: string }[];
  children: ReactNode;
}) {
  const query = useSearchParams();
  const ready = useClientReady();
  if (!ready || !query?.has("shortlist")) return children;
  return <ShortlistForm areas={areas} anchor={query.get("pub")} initialArea={query.get("area") ?? ""} />;
}

function ShortlistForm({ areas, anchor, initialArea }: {
  areas: { slug: string; name: string }[];
  anchor: string | null;
  initialArea: string;
}) {
  const router = useRouter();
  const [suggestion, setSuggestion] = useState<{ filters: string; options: ShortlistOption[] } | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const attempt = useRef<{ key: string; selection: string; startTime: string } | null>(null);
  const submitting = useRef(false);

  async function findPubs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const { area, mood, pintLimit } = Object.fromEntries(new FormData(event.currentTarget));
    const filters = new URLSearchParams({ area: String(area), mood: String(mood), pintLimit: String(pintLimit) });
    if (anchor) filters.set("anchor", anchor);
    submitting.current = true;
    setBusy(true);
    setMessage("");
    setSuggestion(null);
    setChosen([]);
    try {
      const response = await fetch(`/api/plans/shortlist?${filters}`);
      const result = await readApiJson(response) as { options?: ShortlistOption[] } | null;
      if (!response.ok || !result?.options) throw new Error(errorMessageFrom(result, "Could not find pubs. Try again."));
      setSuggestion({ filters: filters.toString(), options: result.options });
      if (anchor && result.options[0]?.reasons[0] === "Starting pub") setChosen([result.options[0].venueId]);
      if (!result.options.length) setMessage("No pubs found. Try another area.");
    } catch (error) {
      setMessage(offlineOrMessage(error instanceof Error ? error.message : "Could not find pubs. Try again."));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function createShortlist() {
    if (!suggestion || chosen.length === 0 || submitting.current) return;
    const budgetLimitPence = budget ? Math.round(Number(budget) * 100) : null;
    if (budgetLimitPence !== null && (!Number.isFinite(budgetLimitPence) || budgetLimitPence < 500 || budgetLimitPence > 50_000)) {
      setMessage("Enter an outing budget between £5 and £500 per person.");
      return;
    }
    const shortlist = { filters: suggestion.filters, venueIds: chosen, budgetLimitPence };
    const selection = JSON.stringify(shortlist);
    if (attempt.current?.selection !== selection) {
      attempt.current = { selection, key: crypto.randomUUID(), startTime: new Date().toISOString() };
    }
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await authedFetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": attempt.current.key },
        body: JSON.stringify({ shortlist, startTime: attempt.current.startTime }),
      }, { requiresIdentity: true });
      const result = await readApiJson(response) as { planId?: string; created?: boolean } | null;
      if (!response.ok || !result?.planId) throw new Error(errorMessageFrom(result, "Could not create the shortlist. Try again."));
      if (result.created) trackEvent("plan_shortlist_created");
      router.push(`/plan/${result.planId}`);
    } catch (error) {
      setMessage(offlineOrMessage(error instanceof Error ? error.message : "Could not create the shortlist. Try again."));
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen title="Shortlist pubs" lede="Give the group up to three pubs to choose from.">
      <div className="planShortlist">
        <form onSubmit={findPubs} className="planShortlist__fields">
          <label>Meet in
            <select name="area" required defaultValue={initialArea}>
              <option value="" disabled>Choose a London area</option>
              {areas.map((area) => <option key={area.slug} value={area.slug}>{area.name}</option>)}
            </select>
          </label>
          <label>Vibe
            <select name="mood">
              {PLAN_SHORTLIST_MOODS.map((mood) => <option key={mood} value={mood}>{MOOD_LABELS[mood]}</option>)}
            </select>
          </label>
          <label>Maximum per pint (£)<input name="pintLimit" type="number" min="0.01" max="100" step="0.01" /></label>
          <label>Whole outing budget per person (£)
            <input type="number" min="5" max="500" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
          <p className="planShortlist__note">The outing budget is for your reference. Pub prices cover individual pints.</p>
          <Button type="submit" variant={suggestion ? "secondary" : "primary"} disabled={busy}>Find pubs</Button>
        </form>
        {suggestion && suggestion.options.length > 0 ? (
          <div role="group" aria-label="Suggested pubs" className="planShortlist__options">
            {suggestion.options.map((option) => {
              const checked = chosen.includes(option.venueId);
              return (
                <article key={option.venueId} className="planShortlist__option">
                  <label>
                    <input type="checkbox" checked={checked} disabled={busy || (!checked && chosen.length >= PLAN_SHORTLIST_MAX)}
                      onChange={() => setChosen((current) => checked ? current.filter((id) => id !== option.venueId) : [...current, option.venueId])} />
                    {option.venueName}
                  </label>
                  <ShortlistOptionDetails option={option} />
                </article>
              );
            })}
            <Button type="button" disabled={busy || chosen.length === 0} onClick={() => void createShortlist()}>
              Create shortlist
            </Button>
          </div>
        ) : null}
        <p role="status">{message}</p>
        <Link href="/plan" prefetch={false}>Plan a pub crawl</Link>
      </div>
    </Screen>
  );
}
