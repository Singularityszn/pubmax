"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import ContributionGateDoor from "@/components/identity/ContributionGateDoor";
import { Button } from "@/components/ui/button";
import { authedActionFetch, compositeActionSignal } from "@/lib/authedFetch";
import { providerOwnsSession, readProviderAccountSignal } from "@/lib/authProviderRevision";
import { readContributionDoor, type ContributionDoorStatus } from "@/lib/contributionGateStatus";
import { getNightAreasForCity } from "@/lib/nightAreas";
import { isNativeApp } from "@/lib/nativePlatform";
import { registerWebPush, webPushSupport } from "@/lib/webPush";

const AREAS = getNightAreasForCity("london");

export default function PriceAlertPref(): React.JSX.Element | null {
  const { user } = useAuth();
  return user ? <AccountPriceAlert key={user.id} userId={user.id} /> : null;
}

function AccountPriceAlert({ userId }: { userId: string }): React.JSX.Element {
  const [area, setArea] = useState("");
  const [price, setPrice] = useState("5.00");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [gate, setGate] = useState<ContributionDoorStatus | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const scope = new AbortController();
    void authedActionFetch("/api/price-alert", { signal: scope.signal }, { requiresIdentity: true })
      .then(async (response) => {
        const body = await response.json() as Record<string, unknown>;
        if (scope.signal.aborted) return;
        const door = readContributionDoor(body);
        if (door) setGate(door);
        else if (!response.ok) setNotice("Could not load your price alert. Try again.");
        else if (body.enabled === true && typeof body.area === "string" && typeof body.thresholdPence === "number") {
          setArea(body.area);
          setPrice((body.thresholdPence / 100).toFixed(2));
          setEnabled(true);
        }
      })
      .catch(() => { if (!scope.signal.aborted) setNotice("Could not load your price alert. Try again."); })
      .finally(() => { if (!scope.signal.aborted) setLoading(false); });
    return () => { scope.abort(); controller.current?.abort(); };
  }, []);

  async function save(turnOff = false): Promise<void> {
    if (busy) return;
    const pounds = Number(price);
    const pence = Math.round(pounds * 100);
    if (!turnOff && (!area || !Number.isFinite(pounds) || pence < 1 || pence > 100000 || Math.abs(pounds * 100 - pence) > 0.00001)) {
      setNotice("Choose an area and enter a price with up to two decimal places.");
      return;
    }
    setBusy(true);
    setNotice("");
    const scope = new AbortController();
    controller.current = scope;
    const signal = compositeActionSignal([scope.signal, readProviderAccountSignal()]);
    const ownsSession = () => !signal.aborted && providerOwnsSession("supabase", userId);
    try {
      if (!ownsSession()) return;
      let body: object = { enabled: false };
      if (!turnOff) {
        if (isNativeApp()) {
          setNotice("Price alerts are available on the web. On iPhone, add PUBMAXX to your Home Screen.");
          return;
        }
        if (webPushSupport() !== "supported") {
          setNotice("Price alerts need web notifications. Check your browser and notification settings.");
          return;
        }
        const token = await registerWebPush(signal, undefined, async () => true);
        if (!ownsSession()) return;
        if (!token) {
          setNotice("Could not enable notifications. Check this browser's notification settings.");
          return;
        }
        body = { area, thresholdPence: pence, token };
      }
      const response = await authedActionFetch("/api/price-alert", { method: "POST", body: JSON.stringify(body), signal }, { requiresIdentity: true });
      const result = await response.json() as Record<string, unknown>;
      if (!ownsSession()) return;
      if (!response.ok) {
        const door = readContributionDoor(result);
        if (door) setGate(door);
        else setNotice("Could not save your price alert. Try again.");
        return;
      }
      setEnabled(!turnOff);
      setNotice(turnOff ? "Price alert off." : "Price alert on for this device.");
    } catch {
      if (ownsSession()) setNotice("Could not save your price alert. Try again.");
    } finally {
      if (!scope.signal.aborted) setBusy(false);
      if (controller.current === scope) controller.current = null;
    }
  }

  return (
    <div>
      <h3>Price alert</h3>
      <p>Get a notification when a new Pint Drop reports a pint below your price within an estimated 10 minute walk of the area centre. We store the area, not your location.</p>
      {gate ? <ContributionGateDoor status={gate} subject="turn on a price alert" onAsserted={() => setGate(null)} /> : (
        <div className="accountHubNightProfileGrid">
          <label>Area<select value={area} onChange={(event) => setArea(event.target.value)} disabled={loading || busy}><option value="">Choose an area</option>{AREAS.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
          <label>Price below (£)<input type="number" min="0.01" max="1000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} disabled={loading || busy} /></label>
          <div className="accountHubActions"><Button variant="secondary" type="button" onClick={() => void save()} disabled={loading || busy}>{enabled ? "Update alert" : "Turn alert on"}</Button>{enabled ? <Button variant="ghost" type="button" onClick={() => void save(true)} disabled={busy}>Turn off</Button> : null}</div>
        </div>
      )}
      <p role="status">{notice || (enabled ? "Price alert on." : "Price alert off.")}</p>
    </div>
  );
}
