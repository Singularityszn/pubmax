"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

export default function PaydaySignup({ stations, available }: { stations: string[]; available: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/payday-pint/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.get("email"), station: data.get("station"), adult: data.get("adult") === "on", consent: data.get("consent") === "on" }) });
      setMessage(response.ok ? "Check your inbox to confirm your email." : "We could not start your signup. Try again later.");
    } catch { setMessage("We could not start your signup. Try again later."); }
    finally { setBusy(false); }
  }
  return <form className="paydayForm" onSubmit={submit}>
    <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
    <label>Home station<select name="station" required defaultValue=""><option value="" disabled>Choose a station</option>{stations.map((station) => <option key={station} value={station}>{station}</option>)}</select></label>
    <label className="paydayCheck"><input name="adult" type="checkbox" required /> I am 18 or over.</label>
    <label className="paydayCheck"><input name="consent" type="checkbox" required /> Send me a weekly payday pint email about prices near my home station.</label>
    <p>You can unsubscribe from any email. We will ask you to confirm your email first. Read our <a href="/privacy">privacy notice</a>.</p>
    {!available && <p>Email signup is not available yet.</p>}
    <Button type="submit" disabled={!available || busy}>{busy ? "Sending..." : "Email me"}</Button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
