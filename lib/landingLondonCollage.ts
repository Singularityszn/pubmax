// Founder London photograph collection for the homepage and place pages.
// The encoder reads the full collection. LONDON_JOURNAL_PHOTOS selects the
// homepage photographs. To add a photograph see
// public/landing/london-collage/README.md.

import { haversineMeters } from "./greatCircle.mjs";

type LondonCollageLayout = "tall" | "hero" | "standard";

export type LondonCollagePhoto = {
  id: string;
  /** Original file name in the captain's hand-off folder; read only by the encoder. */
  source: string;
  caption: string;
  alt: string;
  layout: LondonCollageLayout;
  /**
   * The patch of London the photo shows. Photos that share one carry one price
   * line between them, on the first tile, so the mosaic never prints the same
   * figure twice.
   */
  area: string;
  /**
   * The named desktop grid cell for a selected homepage photograph.
   * components/landing/landingLondonCollage.css owns the grid arrangement.
   */
  cell: string;
  /** Where the photo was taken, [latitude, longitude]: the centre of its price line. */
  spot: readonly [number, number];
  width: number;
  height: number;
  blurDataUrl: string;
  /** Normalised [left, top, width, height] on the oriented source; applied at encode time only. */
  privacyBlurRects?: readonly (readonly [number, number, number, number])[];
};

export const LONDON_COLLAGE_WIDTHS = [640, 1280] as const;

const PHOTO_DIR = "/landing/london-collage";

export const LONDON_COLLAGE_PHOTOS: readonly LondonCollagePhoto[] = [
  {
    "id": "southwark-shard",
    "cell": "sw",
    "area": "southwark",
    "spot": [51.504, -0.088],
    "source": "london-1.jpg",
    "caption": "Southwark",
    "alt": "The Shard seen down a Southwark street under a mackerel sky, London",
    "layout": "tall",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRsAAAABXRUJQVlA4ILQAAADwBACdASoYACAAPu1wr1IppiQiqAgBMB2JYwDE2Fc1COhH2+p49eXS5B9nNjX8jgAA+NjFaIwq42IcVqDw1ToVeVa/t78E00ST0+7/oDwkOnkBIX1vX90i8rdNBIABcrlUCuV0ZdVEQWnkU7tVZ2WAN0SLqjix270eZ8YAjvZdAJYgVOUBg1reSnJIPcVyQ14mOomnQlruNsvl5GnsFTn/GNWkVMh348bgW7mAwuj9IpYGAAA="
  },
  {
    "id": "canary-wharf-night",
    "cell": "cwn",
    "area": "canary-wharf",
    "spot": [51.5054, -0.0235],
    "source": "london-2.jpg",
    "caption": "Canary Wharf",
    "alt": "Canary Wharf at night with lit towers, the Caravan terrace and string lights, London",
    "layout": "standard",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRtgAAABXRUJQVlA4IMwAAADQBQCdASoYACAAPu1mq08ppaOiMBgIATAdiWMAxkQIAeHhtHRAT0WXizi4a2fhZWipMESFBkzQAP70egxyX/vwGoiep2cDfa1pZtpuosYyaxf3jZgiM3S+jUK+7WUK5sy7BalzVafs59OP3hxHIhBKrckYAJU4N5k7H4M9ImWHlFEvayIo9yD5byfD9qLSry868qB0Zhss5EraO8xgHbdX1gU6Wzn3E8hPfuGX3QSA6I0Gjk234duddSnMj/vObyyTFt2sauxg+nGdoAA="
  },
  {
    "id": "canary-wharf-rooftop",
    "cell": "rt",
    "area": "canary-wharf",
    "spot": [51.5058, -0.0196],
    "source": "london-3.jpg",
    "caption": "Canary Wharf",
    "alt": "Canary Wharf from a rooftop at golden hour over the Crossrail Place glass roof, London",
    "layout": "hero",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRsoAAABXRUJQVlA4IL4AAACQBQCdASoYACAAPu1sqk8ppiOiMBgIATAdiWUAygAN15frS8/0tMljKix3WkiYEATwqpmWYAD3KcII3p4AzFXDLVEKuNHRHhjISCaTmwH/yEH1OVt6n7z2qwxPEGz28cKOl66X5/pjhJ/+Ef5e85yT2c0TW0sX56fNw41bRfaohdcpxncm0efPE6lSU7e6Jjas9xt8o6LgF2Uww/AnsQXdlt4i+YdxA+gesBL2eQ26PoVJxDxx4d7ylempAAAA"
  },
  {
    "id": "exhibition-road",
    "cell": "ex",
    "area": "south-kensington",
    "spot": [51.4963, -0.1764],
    "source": "london-5.jpg",
    "caption": "Exhibition Road",
    "alt": "The Geological Museum entrance on Exhibition Road with people sitting outside, London",
    "layout": "tall",
    "width": 1242,
    "height": 2208,
    "blurDataUrl": "data:image/webp;base64,UklGRjwBAABXRUJQVlA4IDABAACwBgCdASoYACsAPu1ysVOppqSipWgBMB2JYwDA3zLLoxpftf+pTox8No+bwwIt9rRaiwQTXfhALrpvV1LKQAD+9BWaS4+g3bTAV/h0rdrHDwR1X6LjeXTjRT3A+QJh/9HsF5m67/WJdAxjdI+aGDLXze5uxtyrQh69kS1nRRPKPwxE5VvEgfRdtpxIY2M6B5jUXPjS5PuJvuPsZ7DgOkc/8ZLR33oU7MZZk5D9V+UEcMF+OUBIXdQobqf33bhcblokBUt1sfpII86GRyDEtp9l5cXNeB1kVaYNMof8PvtCKHpNWgugTbgAZA1VIEdO+sQq5INGx5IYKmy//maH5OWF5MYYJaIwY68TgSA8zjoHhBfDm0L8vMA7l24NcpAy2RzLM18GhMUZi2ELf8b1AAAA"
  },
  {
    "id": "crown-tavern",
    "cell": "ct",
    "area": "clerkenwell",
    "spot": [51.5236, -0.1058],
    "source": "london-4.jpg",
    "caption": "The Crown Tavern",
    "alt": "A tree-lined London square with The Crown Tavern on the corner in summer",
    "layout": "standard",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRsoAAABXRUJQVlA4IL4AAABQBQCdASoYACAAPu1qqlEppaOiqAqpMB2JZQDGQA36RX3Zz0RWtJ+5nuT/kHyiu9T/84AA/tyDLndyCY/JC4RekAq0KgYtsKWPMbUtwuhgOtN9SAn9DoRpE/pol1DEeDXXiXiBPJ5eG8vKIMSTaCBXeN4qhJGWqwgodaHKPB6qcxXOfv3RMPAIejM00PGsWWgFnJ0xkC5wBE+tS0TBZmOV4mE8Amh2sAL7Kuy2njw2wuYksATLsghQvyX/AAAA"
  },
  {
    "id": "leadenhall-boxhall",
    "cell": "lb",
    "area": "leadenhall",
    "spot": [51.5127, -0.0836],
    "source": "london-6.jpg",
    "caption": "Leadenhall Market",
    "alt": "The City of London street with the Leadenhall Market arcade and Boxhall, Victorian brick and glass towers behind",
    "layout": "standard",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRvIAAABXRUJQVlA4IOYAAADQBQCdASoYACAAPu1kqU2ppaQiMAgBMB2JYgCxDPmDA2D626z5jRePFw8sicq0j+8K86/uWxYAAP69neuDP/yrbg9PnA9cr66Dxvsngz56CWf2C6DyolnteydTVXPKdZXvklVY4pHa/xBIAvr5hq0mehHi4TIgOcwaQtikcvFZryXqXNbTcypXElRQxGtOEP9ohwPp9lVJcibYrxaDDOe9z4TH9jXVEH0Nai5phMcVJ6x5t1HthcgVajAvG8YyMYzvPBs1lkFMauIpwFF1M3D2WLsBkYEIBcTpN4zC73iwQqtR7T5gAA==",
    "privacyBlurRects": [
      [0.08, 0.942, 0.24, 0.05],
      [0.36, 0.84, 0.24, 0.07],
      [0.44, 0.7, 0.16, 0.05],
      [0.52, 0.66, 0.14, 0.05],
      [0.38, 0.62, 0.12, 0.04],
      [0.56, 0.58, 0.12, 0.04]
    ]
  },
  {
    "id": "canary-wharf-sunset",
    "cell": "cws",
    "area": "canary-wharf",
    "spot": [51.5058, -0.0196],
    "source": "london-7.jpg",
    "caption": "Canary Wharf",
    "alt": "Canary Wharf at sunset between glass towers and the Crossrail Place roof with sun flare, London",
    "layout": "standard",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRrgAAABXRUJQVlA4IKwAAAAQBQCdASoYACAAPu1ur1IppiQiqAgBMB2JQBYj5EengQlwQbmKTJbMO6TGu5SBcjZgAP6qGC7ozVYLBWhlYVi1Y+94YvW9AeN+o3JNA4+GtSYcOKURFRJj383ithVzexj9fZw28VuhMiy03ozGMag2dIv068ixbjPtT+ZYBIoJipl9PQPkCytkLkzZ3GnSZx5A5A9A803PgOINpAm98RzNlVhleU1tZsRs87AA"
  },
  {
    "id": "crossrail-walkway",
    "cell": "cr",
    "area": "canary-wharf",
    "spot": [51.5058, -0.0196],
    "source": "london-8.jpg",
    "caption": "Crossrail Place",
    "alt": "The Crossrail Place roof and tower walkway at golden hour near the Elizabeth line entrance, London",
    "layout": "tall",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRvQAAABXRUJQVlA4IOgAAAAwBgCdASoYACAAPu1ur1IppiQiqAgBMB2JaACdL8CA0Jdk5H9KB7GQ+KDQen7x5ADH0I8b400N7NgAAP6PS28PHEGsh4l5//YqDhw7YsDLGautl/h0SUlTZP9eQ/+MkPmgFBl0yUO0Y9F5gV6xeLuDQ/JzcrTGQ4WxPSVdgox9z0yyiSl55+sGvijotch2umAmAOvjLMgzFsP6bWXDYB6Iru3YMiiUcJPRkxx1Vc0JMByULgFeTBQLgmJ9+Wr0idrQuH1FNV8laN1IYb2Rh1njdPh5VNKxLqjQiBU/NGEgJmIOIyhMQAAA"
  },
  {
    "id": "thames-st-pauls",
    "cell": "th",
    "area": "blackfriars",
    "spot": [51.5095, -0.104],
    "source": "london-9.jpg",
    "caption": "The Thames at Blackfriars",
    "alt": "The Thames foreshore with Blackfriars Bridge, Unilever House and the dome of St Pauls under a clear sky, London",
    "layout": "hero",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRpYAAABXRUJQVlA4IIoAAABwBACdASoYACAAPu1mq06ppaQiKA1RMB2JQBdgCLvxKKH3lSu/uLucmcotgAD9zG+5j2qmYJQwVWkKfxd7CMMmztnxhNJbd4sxIlgfYGx7EzEDK+lsZwi1fFeasw3dr/t0am80kQ9DfSDtNbDZZnzIh1NhA5klY5u2F3A81nSN9CMId4VvAs4p4AA="
  },
  {
    "id": "parliament-big-ben",
    "cell": "pb",
    "area": "westminster",
    "spot": [51.5007, -0.1246],
    "source": "london-10.jpg",
    "caption": "Westminster",
    "alt": "Big Ben and the Houses of Parliament with a red double-decker bus in bright sun, London",
    "layout": "hero",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRswAAABXRUJQVlA4IMAAAAAwBQCdASoYACAAPuFeqk2opSQiMAwBEBwJagB4zgMt/WLhadmW+bLGWiiGqqy7TKmcGAD+rtruSixv1O/W5q08hG3heiWpvfb111Rv/JI2Tfbrf+RyAHyb8sv9Ai3xHUXJyC+YhTXSnSs73SJAWGoDtvsk+StciVLsVKT82W9rXfhm4ERxFBt7+Pn7x7/uIjlJidlaoOmYhx9zGikkAGA7fUz1RoEMfcvAXyoTVUQn92evwCk/fsVdo0CWYVwAAAA="
  }
];

export const LONDON_COLLAGE_CREDIT = "Photos by the PUBMAXX founder";

/** A short selection for the homepage. The full collection still serves place pages. */
export const LONDON_JOURNAL_PHOTOS: readonly LondonCollagePhoto[] = [
  "southwark-shard", "crown-tavern", "leadenhall-boxhall", "canary-wharf-night",
].flatMap((id) => LONDON_COLLAGE_PHOTOS.filter((photo) => photo.id === id));

export function londonPhotoMapHref(photo: LondonCollagePhoto): `/map?${string}` {
  // Two London pubs share this name. This photograph shows the Clerkenwell pub.
  return photo.id === "crown-tavern"
    ? "/map?sel=venue-13sug69"
    : `/map?q=${encodeURIComponent(photo.caption)}`;
}

export function londonCollageSrc(photo: LondonCollagePhoto, width: number, format: "avif" | "webp"): string {
  return `${PHOTO_DIR}/${photo.id}-${width}.${format}`;
}

export function londonCollageSrcSet(photo: LondonCollagePhoto, format: "avif" | "webp"): string {
  return LONDON_COLLAGE_WIDTHS.map((w) => `${londonCollageSrc(photo, w, format)} ${Math.min(w, photo.width)}w`).join(", ");
}

/** Half a mile as the crow flies: a ten-minute walk from where the photo was taken. */
const LONDON_COLLAGE_WALK_METRES = 800;

/** The cheapest listed pint within a short walk of one photographed patch. */
export type LondonCollageAreaPrice = {
  cheapestPrice: number;
  pubName: string;
  /** How many priced pubs sit inside the walk, the cheapest included. */
  pubCount: number;
};

type PricedPoint = {
  name: string;
  latitude: number;
  longitude: number;
  cheapestPrice: number | null;
};

/**
 * Each area's price line, read from the same priced venues the landing hero
 * reads (lib/landingPubCard.server.ts), centred on the area's first photo. An
 * area with no priced pub inside the walk gets no entry, and its tile prints
 * no figure rather than an invented one.
 */
export function buildLondonCollageAreaPrices(
  venues: readonly PricedPoint[],
  photos: readonly LondonCollagePhoto[] = LONDON_COLLAGE_PHOTOS,
): Record<string, LondonCollageAreaPrice> {
  const prices: Record<string, LondonCollageAreaPrice> = {};
  for (const photo of photos) {
    if (photo.area in prices) continue;
    const [lat, lng] = photo.spot;
    let best: PricedPoint | null = null;
    let count = 0;
    for (const venue of venues) {
      if (typeof venue.cheapestPrice !== "number" || !Number.isFinite(venue.cheapestPrice)) continue;
      if (haversineMeters(lat, lng, venue.latitude, venue.longitude) > LONDON_COLLAGE_WALK_METRES) continue;
      count += 1;
      if (
        !best ||
        venue.cheapestPrice < (best.cheapestPrice as number) ||
        (venue.cheapestPrice === best.cheapestPrice && venue.name.localeCompare(best.name) < 0)
      ) {
        best = venue;
      }
    }
    if (best) {
      prices[photo.area] = {
        cheapestPrice: best.cheapestPrice as number,
        pubName: best.name,
        pubCount: count,
      };
    }
  }
  return prices;
}

/** The ids of the tiles that carry their area's price line: the first photo of each area. */
export function londonCollagePricedTileIds(
  photos: readonly LondonCollagePhoto[] = LONDON_COLLAGE_PHOTOS,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const photo of photos) {
    if (seen.has(photo.area)) continue;
    seen.add(photo.area);
    ids.add(photo.id);
  }
  return ids;
}
