import "server-only";

import { createHash } from "node:crypto";

import { signedUuid, validClientRequestKey } from "@/lib/clientRequestKey.server";
import type { SocialPostFields } from "@/lib/socialPosts";

export function validSocialPostIdempotencyKey(value: string | null): value is string {
  return validClientRequestKey(value);
}

export function socialPostRequestDigest(fields: SocialPostFields, mediaSha256: string | null, tags: string[]): string {
  // A named post digests exactly as it did before `nameHidden` existed, so a
  // retry that spans the deploy still matches its first attempt. A hidden-name
  // post digests the flag, so one key can never post the same words twice,
  // once named and once not.
  const { nameHidden, ...named } = fields;
  return createHash("sha256")
    .update(JSON.stringify({ fields: nameHidden ? fields : named, mediaSha256, tags }))
    .digest("hex");
}

export function socialPhotoMediaId(profileId: string, key: string, sha256: string): string {
  return signedUuid(`${profileId}:${key}:${sha256}`);
}
