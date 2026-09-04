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
 * The lede is optional and usually absent. Add one only where it prevents a
 * misunderstanding, never to repeat the heading.
 */
export default function Screen({
  kicker,
  title,
  lede,
  answer,
  primary,
  secondary,
  children,
  as: Tag = "section",
  headingLevel = 1,
  id,
  titleId,
  className,
}: {
  kicker: ReactNode;
  title: ReactNode;
  /** One line under the heading, or nothing. */
  lede?: ReactNode;
  /**
   * The answer the actions act on, between the heading and the actions, so a
   * phone reads the pub before it reads "Still £6.50?". Hero prototype #1357.
   */
  answer?: ReactNode;
  /** Exactly one link or button. The Screen paints it as the filled primary. */
  primary: ReactElement;
  /** At most one quieter way onward. */
  secondary?: ReactElement;
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
  return (
    <Tag className={classes} id={id} aria-labelledby={titleId}>
      <header className="screenHead">
        <Kicker>{kicker}</Kicker>
        <Heading className="screenTitle" id={titleId}>
          {title}
        </Heading>
        {lede ? <p className="screenLede">{lede}</p> : null}
        {answer ? <div className="screenAnswer">{answer}</div> : null}
        <div className="screenActions">
          <div className="screenPrimary" data-primary-action="">
            {primary}
          </div>
          {secondary ? <div className="screenSecondary">{secondary}</div> : null}
        </div>
      </header>
      {children}
    </Tag>
  );
}
