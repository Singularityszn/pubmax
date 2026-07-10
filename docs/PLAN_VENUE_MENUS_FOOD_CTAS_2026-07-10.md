# Plan: Venue Menus hub + Book / Order CTAs (Greene King–inspired)

Date: 2026-07-10

## Product intent

Alcohol-first stays the spine. When someone opens a pub on the map and wants
**food / booking / a visual menu**, the sheet should feel closer to a chain
Menus screen: clear CTAs, a photo-style category grid, Drinks as the primary
tile, food as a secondary path (usually link-out).

## Phases

| Phase | Ship | Needs new data? |
| --- | --- | --- |
| **1 — Action strip** | Book a table / Look at the menu / Pub website from existing `booking_link` + `website` | No |
| **2 — Menu hub grid** | 2-column tiles; Drinks primary; category tiles when multi-family; Food menu tile when `serves food` + website | No (glyphs now; photos later) |
| **3 — Drinks deep-dive** | Hub → existing `DrinkMenu` list with back | No |
| **4 — Enrichment** | Curated `menuUrl` / `orderUrl` / tile images; pubmaxxing id join | Yes |
| **5 — Polish** | Allergy banner, open/closed hours — only with sourced facts | Yes |

## Hard rules

- Never invent food plate menus or Order buttons without a real URL.
- Never scrape Greene King / Wetherspoons as a deploy gate.
- Keep Drops as the default venue tab; Menu is the commerce/browse surface.
- Design tokens only (brass / paper / ink) — no purple/cream redesign.

## MVP in this branch

Phases 1–3 on existing dataset links + drink composition.
