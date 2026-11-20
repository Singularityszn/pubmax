"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import { pintDropDoorHref } from "@/lib/landingHero";
import { accountBoundFetch } from "@/lib/accountBoundFetch";
import { readContributionGateStatus } from "@/lib/contributionGateStatus";
import { useContributionGate } from "@/components/identity/ContributionGateDialog";
import { readDeviceAccountSessionRevision, subscribeDeviceAccountSession } from "@/lib/deviceAccountIdentity";
import { validateDealPrice } from "@/lib/dealPrice";
import { DRINK_MEASURES, DRINK_MEASURE_LABEL } from "@/lib/drinkMeasure";
import { DRINK_CATEGORIES, CATEGORY_META } from "@/lib/drinks";
import "./dealComposer.css";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = { venueId: string; visible?: boolean; onClose?: () => void };
export default function DealPriceComposer(props: Props) {
  const revision = useSyncExternalStore(subscribeDeviceAccountSession, readDeviceAccountSessionRevision, () => 0);
  return <AccountDealPriceComposer key={`${props.venueId}:${revision}`} {...props} />;
}

function AccountDealPriceComposer({ venueId, visible = true, onClose }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      const form = formRef.current;
      if (!form?.getClientRects().length) return;
      let parent = form.parentElement;
      while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
      if (parent) parent.scrollTo({ top: parent.scrollTop + form.getBoundingClientRect().top - parent.getBoundingClientRect().top - 12, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  const [drink, setDrink] = useState("");
  const [category, setCategory] = useState("beer");
  const [measure, setMeasure] = useState("pint");
  const [measureLabel, setMeasureLabel] = useState("");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [endDate, setEndDate] = useState("");
  const [conditions, setConditions] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const { signedOut } = useViewerSession();
  const { requestContribution, contributionGateDialog } = useContributionGate("deal", pintDropDoorHref(venueId));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateDealPrice({ venueId, drinkCategory: category, drink, measure, measureLabel, priceGbp: price, schedule: { days, start, end }, endDate, conditions });
    if (!result.ok) { setMessage(result.error); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await requestContribution(async (auth) => {
        setSaving(true);
        try {
          const response = await accountBoundFetch(auth, "/api/deal-prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result.value) });
          const data = await response.json();
          if (!response.ok) {
            const error = typeof data?.error === "string" ? data.error : "Could not save the deal.";
            const status = readContributionGateStatus(data?.status) ?? (response.status === 401 ? "sign_in_required" : null);
            if (status) return { status, error };
            setMessage(error);
            return;
          }
          window.dispatchEvent(new Event("pubmax:deals-changed"));
          setMessage(data.visible === false ? "Deal saved for review." : "Deal saved. Check with the pub before you order.");
        } catch {
          setMessage("Could not save the deal. Try again.");
        } finally { setSaving(false); }
      });
    } finally { inFlight.current = false; }
  }

  return (
    <form ref={formRef} className="dealComposer" onSubmit={(event) => { void submit(event); }} aria-label="Log a deal">
      <h3>Log a deal</h3>
      <p>Tell us when this price applies. Add any conditions.</p>
      {signedOut ? <div><p>Sign in before you enter the deal.</p><SignInButton next={pintDropDoorHref(venueId)} /></div> : null}
      <label>Drink<input required maxLength={100} value={drink} onChange={(e) => setDrink(e.target.value)} /></label>
      <label>Drink type<select value={category} onChange={(e) => setCategory(e.target.value)}>{DRINK_CATEGORIES.map((item) => <option key={item} value={item}>{CATEGORY_META[item].label}</option>)}</select></label>
      <label>Serving<select value={measure} onChange={(e) => setMeasure(e.target.value)}>{DRINK_MEASURES.map((item) => <option key={item} value={item}>{DRINK_MEASURE_LABEL[item]}</option>)}</select></label>
      {measure === "other" ? <label>Serving size<input required maxLength={24} value={measureLabel} onChange={(e) => setMeasureLabel(e.target.value)} /></label> : null}
      <label>Deal price (£)<input required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <fieldset><legend>Days</legend><div className="dealDays">{DAYS.map((day, index) => <label key={day}><input type="checkbox" checked={days.includes(index)} onChange={(e) => { const checked = e.target.checked; setDays((current) => checked ? [...current, index] : current.filter((value) => value !== index)); }} />{day}</label>)}</div></fieldset>
      <div className="dealTimes"><label>From<input type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></label><label>Until<input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>
      <label>Offer end date (optional)<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
      <label>Conditions (optional)<input maxLength={200} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="For example, with a meal" /></label>
      <p role="status">{message}</p>
      {contributionGateDialog}
      <div className="dealActions"><Button type="submit" variant="secondary" disabled={saving}>{saving ? "Saving…" : "Save deal"}</Button>{onClose ? <Button type="button" variant="ghost" onClick={onClose}>Back to price log</Button> : null}</div>
    </form>
  );
}
