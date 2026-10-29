"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/authContext";
import { useViewerSession } from "@/components/auth/useViewerSession";
import MessageVenuePicker, { type PickedVenue } from "@/components/messages/MessageVenuePicker";
import Screen from "@/components/ui/screen";
import { Button } from "@/components/ui/button";
import { authedFetch, signedInActionFetch } from "@/lib/authedFetch";
import { proposeHostedOutingGroup } from "@/lib/hostedOutings";
import type { HostedOutingDetail, HostedOutingRead } from "@/lib/hostedOutingStore.server";
import { discardBody } from "@/lib/responseBody";
import { formatGbp } from "@/lib/formatGbp";
import "./hostedOutings.css";

const HOSTED_REQUEST_TIMEOUT_MS = 30_000;
const HOSTED_SIGN_IN_HREF = "/login?next=%2Fhosted-outings";

async function withHostedRequestDeadline<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new DOMException("The outing request timed out.", "TimeoutError")), HOSTED_REQUEST_TIMEOUT_MS);
  try { return await operation(controller.signal); }
  finally { window.clearTimeout(timer); }
}

function hostedAccessRefusalLine(status: number): string {
  return status === 401 ? "Sign in again to view hosted outings." : "Check your Social access to view hosted outings.";
}

async function readHostedResponseBody(response: Response, accessWasRefused: boolean) {
  try { return await response.json(); }
  catch (error) { if (accessWasRefused) return null; throw error; }
}

export default function HostedOutingsClient() {
  const session = useViewerSession();
  const { user } = useAuth();
  const [storedRead, setRead] = useState<HostedOutingRead | null>(null);
  const [storedSelected, setSelected] = useState<HostedOutingDetail | null>(null);
  const [dataOwner, setDataOwner] = useState<string | null>(null);
  const [accessRefusal, setAccessRefusal] = useState<401 | 403 | null>(null);
  const read = session.signedIn && dataOwner === user?.id ? storedRead : null;
  const selected = session.signedIn && dataOwner === user?.id ? storedSelected : null;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pace, setPace] = useState("easy");
  const [budget, setBudget] = useState("20");
  const [venue, setVenue] = useState<PickedVenue | null>(null);
  const [pickingVenue, setPickingVenue] = useState(false);
  const generation = useRef(0);
  const detailTitle = useRef<HTMLHeadingElement | null>(null);
  const selectedId = selected?.id;
  useEffect(() => { if (selectedId) detailTitle.current?.focus(); }, [selectedId]);

  const clearPrivateAccess = useCallback((status: number, requestGeneration: number) => {
    if (requestGeneration !== generation.current || (status !== 401 && status !== 403)) return false;
    setRead(null);
    setSelected(null);
    setDataOwner(null);
    setAccessRefusal(status);
    setBusy(false);
    setMessage(hostedAccessRefusalLine(status));
    return true;
  }, []);

  const load = useCallback(async (id?: string) => {
    const current = ++generation.current;
    let accessWasRefused = false;
    setBusy(true);
    try {
      const { response, data } = await withHostedRequestDeadline(async (signal) => {
        const response = await authedFetch(`/api/hosted-outings${id ? `/${encodeURIComponent(id)}` : ""}`, { signal }, { requiresIdentity: true });
        if (current !== generation.current) { discardBody(response); return { response, data: null }; }
        accessWasRefused = clearPrivateAccess(response.status, current);
        return { response, data: await readHostedResponseBody(response, accessWasRefused) };
      });
      if (current !== generation.current) return;
      if (!response.ok) { setMessage(typeof data?.error === "string" ? data.error : accessWasRefused ? hostedAccessRefusalLine(response.status) : "We could not load the outings. Try again."); return; }
      setAccessRefusal(null);
      setDataOwner(user?.id ?? null);
      setRead(data as HostedOutingRead);
      setSelected(id ? data.outings[0] ?? null : null);
      setMessage("");
    } catch { if (current === generation.current && !accessWasRefused) setMessage("We could not load the outings. Try again."); }
    finally { if (current === generation.current) setBusy(false); }
  }, [user?.id, clearPrivateAccess]);

  useEffect(() => {
    const current = ++generation.current;
    void Promise.resolve().then(() => {
      if (current !== generation.current) return;
      setRead(null);
      setSelected(null);
      setMessage("");
      setBusy(false);
      setAccessRefusal(null);
      setPace("easy");
      setBudget("20");
      setVenue(null);
      setPickingVenue(false);
      if (session.signedIn) void load();
    });
    return () => { generation.current += 1; };
  }, [session.signedIn, user?.id, load]);

  async function change(action: string, input: Record<string, unknown> = {}) {
    if (!selected || busy) return;
    const current = generation.current;
    let accessWasRefused = false;
    setBusy(true);
    try {
      const result = await withHostedRequestDeadline(async (signal) => {
        const response = await signedInActionFetch(`/api/hosted-outings/${selected.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, signal,
          body: JSON.stringify({ action, revision: selected.revision, ...input }),
        });
        if (!response) return null;
        if (current !== generation.current) { discardBody(response); return null; }
        accessWasRefused = clearPrivateAccess(response.status, current);
        return { response, data: await readHostedResponseBody(response, accessWasRefused) };
      });
      if (current !== generation.current) return;
      if (!result) { setMessage("Sign in again to save this change."); return; }
      const { response, data } = result;
      if (!response.ok) { setMessage(typeof data?.error === "string" ? data.error : accessWasRefused ? hostedAccessRefusalLine(response.status) : "We could not save the change. Try again."); return; }
      setAccessRefusal(null);
      setDataOwner(user?.id ?? null);
      setRead(data as HostedOutingRead);
      setSelected(data.outings[0] ?? null);
      const attendanceState = data.outings[0]?.attendance?.state;
      setMessage(action !== "join" ? "Saved."
        : attendanceState === "waiting" ? "You are on the waiting list. The host must approve your group before you confirm."
        : attendanceState === "approved" ? "Your group is approved. Confirm your place if you can attend."
        : attendanceState === "confirmed" ? "Your place is already confirmed."
        : "We could not confirm your attendance. Open All outings to check your place.");
    } catch { if (current === generation.current && !accessWasRefused) setMessage("We could not confirm the change. Open All outings to check your place before trying again."); }
    finally { if (current === generation.current) setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!venue || busy) return;
    const form = new FormData(event.currentTarget);
    const current = generation.current;
    let accessWasRefused = false;
    setBusy(true);
    try {
      const startsAt = new Date(String(form.get("startsAt")));
      if (!Number.isFinite(startsAt.getTime())) { setMessage("Choose a date and time."); return; }
      const result = await withHostedRequestDeadline(async (signal) => {
        const response = await signedInActionFetch("/api/hosted-outings", {
          method: "POST", headers: { "content-type": "application/json" }, signal, body: JSON.stringify({
            title: form.get("title"), venueId: venue.id, startsAt: startsAt.toISOString(),
            capacity: Number(form.get("capacity")), moderatorStaffId: form.get("moderator"),
          }),
        });
        if (!response) return null;
        if (current !== generation.current) { discardBody(response); return null; }
        accessWasRefused = clearPrivateAccess(response.status, current);
        return { response, data: await readHostedResponseBody(response, accessWasRefused) };
      });
      if (current !== generation.current) return;
      if (!result) { setMessage("Sign in again to save this change."); return; }
      const { response, data } = result;
      if (!response.ok) { setMessage(typeof data?.error === "string" ? data.error : accessWasRefused ? hostedAccessRefusalLine(response.status) : "We could not save the outing. Try again."); return; }
      await load(data.id);
    } catch { if (current === generation.current && !accessWasRefused) setMessage("We could not confirm the new outing. Reload this page before creating another."); }
    finally { if (current === generation.current) setBusy(false); }
  }

  const proposal = selected?.operator ? proposeHostedOutingGroup({
    candidates: selected.candidates, reservedProfileIds: selected.candidates.filter((choice) => choice.state === "approved" || choice.state === "confirmed").map((choice) => choice.profileId), blockedPairs: selected.blockedPairs, capacity: selected.capacity,
  }) : null;

  return <main id="main" className="hostedOutingsPage" aria-busy={busy || session.unresolved}>
    <Screen kicker="Meet at the pub" title="Hosted outings" lede="Small groups for adults, at a confirmed London venue. The host approves each group. You choose whether to confirm." secondary={<Link href={accessRefusal === 401 ? HOSTED_SIGN_IN_HREF : "/social"}>{accessRefusal === 401 ? "Sign in again" : accessRefusal === 403 ? "Check Social access" : "Your Social crew"}</Link>}>
      {session.unresolved ? <p role="status">Checking your sign-in.</p> : null}
      {session.signedOut ? <p><Link href={HOSTED_SIGN_IN_HREF}>Sign in</Link> to see adult outings.</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {session.signedIn && !read && accessRefusal === null ? <Button variant="secondary" disabled={busy} onClick={() => void load()}>{busy ? "Loading outings" : "Try again"}</Button> : null}
      {read && !selected ? <>
        {read.outings.length === 0 ? <p>No hosted outings are listed yet. Signups open only after the venue and hosting team are confirmed.</p> : null}
        <ul className="hostedOutingsList">{read.outings.map((outing) => <li key={outing.id}>
          <h2>{outing.title}</h2><p>{outing.venueName}</p>
          <p><time dateTime={outing.startsAt}>{new Date(outing.startsAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })}</time> · {outing.capacity} places</p>
          <p>{outing.attendance ? `Your place: ${outing.attendance.state}` : outing.status === "draft" ? "Draft" : outing.signupAllowed ? "Waiting list open" : "Signups closed"}</p>
          <Button variant="secondary" disabled={busy} onClick={() => void load(outing.id)}>View outing</Button>
        </li>)}</ul>
        {read.staff ? <details><summary>Create an outing</summary><form onSubmit={(event) => void create(event)} className="hostedOutingForm">
          <label>Outing name<input name="title" required maxLength={80} /></label>
          <div><p>Venue: {venue?.name ?? "Choose a listed London pub"}</p><Button type="button" variant="secondary" onClick={() => setPickingVenue(true)}>Choose venue</Button></div>
          {pickingVenue ? <MessageVenuePicker onPick={(picked) => { setVenue(picked); setPickingVenue(false); }} onCancel={() => setPickingVenue(false)} /> : null}
          <label>Date and time in your device timezone<input name="startsAt" type="datetime-local" required /></label>
          <label>Places<input name="capacity" type="number" min={2} max={12} defaultValue={6} required /></label>
          <label>Named moderator<select name="moderator" required defaultValue=""><option value="" disabled>Choose the moderator</option>{read.moderationOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
          <Button disabled={busy || !venue || !read.moderationOwners.length}>Save draft</Button>
        </form></details> : null}
      </> : null}
      {selected ? <section className="hostedOutingDetail" aria-label="Outing details">
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>All outings</Button>
        <h2 ref={detailTitle} tabIndex={-1}>{selected.title}</h2><p>{selected.venueName}</p>
        <p><time dateTime={selected.startsAt}>{new Date(selected.startsAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" })}</time> London time</p>
        <p>{selected.capacity} places. Moderator: {selected.moderatorName ?? "Not confirmed"}.</p>
        {selected.announcement ? <section><h3>From your host</h3><p>{selected.announcement}</p></section> : null}
        {selected.attendance ? <p>Your place: {selected.attendance.state}.</p> : null}
        {(!selected.attendance || selected.attendance.state === "cancelled") && selected.signupAllowed ? <form className="hostedOutingForm" onSubmit={(event) => { event.preventDefault(); void change("join", { pace, budgetPence: Math.round(Number(budget) * 100) }); }}>
          <label>Pace<select value={pace} onChange={(event) => setPace(event.target.value)}><option value="easy">Easy</option><option value="steady">Steady</option></select></label>
          <label>Your spending ceiling in pounds<input type="number" min={0} max={1000} step="0.01" required value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
          <p>Your pace and budget go to the host. Your contact details stay private. Joining does not confirm a place.</p>
          <Button disabled={busy}>Join waiting list</Button>
        </form> : !selected.attendance && !selected.signupAllowed ? <p>Signups are closed until the venue and hosting team are ready.</p> : null}
        {selected.groupExplanation ? <p>{selected.groupExplanation}{selected.groupBudgetPence !== null ? ` Shared spending ceiling: ${formatGbp(selected.groupBudgetPence / 100)}.` : ""}</p> : null}
        {selected.attendance?.state === "approved" ? <><p>The host approved your group. Confirm only if you can attend.</p><Button disabled={busy || !selected.confirmationAllowed} onClick={() => void change("confirm")}>Confirm my place</Button>{!selected.confirmationAllowed ? <p>Confirmation is paused until the outing is ready.</p> : null}</> : null}
        {selected.status === "open" && selected.attendance && selected.attendance.state !== "cancelled" ? <Button variant="secondary" disabled={busy} onClick={() => void change("cancel")}>Cancel my place</Button> : null}
        {selected.group.length ? <section><h3>Your confirmed group</h3><ul>{selected.group.map(({ handle }) => <li key={handle}><Link href={`/u/${encodeURIComponent(handle)}`}>@{handle}</Link></li>)}</ul><p>You can choose to connect through each person&apos;s profile. An outing never creates a connection for you.</p></section> : null}
        {selected.attendance ? <form className="hostedOutingForm" onSubmit={(event) => { event.preventDefault(); void change("report", { body: new FormData(event.currentTarget).get("report") }); }}>
          <label>Report a problem<textarea name="report" maxLength={2000} required defaultValue={selected.ownReport?.body ?? ""} /></label>
          <p>{selected.moderatorActive ? "Your named moderator can read this report. Other attendees cannot read it." : "No moderator is available for this outing. We can save your report for review."}</p><Button variant="secondary" disabled={busy}>{selected.moderatorActive ? "Send report to moderator" : "Save report for review"}</Button>
        </form> : null}
        {selected.status === "completed" && selected.attendance?.state === "confirmed" ? <form className="hostedOutingForm" onSubmit={(event) => { event.preventDefault(); void change("feedback", { rating: Number(new FormData(event.currentTarget).get("rating")) }); }}>
          <label>How was the outing?<select name="rating" defaultValue={selected.feedback ?? 5}>{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} out of 5</option>)}</select></label><Button variant="secondary" disabled={busy}>Save feedback</Button>
        </form> : null}
        {selected.operator ? <section><h3>Host controls</h3>
          {selected.feedbackSummary?.count ? <p>{selected.feedbackSummary.count} feedback responses. Average rating: {selected.feedbackSummary.average} out of 5.</p> : null}
          {selected.status === "draft" || (selected.status === "open" && !selected.enrollmentEnabled) ? <form className="hostedOutingForm" onSubmit={(event) => { event.preventDefault(); void change("publish", { confirmation: new FormData(event.currentTarget).get("confirmation") }); }}><label>Venue confirmation reference<input name="confirmation" required maxLength={500} /></label><p>The reference stays with the hosting team. Signups stay closed until the hosting team opens enrollment.</p><Button variant="secondary" disabled={busy}>{selected.status === "draft" ? "Confirm venue and publish" : "Confirm venue and open waiting list"}</Button></form> : null}
          {proposal ? <><p>{proposal.explanation}</p><p>{proposal.profileIds.length} proposed places{proposal.budgetPence !== null ? `, shared spending ceiling ${formatGbp(proposal.budgetPence / 100)}` : ""}.</p><Button variant="secondary" disabled={busy || proposal.profileIds.length < 2 || selected.status !== "open" || !selected.moderatorActive || !selected.venueConfirmed} onClick={() => void change("approve", { profileIds: proposal.profileIds })}>Approve proposed group</Button></> : null}
          <ul>{selected.candidates.map((candidate) => <li key={candidate.profileId}><Link href={`/u/${encodeURIComponent(candidate.handle)}`}>@{candidate.handle}</Link> {proposal?.profileIds.includes(candidate.profileId) ? "Proposed group, " : ""}{candidate.state}, {candidate.pace}, {formatGbp(candidate.budgetPence / 100)} ceiling <Button variant="ghost" disabled={busy} onClick={() => void change("remove", { profileId: candidate.profileId })}>Remove signup</Button></li>)}</ul>
          <form className="hostedOutingForm" onSubmit={(event) => { event.preventDefault(); void change("announce", { body: new FormData(event.currentTarget).get("announcement") }); }}><label>Message to attendees<textarea name="announcement" required maxLength={2000} defaultValue={selected.announcement} /></label><Button variant="secondary" disabled={busy}>Save host message</Button></form>
          {selected.status === "open" ? <><Button variant="secondary" disabled={busy || Date.parse(selected.startsAt) > Date.now()} onClick={() => void change("complete")}>Mark outing complete</Button><Button variant="danger" disabled={busy} onClick={() => void change("cancel_outing")}>Cancel outing</Button></> : null}
        </section> : null}
        {selected.moderator ? <section><h3>Reports for you</h3>{selected.reports.length ? selected.reports.map((report) => <article key={report.profileId}><p>{report.body}</p><p>{report.status}</p><Button variant="secondary" disabled={busy || report.status === "reviewed"} onClick={() => void change("review_report", { profileId: report.profileId })}>Mark reviewed</Button></article>) : <p>No reports for this outing.</p>}</section> : null}
      </section> : null}
    </Screen>
  </main>;
}
