import type { ReactElement, ReactNode } from "react";

import Kicker from "./kicker";
import "./screen.css";

/**
 * The head of a launch screen: kicker, heading, one primary action.
 *
 * Monzo and Revolut are the reference for clarity, not for look. Every screen
 * they open answers "what is this" and "what do I do" in one glance, because
 * exactly one control is filled. This primitive makes that structural: the
 * caller hands over ONE primary and the Screen paints it. Nothing else on the
 * page may wear the filled coral, and __tests__/coreUiAudit.test.ts counts
 * `[data-primary-action]` per route to hold it.
 *
 * Order is fixed and is the same at every width: kicker, heading, lede, then
 * the actions. A phone reads it top to bottom; a desktop reads it the same
 * way, wider. There is no second column and no side art in the head.
 *
 * The quiet row beside it holds at most two doors; `secondary` says why.
 *
 * The lede is optional and usually absent. Add one only where it prevents a
 * misunderstanding, never to repeat the heading.
 *
 * `actionsAfterContent` moves that row to the end of the screen. A screen whose
 * own content IS the answer must not make a phone read two doors before the
 * thing they lead away from: on /tonight the head, the credits and the
 * refinement chips put the first listing 868px down a 788px reading area at
 * 390x844, so a reader met no listing at all. It is a DOM move and not a CSS
 * `order`, so the reading order, the tab order and the paint order stay one
 * order at every width. Reach for it only where the content is the answer, and
 * never to seat a second primary.
 */
export default function Screen({
  kicker,
  title,
  lede,
  answer,
  primary,
  secondary,
  actionsAfterContent = false,
  children,
  as: Tag = "section",
  headingLevel = 1,
  id,
  titleId,
  className,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  /** One line under the heading, or nothing. */
  lede?: ReactNode;
  /**
   * Content that must precede the actions in reading and tab order at every
   * width. The caller chooses the content; landing hero policy lives in
   * docs/rules/components-design-system-and-launch-primitives.md.
   */
  answer?: ReactNode;
  /**
   * Exactly one link or button. The Screen paints it as the filled primary.
   * A FORM screen passes none: its one painted control is the form's own
   * submit, next to the field it submits (captain's ruling, 7 Sep 2026, over
   * /login and /pal/chat, which painted a head door above the field and the
   * form's submit under it, two doors for one action).
   */
  primary?: ReactElement;
  /**
   * The quiet row under the primary: at most TWO ways onward, and a second one
   * only where the screen would otherwise hide a real destination.
   *
   * It was one door until #1488. On a phone the landing's first screen ends at
   * the consent bar, about 25px under this row, so a second door given a row of
   * its own is a door nobody sees, and the fixed landing bar has 39px of free
   * width at 390px. Sharing this row is the only place above the fold left.
   * `.screenSecondary` styles its children through a direct-child selector, so
   * both doors read alike; every other screen still passes one.
   */
  secondary?: ReactElement;
  /**
   * Render the way-onward row after `children` instead of inside the head.
   * Default false, so every other screen keeps the head it has.
   */
  actionsAfterContent?: boolean;
  children?: ReactNode;
  as?: "section" | "main" | "div";
  /** 1 for a route's own head; 2 when the Screen is a section inside a page. */
  headingLevel?: 1 | 2;
  id?: string;
  titleId?: string;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  const classes = ["screen", className].filter(Boolean).join(" ");
  // One definition of the row, so the two placements cannot drift apart and
  // the screen still paints exactly one primary either way.
  const actions = (
    <div
      className={
        actionsAfterContent
          ? "screenActions screenActionsAfterContent"
          : "screenActions"
      }
    >
      {primary ? (
        <div className="screenPrimary" data-primary-action="">
          {primary}
        </div>
      ) : null}
      {secondary ? <div className="screenSecondary">{secondary}</div> : null}
    </div>
  );
  return (
    <Tag className={classes} id={id} aria-labelledby={titleId}>
      <header className="screenHead">
        {kicker ? <Kicker>{kicker}</Kicker> : null}
        <Heading className="screenTitle" id={titleId}>
          {title}
        </Heading>
        {lede ? <p className="screenLede">{lede}</p> : null}
        {answer ? <div className="screenAnswer">{answer}</div> : null}
        {actionsAfterContent ? null : actions}
      </header>
      {children}
      {actionsAfterContent ? actions : null}
    </Tag>
  );
}
