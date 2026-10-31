import Image from "next/image";
import Link from "next/link";

import {
  DOG_OF_THE_WEEK_EMPTY_LINE,
  DOG_OF_THE_WEEK_UNREAD_LINE,
  dogOfTheWeekAlt,
  dogOfTheWeekMetLine,
  dogOfTheWeekPubHref,
  type DogOfTheWeekRead,
} from "@/lib/dogOfTheWeek";

import "./dogOfTheWeek.css";

/**
 * The Dog of the week page body for one read: the photo with its pub and
 * uploader, the empty state, or the line for a wall that could not be read.
 */
export default function DogOfTheWeekBody({ read }: { read: DogOfTheWeekRead }) {
  if (read.status === "unavailable") {
    return (
      <p className="dogOfTheWeekEmpty" role="status">
        {DOG_OF_THE_WEEK_UNREAD_LINE}
      </p>
    );
  }
  const { dog } = read;
  if (!dog) {
    return <p className="dogOfTheWeekEmpty">{DOG_OF_THE_WEEK_EMPTY_LINE}</p>;
  }
  return (
    <figure className="dogOfTheWeekFigure">
      <Image
        className="dogOfTheWeekPhoto"
        src={dog.url}
        alt={dogOfTheWeekAlt(dog)}
        width={dog.width}
        height={dog.height}
        unoptimized
        priority
      />
      <figcaption className="dogOfTheWeekCaption">
        <Link className="dogOfTheWeekPub" href={dogOfTheWeekPubHref(dog)}>
          {dogOfTheWeekMetLine(dog)}
        </Link>
        {dog.caption ? <span className="dogOfTheWeekNote">{dog.caption}</span> : null}
        <span className="dogOfTheWeekBy">Photo by @{dog.handle}</span>
      </figcaption>
    </figure>
  );
}
