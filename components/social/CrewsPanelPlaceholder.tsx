import { CREW_EMPTY_COPY, CREW_WHAT_IT_IS } from "@/lib/socialCrewsCopy";

import "./crews.css";

/**
 * The compact crews card's empty shape, for the Social access-check wait.
 * It is static: no data read and no lazy download, so the wait reserves the
 * card's space without starting the crews code. `SampleSkeleton` paints it
 * out and hides it from assistive technology, so it carries no ids, and its
 * button is a shape, not a control.
 */
export default function CrewsPanelPlaceholder() {
  return (
    <section className="crews crews--compact">
      <div className="crews__head">
        <h2 className="crews__title">Your crews</h2>
        <button type="button" className="crews__button" tabIndex={-1} disabled>
          Start a crew
        </button>
      </div>
      <p className="crews__empty">{CREW_EMPTY_COPY}</p>
      <p className="crews__note">{CREW_WHAT_IT_IS}</p>
    </section>
  );
}
