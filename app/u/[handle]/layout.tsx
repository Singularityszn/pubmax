import { notFound } from "next/navigation";

import { publicProfileRouteWithholdsNotFound } from "@/lib/profilePublicRoute.server";
import { normalizeHandle } from "@/lib/profiles";

const YOU_SENTINEL = "you";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ handle: string }>;
};

// Route-level loading.tsx streamed a 200 before notFound() could set status.
// This layout withholds blocked handles before the page renders so /u/* answers
// a real 404.
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
