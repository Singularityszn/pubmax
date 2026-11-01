"use client";

import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";

import { isPlanActiveNow, msUntilActivePlanEdge, readActivePlan, subscribeActivePlan } from "@/lib/activePlan";
import {
  msUntilPalNightBoundary,
  PAL_NIGHT_ANSWER_STORAGE_KEY,
  PAL_NIGHT_CHOICES,
  PAL_NIGHT_QUESTION,
  palNightInviteText,
  palNightQuestionOpen,
  readPalNightAnswer,
  writePalNightAnswer,
  type PalNightChoice,
} from "@/lib/palNightQuestion";
import { planInviteShareUrl } from "@/lib/planCrewInviteUrl";
import { ensurePlanInviteToken } from "@/lib/planInviteTokenClient";
import { planPalRouteHandoffHref } from "@/lib/planOccasion";
import { safeLocalStorage } from "@/lib/safeStorage";
import { shareNightObject } from "@/lib/shareSheet";
import "./palNightQuestion.css";

// The Pal's evening question on /pal (lib/palNightQuestion.ts). Each answer is
// a link straight into a plan of that shape, and the Pal remembers it for the
// rest of the evening so it never asks twice. An asleep (muted) Pal asks
// nothing, and nothing is asked in the small hours. A page left open checks
// again at noon and at midnight, and when another tab answers.

type Asked = { open: boolean; answer: PalNightChoice | null };

// ONE LINK (lib/planCrewInviteUrl.ts): the crew link is the public invite
// page, `/invite/{token}`, with a host because it leaves the site, the same
// link every host share surface sends. Null when the token is not a classic
// one, so the Pal never shares a bare plan id.
function crewInviteUrl(token: string | null): string | null {
  try {
    return planInviteShareUrl(token, window.location.href);
  } catch {
    return null;
  }
}

// The crew link is unknown ("loading") until the invite-token read lands, so a
// quick tap never takes the plan-page fallback that a token would have beaten.
type Crew = { planId: string; invite: "loading" | "none" | { url: string } };
type Sent = "idle" | "sent" | "whatsapp" | "failed";

// setTimeout holds at most this many milliseconds; a plan further off than
// that is simply re-checked when this timer runs out.
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/**
 * Tonight's saved plan with a seat on it, and its crew link once read. A page
 * left open checks again when the plan's active window opens or closes, so
 * yesterday's plan is never offered at the next noon.
 */
function useTonightsCrew(): Crew | null {
  const [crew, setCrew] = useState<Crew | null>(null);
  useEffect(() => {
    let active = true;
    let timer = 0;
    // Each read is a new generation, so a token read still out when the
    // window closes (or the plan changes) can never put the old plan back.
    let generation = 0;
    const read = () => {
      if (!active) return;
      const mine = ++generation;
      const now = Date.now();
      const ref = readActivePlan();
      window.clearTimeout(timer);
      const edge = msUntilActivePlanEdge(ref, now);
      // A second past the edge, so the clock has crossed it.
      if (edge !== null) timer = window.setTimeout(read, Math.min(edge + 1000, LONGEST_TIMER_MS));
      const planId = ref && (ref.role === "host" || ref.role === "guest") && isPlanActiveNow(ref, now) ? ref.id : null;
      setCrew(planId ? { planId, invite: "loading" } : null);
      if (!planId) return;
      void ensurePlanInviteToken(planId).then(
        (token) => {
          if (!active || mine !== generation) return;
          const url = crewInviteUrl(token);
          setCrew({ planId, invite: url ? { url } : "none" });
        },
        () => {
          if (active && mine === generation) setCrew({ planId, invite: "none" });
        },
      );
    };
    queueMicrotask(read);
    const unsubscribe = subscribeActivePlan(read);
    return () => {
      active = false;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);
  return crew;
}

/**
 * "Who's coming?": once tonight's plan is saved and on, the Pal hands the
 * person its real crew link (`/invite/{token}`), so mates join the same
 * night. The invite token is read while the card is on screen, so the tap goes
 * straight to the share sheet. Without a token it opens the plan's own invite
 * tools, and it never shares a bare `/plan/{id}`, which cannot join.
 */
function PalNightCrew({ crew, palName }: { crew: Crew; palName: string }) {
  const [sent, setSent] = useState<Sent>("idle");

  const invitePage = `/plan/${crew.planId}#share` as Route;
  if (crew.invite === "loading") {
    return (
      <button type="button" className="palNightQuestionOpen" disabled aria-busy="true">
        Who&apos;s coming?
      </button>
    );
  }
  if (crew.invite === "none") {
    return (
      <Link className="palNightQuestionOpen" href={invitePage}>
        Who&apos;s coming?
      </Link>
    );
  }
  const inviteUrl = crew.invite.url;
  const share = async () => {
    const outcome = await shareNightObject({ title: "Tonight", text: palNightInviteText(palName), url: inviteUrl });
    // A WhatsApp fallback only opens a draft, so it is ready to send, not sent.
    setSent(outcome === "failed" ? "failed" : outcome === "cancelled" ? "idle" : outcome === "whatsapp" ? "whatsapp" : "sent");
  };
  return (
    <>
      <button type="button" className="palNightQuestionOpen" onClick={() => void share()}>
        Who&apos;s coming?
      </button>
      {sent === "sent" ? <p className="palNightQuestionNote" role="status">Sent. Now they tap Going.</p> : null}
      {sent === "whatsapp" ? <p className="palNightQuestionNote" role="status">Ready in WhatsApp. Send it, then they tap Going.</p> : null}
      {sent === "failed" ? (
        <p className="palNightQuestionNote" role="status">
          That didn&apos;t send. <Link href={invitePage}>Send it from the plan</Link>
        </p>
      ) : null}
    </>
  );
}

export default function PalNightQuestion({ muted, palName }: { muted: boolean; palName: string }) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const crew = useTonightsCrew();

  useEffect(() => {
    let active = true;
    let timer = 0;
    const read = () => {
      if (!active) return;
      const now = new Date();
      setAsked({ open: palNightQuestionOpen(now), answer: readPalNightAnswer(safeLocalStorage(), now) });
      window.clearTimeout(timer);
      // A second past the boundary, so the clock has crossed it.
      timer = window.setTimeout(read, msUntilPalNightBoundary(now) + 1000);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PAL_NIGHT_ANSWER_STORAGE_KEY) read();
    };
    queueMicrotask(read);
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (muted || !asked?.open) return null;

  const choose = (choice: PalNightChoice) => {
    writePalNightAnswer(safeLocalStorage(), choice.id, new Date());
    setAsked({ open: true, answer: choice });
  };
  const changeMind = () => {
    writePalNightAnswer(safeLocalStorage(), null, new Date());
    setAsked({ open: true, answer: null });
  };

  if (asked.answer) {
    return (
      <section className="palNightQuestion" aria-label="Tonight" data-testid="pal-night-question">
        <p className="palNightQuestionLine" role="status">{asked.answer.reply}</p>
        <div className="palNightQuestionActions">
          {/* Once tonight's plan is saved, the door goes to it, never to a fresh one. */}
          <Link
            className="palNightQuestionOpen"
            href={crew ? (`/plan/${crew.planId}` as Route) : planPalRouteHandoffHref(asked.answer.plan)}
          >
            Open the plan
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          {crew ? <PalNightCrew key={crew.planId} crew={crew} palName={palName} /> : null}
          <button type="button" className="palNightQuestionChange" onClick={changeMind}>
            Change my mind
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="palNightQuestion" aria-labelledby="pal-night-question-title" data-testid="pal-night-question">
      <p id="pal-night-question-title" className="palNightQuestionLine">{PAL_NIGHT_QUESTION}</p>
      <ul className="palChoiceList palNightQuestionChoices">
        {PAL_NIGHT_CHOICES.map((choice) => (
          <li key={choice.id}>
            <Link className="palChoice" href={planPalRouteHandoffHref(choice.plan)} onClick={() => choose(choice)}>
              <span>{choice.label}</span>
              <small>{choice.hint}</small>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
