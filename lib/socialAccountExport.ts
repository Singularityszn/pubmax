import type { AccountExportSocialPost } from "@/lib/accountExport";
import { socialPostPhotos } from "@/lib/socialGallery";
import type { SocialPost } from "@/lib/socialPosts";

export function exportSocialPost(post: SocialPost): AccountExportSocialPost {
  return {
    id: post.id, kind: post.kind, visibility: post.visibility, status: post.status,
    body: post.body, area: post.area, venueId: post.venueId, hashtags: [...post.hashtags],
    commentPolicy: post.commentPolicy,
    photos: socialPostPhotos(post).map(photo => ({
      mediaId: photo.mediaId, altText: photo.altText, contentType: photo.contentType ?? "image/jpeg",
    })),
    moderationState: post.moderationState, featureRequest: post.featureRequest,
    revision: post.revision, mutationVersion: post.mutationVersion,
    editedAt: post.editedAt, moderatedAt: post.moderatedAt,
    createdAt: post.createdAt, updatedAt: post.updatedAt,
  };
}

