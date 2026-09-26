// Founder London collage on the landing page (captain 26 Sep 2026).
// The one photo list: the landing renders it and
// scripts/landing/build-london-collage.mjs encodes it. To add a photograph see
// public/landing/london-collage/README.md.

type LondonCollageLayout = "tall" | "wide" | "hero" | "standard";

export type LondonCollagePhoto = {
  id: string;
  /** Original file name in the captain's hand-off folder; read only by the encoder. */
  source: string;
  caption: string;
  alt: string;
  layout: LondonCollageLayout;
  width: number;
  height: number;
  blurDataUrl: string;
};

export const LONDON_COLLAGE_WIDTHS = [640, 1280] as const;

const PHOTO_DIR = "/landing/london-collage";

export const LONDON_COLLAGE_PHOTOS: readonly LondonCollagePhoto[] = [
  {
    "id": "southwark-shard",
    "source": "london-1.jpg",
    "caption": "Southwark",
    "alt": "The Shard seen down a Southwark street under a mackerel sky, London",
    "layout": "tall",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRsgAAABXRUJQVlA4ILwAAADwBACdASoYACAAPu1wsFIppiSiqAgBMB2JYwDE2FS1nnB7b5VAqQVmMgQXsV3nsTAA+NkPk6xKn9zkFeLbuQdERaV+zdXCoONlNuKurHP5wyXYgS9KultI7RL+Xq3KFh2Qfv0OOpzfvTAzhpuVhfqNQyuDLV7HNOTzk+riBza09CO9l0AliBU+nh82kM+ZEihA+zwOWaBw5sv3J6wN7ulfgpPEorc6Zenqp6bdam78eEwSVibMZwC6xEAAAA=="
  },
  {
    "id": "canary-wharf-night",
    "source": "london-2.jpg",
    "caption": "Canary Wharf",
    "alt": "Canary Wharf at night with lit towers, the Caravan terrace and string lights, London",
    "layout": "wide",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRtoAAABXRUJQVlA4IM4AAADwBQCdASoYACAAPu1iq1AppSOisBgIATAdiWMAxkHc+YXqdXSxAWUQQRbndejzrEj2UbPLTDC3AAD+9H1OO+TQkNxDrCS2cOhXgq7QQAzYzbMnZrvIE8Ut91wcOylTl0h5wSDi3lpaA50DJS5TbslnwEeM+3DRbmV9/wHn3gb7+QTy7axQMJy8b/pd6CQ+PAeRb/gd3vp+sF5pZ6VHzW81QfLDCEC2ix9ao4TVYe6DRhb+wHVy1eIQsJHsQkAo9hxx0QjxUwhURTJIbfAAAA=="
  },
  {
    "id": "canary-wharf-rooftop",
    "source": "london-3.jpg",
    "caption": "Canary Wharf",
    "alt": "Canary Wharf from a rooftop at golden hour over the Crossrail Place glass roof, London",
    "layout": "hero",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRs4AAABXRUJQVlA4IMIAAABwBQCdASoYACAAPu1kqU2ppaOiMAgBMB2JZQDKAzHJY0svPUWlaDVPJmIaKpKxxekAElj8APcpwgjeilIJhiqH5AiH8qquT3cJh7eIIFip5MheZ/wH5xwTYQVpaRg6uT7wfHCet1LUy8fb0d/cUnxVImvO0vNmWmlxWsaHB3OlIujFxHougbTuukDGfsvaH97+U7lmh3wob6aMYnHiDZwoLVszknpWvAWlk6SmkIul9X7mw105wd0cJWI1KSRSQaAAAA=="
  },
  {
    "id": "crown-tavern",
    "source": "london-4.jpg",
    "caption": "The Crown Tavern",
    "alt": "A tree-lined London square with The Crown Tavern on the corner in summer",
    "layout": "standard",
    "width": 1280,
    "height": 1707,
    "blurDataUrl": "data:image/webp;base64,UklGRsgAAABXRUJQVlA4ILwAAACwBACdASoYACAAPu1sqlEppaOiqAqpMB2JZQDGQA35la1rLibPLsD/QhCR5X8AAP7cgy53cgmPyQuEXpAKtG7KSfkSFtWYutt6JlMcYqFXx3SYtJXhC8YSzWhqPdMxTvxDdNWCbQ9/WGxWhcWWQU5zFuC4lFBSf2FVrXYilSmEuZJm1Cb1b6gg2wOsStnXO3qGgp8A2JVZ250HJMvZa1/iI2pAIuqFQCTmCoTEMEHsFa+1NG24qZE/j5ngAA=="
  },
  {
    "id": "exhibition-road",
    "source": "london-5.jpg",
    "caption": "Exhibition Road",
    "alt": "The Geological Museum entrance on Exhibition Road with people sitting outside, London",
    "layout": "standard",
    "width": 1242,
    "height": 2208,
    "blurDataUrl": "data:image/webp;base64,UklGRjQBAABXRUJQVlA4ICgBAAAQBwCdASoYACsAPu1yrVMppqOipWmZMB2JYwDKBAgOVujr/7Ihpv8zsjtE/9qb/ov3TD2RBoRpCvbIyIe1VzG1AAD+8o75dJNuoG7V6fsLEDk9y8qY5ADrdaZQHLksh0fZ/6yE+T59Kh4M16NYTltR46XWqVbfPCXsSZLbNso70YD0turiw+bZGynvlF/MPHiRdI4/5mQEMuKOYontC3Z8WnqSBn4RBqZ6OrdwchzFf6EOp6/dzSdUTzsEClr5nZA495Kj78bKvSesqrku2k9zQWmhRo0SnPHb5FbXwnN1QMgB2AWmfWQBC5zNPWaQVLgrP9maL2FaRiE7rnnBv7CdlcIAbPofQ8QPCBoyY5XLijwyNpADJrzrXNxHeLLhNjm+CDco07ngAA=="
  }
];

export const LONDON_COLLAGE_CREDIT = "Photos by the PUBMAXX founder";

export function londonCollageSrc(photo: LondonCollagePhoto, width: number, format: "avif" | "webp"): string {
  return `${PHOTO_DIR}/${photo.id}-${width}.${format}`;
}

export function londonCollageSrcSet(photo: LondonCollagePhoto, format: "avif" | "webp"): string {
  return LONDON_COLLAGE_WIDTHS.map((w) => `${londonCollageSrc(photo, w, format)} ${Math.min(w, photo.width)}w`).join(", ");
}
