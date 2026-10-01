// The landing skyline hero image: one responsive set committed under
// public/landing. Shared by the server preload (app/page.tsx) and the client
// hero picture so sizes and srcset cannot drift.

export const LANDING_SKYLINE_HERO_SIZES = [
  "(max-width: 640px) min(calc(100vw - clamp(22px, 5vw, 32px) - 80px), 34rem, calc((100svh - 64px) * .33))",
  "(max-width: 959px) min(calc(100vw - clamp(22px, 5vw, 32px) - 80px), 34rem, max(14rem, 36svh))",
  "(max-width: 1279px) min(34rem, calc((min(1240px, 100vw) - 64px - clamp(28px, 4vw, 56px)) * .475))",
  "min(34rem, calc((min(1240px, calc(100vw - 64px)) - 64px - clamp(28px, 4vw, 56px)) * .475))",
].join(", ");

export const LANDING_SKYLINE_HERO_AVIF_SRCSET =
  "/landing/hero-thames-1024.avif 1024w, /landing/hero-thames-1600.avif 1600w";

export const LANDING_SKYLINE_HERO_WEBP_SRCSET =
  "/landing/hero-thames-1024.webp 1024w, /landing/hero-thames-1600.webp 1600w";

export const LANDING_SKYLINE_HERO_JPG_FALLBACK = "/landing/hero-thames-1600.jpg";
