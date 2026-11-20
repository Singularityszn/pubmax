"use client";

import Link from "next/link";
import { usePublicWallContent } from "@/lib/usePublicWallContent";

export default function PublicWallLink() {
  const hasPhotos = usePublicWallContent();
  return hasPhotos ? <Link href="/wall">See the photo wall</Link> : null;
}
