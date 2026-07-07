import SiteNav from "@/components/nav/SiteNav";
import SavedListDetail from "@/components/profile/SavedListDetail";
import { normalizeHandle } from "@/lib/profiles";
import {
  cleanListType,
  savedListFollowsStore,
  savedPubsStore,
  type SavedListFollowCounts,
  type SavedPubDTO,
} from "@/lib/savedPubsStore";

import "../../profile.css";

export const dynamic = "force-dynamic";

type PageParams = {
  handle: string;
  listType: string;
};

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function SavedListPage({ params }: { params: Promise<PageParams> }) {
  const { handle, listType: rawListType } = await params;
  const ownerHandle = normalizeHandle(handle);
  const listType = cleanListType(decodeParam(rawListType));

  let counts: SavedListFollowCounts = { followers: 0, savedPubs: 0 };
  let pubs: SavedPubDTO[] = [];

  if (ownerHandle && listType) {
    const [saved, listCounts] = await Promise.all([
      savedPubsStore().listSaved({ handle: ownerHandle }),
      savedListFollowsStore().counts(ownerHandle, listType),
    ]);
    pubs = saved.filter((pub) => pub.listType === listType);
    counts = { ...listCounts, savedPubs: pubs.length };
  }

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />
      <main className="container profileMain">
        {!ownerHandle || !listType ? (
          <p className="profileEmpty">That list link is missing a handle or list name.</p>
        ) : (
          <SavedListDetail
            ownerHandle={ownerHandle}
            listType={listType}
            pubs={pubs}
            initialCounts={counts}
          />
        )}
      </main>
    </div>
  );
}
