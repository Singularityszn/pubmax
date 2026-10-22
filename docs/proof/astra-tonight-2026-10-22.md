# Tonight reconciliation, 22 October 2026

The signed-out live page contained the Lexington gig while its heading said no events were confirmed. The music cards were hidden on desktop.

## Change

The empty primary list now names the number of sourced music listings below it. The music cards remain visible at every width. Page credits include the music cards, count shared cards once, and retain each publisher's date. Ticket-platform cards still cannot lead the primary list.

The editorial rail waits for its answer without publishing a `Loading picks` placeholder.

## Evidence

The baseline was `e81aaa6a0`. Live evidence came from `https://pubmaxxing.com/tonight` on 22 October 2026, signed out.

- `artifacts/astra-tonight-1022/live-before.html` contains both `No confirmed events` and `REALLY GOOD TIME`.
- `live-before-1440.png` and `live-before-390.png` show the desktop and phone baseline. The files are in that same local artifact folder.
- A browser check returned `musicVisible=false` on desktop and `musicVisible=true` below the desktop breakpoint.
- Two new server-render regressions failed before the change. They passed after it.
- The final focused run passed 102 tests across seven files. Related suites passed another 75 tests across seven files.
- Scoped ESLint and TypeScript checks passed.

`e2e/tonight-secondary-music.spec.ts` adds browser checks at 390 and 1440 pixels. The local browser run did not complete. The development server stalled before serving requests during Next's registry version check. The integration owner will run these checks and capture after images against the combined production build.

No production write, deployment, environment setting, or billing setting changed. Full `npm run verify` belongs to the combined candidate.
