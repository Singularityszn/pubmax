import { notFound } from "next/navigation";

import { publicProfileRouteWithholdsNotFound } from "@/lib/profilePublicRoute.server";
import { normalizeHandle } from "@/lib/profiles";

const YOU_SENTINEL = "you";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ handle: string }>;
};

// loading.tsx wraps the page in Suspense and streams a 200 before that page
// can call notFound(). This layout sits outside that boundary, so a withheld
// handle still answers with a real 404.
export default async function ProfileHandleLayout({ children, params }: LayoutProps) {
  const requestedHandle = normalizeHandle((await params).handle);
  if (
    requestedHandle &&
    requestedHandle !== YOU_SENTINEL &&
    (await publicProfileRouteWithholdsNotFound(requestedHandle))
  ) {
    notFound();
  }
  return children;
}
