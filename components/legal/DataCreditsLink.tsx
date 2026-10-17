import Link from "next/link";

import { DATA_CREDITS_PATH } from "@/lib/dataCredits";

/**
 * The one link from a surface that shows outside data to /credits, where every
 * source is listed with its licence and the credit it asks for. One component,
 * so the words and the destination cannot drift between surfaces.
 */
export default function DataCreditsLink({
  className,
  children = "Data credits",
}: {
  className?: string;
  children?: string;
}) {
  return (
    <Link prefetch={false} href={DATA_CREDITS_PATH} className={className}>
      {children}
    </Link>
  );
}
