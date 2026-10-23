import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import { normalizeHandle } from "@/lib/profiles";

import PeopleListClient, { type PeopleRelation } from "./PeopleListClient";

import "../../profile.css";

const RELATIONS: readonly PeopleRelation[] = ["followers", "following"];

function isRelation(value: string): value is PeopleRelation {
  return (RELATIONS as readonly string[]).includes(value);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; relation: string }>;
}): Promise<Metadata> {
  const { handle, relation } = await params;
  const clean = normalizeHandle(handle);
  const title = relation === "followers" ? "Followers" : "Following";
  return {
    title: `${title} of @${clean}`,
    alternates: { canonical: `/u/${clean}/people/${relation}` },
  };
}

export default async function ProfilePeoplePage({
  params,
}: {
  params: Promise<{ handle: string; relation: string }>;
}) {
  const { handle, relation } = await params;
  const clean = normalizeHandle(handle);
  if (!clean || !isRelation(relation)) notFound();

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />
      <main className="container profileMain profilePeopleMain" id="main-content">
        <Link className="profileBackLink" href={`/u/${encodeURIComponent(clean)}`}>
          Back to the profile
        </Link>
        <PeopleListClient handle={clean} relation={relation} />
      </main>
    </div>
  );
}
