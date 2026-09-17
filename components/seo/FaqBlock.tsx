import type { ReactElement } from "react";

import type { FaqItem } from "@/lib/pintFacts";

import styles from "./factLayer.module.css";

// Server-rendered FAQ block (Wave S3.2): a visible, no-JS <details>/<summary>
// list of data-answerable questions. Renders NOTHING when there are no items
// (a borough with no priced data yields no questions). The matching FAQPage
// JSON-LD is emitted by the page via components/seo/JsonLd from the SAME items,
// so the visible answers and the structured data never diverge.

export default function FaqBlock({
  items,
  headingId,
  title,
}: {
  items: FaqItem[];
  headingId: string;
  title: string;
}): ReactElement | null {
  if (items.length === 0) return null;

  return (
    <section className={styles.faqBlock} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.faqBlockTitle}>
        {title}
      </h2>
      <ul className={styles.faqList}>
        {items.map((item) => (
          <li key={item.question} className={styles.faqItem}>
            <details>
              <summary>{item.question}</summary>
              <p className={styles.faqAnswer}>{item.answer}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
