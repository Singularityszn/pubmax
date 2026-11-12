import { NextResponse } from "next/server";

import { posterCodeHref } from "@/lib/posterCodes";

type RouteContext = {
  params: Promise<{ code: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { code } = await context.params;
  const response = NextResponse.redirect(new URL(posterCodeHref(code), request.url), 307);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
