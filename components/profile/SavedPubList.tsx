"use client";

import { LIST_TYPES, type ListType, type SavedPub } from "@/lib/savedPubs";

// Presentational saved-pub lists, grouped by list type. Prop-driven: the page
// reads localStorage and passes the grouped map. Renders nothing heavy — just
// the venue id (the demo has no venue-name lookup here) + optional note, filed
// under each list heading. Lists with no pubs are skipped; a fully-empty state
// shows a friendly hint.
type SavedPubListProps = {
  groups: Partial<Record<ListType, SavedPub[]>>;
};

export default function SavedPubList({ groups }: SavedPubListProps) {
  // Render in the canonical LIST_TYPES order, showing only non-empty lists.
  const populated = LIST_TYPES.filter((t) => (groups[t]?.length ?? 0) > 0);

  if (populated.length === 0) {
    return (
      <section className="savedSection" aria-labelledby="savedHeading">
        <h2 id="savedHeading" className="savedHeading">
          Saved pubs
        </h2>
        <p className="savedEmpty">No saved pubs yet — save one from the map to start a list.</p>
      </section>
    );
  }

  return (
    <section className="savedSection" aria-labelledby="savedHeading">
      <h2 id="savedHeading" className="savedHeading">
        Saved pubs
      </h2>
      <div className="savedLists">
        {populated.map((listType) => {
          const pubs = groups[listType] ?? [];
          return (
            <div className="savedList" key={listType}>
              <h3 className="savedListName">
                {listType}
                <span className="savedListCount" aria-hidden="true">
                  {" "}
                  · {pubs.length}
                </span>
              </h3>
              <ul className="savedListItems">
                {pubs.map((pub) => (
                  <li className="savedItem" key={`${pub.venueId}:${listType}`}>
                    <span className="savedItemVenue">{pub.venueId}</span>
                    {pub.note ? <span className="savedItemNote">{pub.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
