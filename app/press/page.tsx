import type { Metadata, Route } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import Kicker from "@/components/ui/kicker";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { citableFindings, citableSample, citationLine } from "@/lib/citableFindings";
import { formatPintIndexDate, type PintIndexSnapshot } from "@/lib/pintIndex";
import { pintIndexMeetsAdmissionFloor, pintIndexMonthLabel } from "@/lib/pintIndexArchive";
import { loadPintIndexArchive, loadPublicPintIndexSnapshotOrThrow } from "@/lib/pintIndexSnapshot.server";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";

import "../legal.css";
import "./press.css";

// /press - the page a writer, a researcher or an answer engine is sent to.
//
// BACKLINK PLAYBOOK (docs/growth/BACKLINK_PLAYBOOK.md). One page carries the
// tactics that need a URL: findings written as whole sentences (13 to 19),
// what a journalist can ask us for (20 to 27), and the chart with its embed
// code and credit line (50 to 55). It has no figure of its own. Every number
// is read from a Pint Index snapshot through lib/citableFindings.ts, and a
// snapshot below the admission floor gives the honest empty state instead.
//
// THE CITED SOURCE IS THE FROZEN ONE. A dated edition never changes after it
// goes up, so a writer's link still says what it said on the day they quoted
// it (tactic 18). The live Index is used only when no edition clears the floor.

const SITE_URL = "https://pubmaxxing.com";
const PAGE_TITLE = "Press and citations";
const PAGE_DESCRIPTION =
  "London pint price findings you can quote, with the sample, the method, a stable link and a credit line.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/press" },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/press`,
    siteName: metadataSiteName(),
    type: "website",
  },
};

type CitedSource = {
  snapshot: PintIndexSnapshot;
  title: string;
  path: Route;
  csvPath: string;
  imagePath: string;
  publishedLabel: string;
};

async function citedSource(): Promise<CitedSource | null> {
  const [editions, live] = await Promise.all([
    loadPintIndexArchive(),
    loadPublicPintIndexSnapshotOrThrow(),
  ]);
  const edition = editions.find((entry) => pintIndexMeetsAdmissionFloor(entry));
  if (edition) {
    const month = edition.archive.month;
    return {
      snapshot: edition,
      title: `London Pint Index, ${pintIndexMonthLabel(month)}`,
      path: `/pint-index/${month}` as Route,
      csvPath: `/pint-index/${month}/data.csv`,
      imagePath: `/pint-index/${month}/opengraph-image`,
      publishedLabel: formatPintIndexDate(edition.archive.publishedAt),
    };
  }
  if (pintIndexMeetsAdmissionFloor(live)) {
    return {
      snapshot: live,
      title: "London Pint Index",
      path: "/pint-index",
      csvPath: "/pint-index/data.csv",
      imagePath: "/pint-index/opengraph-image",
      publishedLabel: formatPintIndexDate(live.generatedAt),
    };
  }
  return null;
}

function embedCode(source: CitedSource): string {
  const url = `${SITE_URL}${source.path}`;
  return [
    `<a href="${url}">`,
    `  <img src="${SITE_URL}${source.imagePath}" alt="${source.title} chart by PUBMAXX" width="1200" height="630" loading="lazy">`,
    `</a>`,
    `<p>${citationLine(source.title, `<a href="${url}">${url}</a>`, source.publishedLabel)}</p>`,
  ].join("\n");
}

export default async function PressPage() {
  const source = await citedSource();
  const findings = source ? citableFindings(source.snapshot) : [];
  const sample = source ? citableSample(source.snapshot) : null;
  const sourceUrl = source ? `${SITE_URL}${source.path}` : null;

  return (
    <>
    <SiteNav />
    <main id="main" className="legalPage">
      <header className="legalHead">
        <Kicker>Press</Kicker>
        <h1 className="legalTitle">Press and citations</h1>
        <p className="legalLede">
          Every figure here comes from the London Pint Index. Each one has a
          source, a date and a link you can check.
        </p>
      </header>

      <section className="legalSection" aria-labelledby="findings">
        <h2 id="findings" className="legalH2">Findings you can quote</h2>
        {source && findings.length > 0 && sourceUrl ? (
          <>
            <ul className="legalPanelList pressFindings">
              {findings.map((finding) => (
                <li key={finding.id} id={`finding-${finding.id}`} data-finding={finding.id}>
                  <blockquote className="pressQuote" cite={sourceUrl}>
                    <p>{finding.sentence}</p>
                  </blockquote>
                </li>
              ))}
            </ul>
            <p className="legalBody">
              Credit line:{" "}
              <span className="pressCredit">{citationLine(source.title, sourceUrl, source.publishedLabel)}</span>
            </p>
          </>
        ) : (
          <p className="legalBody" data-findings-empty>
            We have no findings to quote yet. A month enters the Index when at
            least one borough has enough confirmed pint prices. Until then,{" "}
            <Link href="/pint-index" className="legalLink">the Pint Index</Link>{" "}
            shows how many prices we have and what still stays out.
          </p>
        )}
      </section>

      {sample && source ? (
        <section className="legalSection" aria-labelledby="sample">
          <h2 id="sample" className="legalH2">Sample and method</h2>
          <dl className="legalRows">
            <div className="legalRow"><dt>Pubs</dt><dd>{sample.pubCount}</dd></div>
            <div className="legalRow"><dt>Boroughs</dt><dd>{sample.boroughCount}</dd></div>
            <div className="legalRow"><dt>Prices</dt><dd>{sample.observationCount}</dd></div>
            <div className="legalRow"><dt>Named sources</dt><dd>{sample.sourceCount}</dd></div>
            <div className="legalRow"><dt>Prices seen</dt><dd>{sample.windowLabel}</dd></div>
          </dl>
          <p className="legalBody">
            Each pub counts once, at its latest eligible price. We place a pub in
            a borough from its map position. A pub outside every London borough
            boundary is left out. No estimate enters the Index. The full method
            is on <Link href={source.path} className="legalLink">the edition page</Link>, and{" "}
            <Link href="/how-we-estimate" className="legalLink">how we estimate</Link>{" "}
            explains why the map can show prices that the Index does not.
          </p>
        </section>
      ) : null}

      <section className="legalSection" aria-labelledby="links">
        <h2 id="links" className="legalH2">Links that stay put</h2>
        <ul className="legalPanelList">
          <li>
            <Link href="/pint-index" className="legalLink">/pint-index</Link>{" "}
            is the live Index. It changes when new prices arrive.
          </li>
          <li>
            <strong>/pint-index/YYYY-MM</strong>{" "}is one closed month. It does
            not change after it goes up, so link to it when you quote a figure.
            A correction gets a new revision number on the same page.
          </li>
          <li>
            <strong>data.csv</strong>{" "}beside each page is the same data as a
            spreadsheet{source ? (
              <>
                {", for example "}
                <a href={source.csvPath} className="legalLink" download>{source.csvPath}</a>
              </>
            ) : null}.
          </li>
          <li>
            <Link href="/historic" className="legalLink">/historic</Link>{" "}
            lists historic London pubs. Each fact links to its source.
          </li>
          <li>
            <Link href="/pub-crawl-cost" className="legalLink">/pub-crawl-cost</Link>{" "}
            is a free calculator for the cost of a crawl and who pays for each round.
          </li>
        </ul>
      </section>

      {source && findings.length > 0 ? (
        <section className="legalSection" aria-labelledby="embed">
          <h2 id="embed" className="legalH2">Use the chart</h2>
          <p className="legalBody">
            You can put this chart in your article at no cost. The code below
            shows the image, links it to the source and adds the credit line.
          </p>
          <pre className="pressCode" tabIndex={0} aria-label="Embed code for the chart"><code>{embedCode(source)}</code></pre>
        </section>
      ) : null}

      <section className="legalSection" aria-labelledby="ask">
        <h2 id="ask" className="legalH2">Ask us for a figure</h2>
        <p className="legalBody">
          Tell us your question and your deadline. If the Index has the answer,
          we send the figure, the sample behind it and the link to check it. If
          it does not, we tell you that, and we do not guess.
        </p>
        <p className="legalBody">
          You can quote any finding on this page. Link to the page you took it
          from.
        </p>
      </section>

      <section className="legalSection legalContact" aria-labelledby="contact">
        <h2 id="contact" className="legalH2">Contact</h2>
        <p className="legalBody">
          <a href={CONTACT_MAILTO} className="legalLink legalContactEmail">{CONTACT_EMAIL}</a>
        </p>
      </section>
    </main>
    </>
  );
}
