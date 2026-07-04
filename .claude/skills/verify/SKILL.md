---
name: verify
description: Build, launch and drive the trip planner in a real browser to verify changes end-to-end.
---

# Verifying trip_planner changes

Browser-only Vite + TypeScript app; the surface is the rendered page.

## Build & launch

```sh
npm run build                       # tsc --noEmit + vite build (CI parity only)
npm run dev -- --port 5199 --strictPort   # background; serves http://localhost:5199/trip_planner/
```

Note the base path: the app is at `/trip_planner/`, not `/`.

## Drive

Playwright with the system Chrome avoids the browser download:

```js
import { chromium } from 'playwright';           // npm i playwright in a scratch dir
const browser = await chromium.launch({ channel: 'chrome' });
```

Useful hooks in the app:
- Cards render into `#segmentsList` / `#planList`; the shared edit dialog is `#overlay`
  (`#segBody` / `#hotelBody`, `#saveBtn`, `#cancelBtn`, `#delBtn`).
- Ticket import: `#addBtn` → `[data-add="import"]` → set files on the hidden `#importFile`
  input. API-key dialog is `#keyOverlay` (`#keyInput`, `#keySaveBtn`). Errors surface via
  `alert()` — capture with `page.on('dialog', ...)`.
- LLM calls go to `generativelanguage.googleapis.com`; block the route to test the offline
  error path, or use a fake key (`AIza...`) against the real API to test the auth path.
- Persistence: items + settings in `localStorage` (`tripPlanner.items.v1`,
  `tripPlanner.settings.v1`), files in IndexedDB db `tripPlanner`, store `attachments`.

## Gotchas

- Dialogs animate for 0.16s (`pop`); wait ~400ms before screenshots or they capture a
  semi-transparent frame.
- Real extraction needs a valid Gemini API key (user-supplied) — verify everything around
  the LLM call and say so if the happy-path extraction wasn't exercised.
