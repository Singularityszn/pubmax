"use client";

// Discover's one Dog of the week card (launch review F7). It reads the photo
// wall's Dog lane, the same approved-only read /wall makes, and links to the
// page. With no approved dog, or a read that failed, it renders nothing: the
// page owns the empty state, Discover does not word an absence.

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  DOG_OF_THE_WEEK_PATH,
  DOG_OF_THE_WEEK_TITLE,
  dogOfTheWeekMetLine,
  pickDogOfTheWeek,
  type DogOfTheWeek,
} from "@/lib/dogOfTheWeek";
import type { DrinkWallPhotoDTO } from "@/lib/drinkWall";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import "./dogOfTheWeekCard.css";

/** The wall read the card makes: the Dog lane, a few rows deep. */
const DOG_OF_THE_WEEK_CARD_READ = "/api/drink-wall?category=dog&limit=5";

type WallBody = { status?: string; photos?: DrinkWallPhotoDTO[] };

export function DogOfTheWeekCardView({ dog }: { dog: DogOfTheWeek | null }) {
  if (!dog) return null;
  return (
    <section className="discoverSection dogOfTheWeekCard" aria-labelledby="dogOfTheWeek-title">
      <Link className="dogOfTheWeekCardLink" href={DOG_OF_THE_WEEK_PATH} prefetch={false}>
        <span id="dogOfTheWeek-title" className="dogOfTheWeekCardTitle">
          {DOG_OF_THE_WEEK_TITLE}
        </span>
        <span className="dogOfTheWeekCardMet">{dogOfTheWeekMetLine(dog)}</span>
      </Link>
    </section>
  );
}

export default function DogOfTheWeekCard() {
  const [dog, setDog] = useState<DogOfTheWeek | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadSurfaceJson<WallBody>(
      DOG_OF_THE_WEEK_CARD_READ,
      {
        signal: controller.signal,
        init: { headers: { accept: "application/json" } },
        validate: (body) => Boolean(body && Array.isArray(body.photos)),
      },
      (body) => {
        if (controller.signal.aborted) return;
        setDog(body.status === "ready" ? pickDogOfTheWeek(body.photos ?? []) : null);
      },
    );
    return () => controller.abort();
  }, []);

  return <DogOfTheWeekCardView dog={dog} />;
}
