import SocialPostCard from "@/components/social/SocialPostCard";
import SampleSkeleton from "@/components/ui/sample-skeleton";
import type { SocialPostDTO } from "@/lib/socialPosts";

const sample: SocialPostDTO = {
  id: "loading",
  kind: "standard",
  visibility: "friends",
  body: "A message from your lot at the pub.",
  area: null,
  venueId: null,
  venueName: null,
  venueProjected: false,
  hashtags: [],
  commentPolicy: "open",
  photo: null,
  nameHidden: false,
  moderationState: "approved",
  featureRequest: null,
  revision: 0,
  mutationVersion: 0,
  editedAt: null,
  createdAt: "2000-01-01T12:00:00Z",
  updatedAt: "2000-01-01T12:00:00Z",
  ownedByViewer: false,
  author: { handle: "conversation" },
};

export default function SocialFeedLoading() {
  return <SampleSkeleton label="Loading posts" className="socialPostList">
    {[0, 1, 2].map(row => <SocialPostCard key={row} post={sample} />)}
  </SampleSkeleton>;
}
