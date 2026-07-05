"use client";

import Link from "next/link";

import { LIST_TYPES, type ListType, type SavedPubDTO } from "@/lib/savedPubs";

// Presentational saved-pub lists, grouped by list type. Prop-driven: the page
// resolves saves (durable API when a handle exists, else localStorage) into
// SavedPubDTO groups and passes the grouped map. Each item renders the resolved
// pub NAME (never a raw "venue-…" id) linking to the pub on the map, filed under
// each list heading. Lists with no pubs are skipped; a fully-empty state shows a
// friendly hint.
type SavedPubListProps = {
  groups: Partial<Record<ListType, SavedPubDTO[]>>;
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
                    <Link className="savedItemVenue" href={pub.venueMapUrl}>
                      {pub.venueName}
                    </Link>
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
