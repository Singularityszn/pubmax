// GET /api/messages/[id]/photo/[messageId] - the bytes of one message photo.
//
// It lives UNDER the conversation on purpose: the address itself says which
// courtesy check owns it. The gate, the refusal and the no-store posture are
// `lib/messagePhotoServe.server.ts`.

import {
  defaultMessagePhotoServeDeps,
  handleMessagePhotoServe,
  MESSAGE_PHOTO_SERVE_CACHE_CONTROL,
  type MessagePhotoServeDeps,
} from "@/lib/messagePhotoServe.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export const MESSAGE_PHOTO_CACHE_CONTROL = MESSAGE_PHOTO_SERVE_CACHE_CONTROL;

let testDeps: Partial<MessagePhotoServeDeps> | null = null;

export function __setMessagePhotoServeRouteDepsForTest(
  deps: Partial<MessagePhotoServeDeps> | null,
): void {
  testDeps = deps;
}

function deps(): MessagePhotoServeDeps {
  return { ...defaultMessagePhotoServeDeps, ...testDeps };
}

type RouteContext = { params: Promise<{ id: string; messageId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleMessagePhotoServe(request, await context.params, deps());
}
