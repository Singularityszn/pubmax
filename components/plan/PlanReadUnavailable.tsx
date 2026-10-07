import SiteNav from "@/components/nav/SiteNav";
import EmptyState from "@/components/ui/empty-state";

/**
 * A read we could not RUN, on every surface under /plan/[id] and on the public
 * recap at app/recap/[storyId]/page.tsx. The recap passes its own title, which
 * reaches the EmptyState heading and nothing else, so the masthead below still
 * says Plan there and the body copy is the same copy. That reuse is deliberate
 * and ruled, not an oversight: one surface words a read we could not run once.
 *
 * It is not the not-found surface: that one says the link expired and sends the
 * reader off to start their own night, which over a live plan is the wrong
 * sentence and the wrong door. `planStore().read` answers `absent` and
 * `unavailable` apart precisely so those two are worded apart, and every entry
 * point - the plan page, the plan recap page and their metadata, plus the
 * public recap page - shares this one surface rather than each deciding again.
 *
 * IT CLAIMS NOTHING ABOUT THE PLAN. The first cut opened "The plan is still
 * there", which is a fact about a plan the store had just failed to read, one
 * clause before the sentence saying we could not read it. A read we could not
 * run tells us nothing in EITHER direction, so this surface names only what we
 * know: the failure was ours, and the answer is unknown.
 *
 * Its one way onward is the SAME address, as a plain anchor, so the reader gets
 * a fresh document and a fresh server read rather than the held payload a soft
 * navigation would serve back.
 */
export default function PlanReadUnavailable({
  href,
  title = "We could not load this plan",
}: {
  /** The address to retry: the reader's own, so the recap returns to the recap. */
  href: string;
  title?: string;
}): React.JSX.Element {
  return (
    <main id="main" className="planPage planPage--composer pageHidesCreateFab">
      <SiteNav />
      <header className="planPage__masthead">
        <span>Plan</span>
        <span>London · Tonight</span>
      </header>

      <EmptyState title={title} action={<a href={href}>Try again</a>}>
        Our server could not answer just now, so this page can&apos;t show your
        night. We couldn&apos;t check whether the plan still exists either.
      </EmptyState>
    </main>
  );
}
