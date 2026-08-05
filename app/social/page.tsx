import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { buildCityRivalrySnapshot } from "@/lib/cityRivalry";
import { loadHeritageCrawls } from "@/lib/heritageCrawls";
import { parseSocialShellSearch } from "@/lib/socialShell";

import SocialPageClient from "./SocialPageClient";

export const metadata: Metadata = {
  title: "Social",
  description: "Chronological pub-night posts and public pub discovery.",
  alternates: { canonical: "/social" },
  robots: { index: true, follow: true },
};

type SearchParams = Record<string, string | string[] | undefined>;

function toUrlSearchParams(input: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const state = parseSocialShellSearch(toUrlSearchParams(await searchParams));
  if (!state.valid) redirect("/social");

  const [rivalry, heritageCrawls] =
    state.tab === "discover"
      ? await Promise.all([buildCityRivalrySnapshot(), loadHeritageCrawls()])
      : [[], []];

  return (
    <SocialPageClient
      initialState={state}
      rivalry={rivalry}
      heritageCrawls={heritageCrawls}
    />
  );
}
