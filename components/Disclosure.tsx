import type { ReactNode } from "react";

import styles from "./disclosure.module.css";

type DisclosureProps = {
  summary: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
};

function classNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export default function Disclosure({
  summary,
  children,
  className,
  bodyClassName,
}: DisclosureProps) {
  return (
    <details className={classNames(styles.contentDisclosure, className)}>
      <summary>{summary}</summary>
      {children ? (
        <div className={classNames("contentDisclosureBody", bodyClassName)}>
          {children}
        </div>
      ) : null}
    </details>
  );
}

export function ProseDisclosure({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <Disclosure
      className={classNames(styles.proseDisclosure, className)}
      summary={
        <>
          <span className={styles.proseDisclosureText}>{text}</span>
          <span className={styles.proseDisclosureMore}>Show more</span>
          <span className={styles.proseDisclosureLess}>Show less</span>
        </>
      }
    />
  );
}
