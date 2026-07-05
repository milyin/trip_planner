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

Terminology: a **segment** is any plan element (leg or hotel); a **leg** is one transport
ride A→B. Types: `Segment = Leg | Hotel`, `Leg.kind === 'leg'`.

Useful hooks in the app:
- Cards render into `#segmentsList` / `#planList`; the shared edit dialog is `#overlay`
  (`#legBody` / `#hotelBody`, `#saveBtn`, `#cancelBtn`, `#delBtn`); tabs `#mtabForm` /
  `#mtabLlm` (LLM exchange dump in `#llmDump`).
- Ticket recognition lives inside the leg dialog: drop zone `#importZone` (hidden input
  `#legFile`, preview `#filePreview`, hint `#dropHint`), note `#fNote`, parser combo
  `#fParser`, config shortcut `#cfgParsersBtn`, button `#recogniseBtn`. LLM configuration:
  `#settingsBtn` menu item → `#parserOverlay` with two inline-editable lists — `#accountList`
  (provider select + key input per row) and `#parserList` (account select + model input per
  row), `#addAccountBtn` / `#addParserBtn` / `#parserDoneBtn`; rows `.parser-row`.
  Errors surface via `alert()` — capture with `page.on('dialog', ...)`.
- Settings shape: `{accounts: [{id, provider, apiKey}], parsers: [{accountId, model}],
  activeParser, theme}`; older shapes migrate on load.
- Topbar: single ☰ menu (`#hamBtn`/`#hamMenu`) with `#addLegBtn`, `#addHotelBtn`,
  `#previewBtn`, `#themeBtn`, `#settingsBtn`, `#clearBtn` (Clear segments). Clear uses
  `confirm()` — Playwright's dialog handler must accept/dismiss it.
- IndexedDB v2 has stores `attachments` (bytes copied at put — never store raw `File`s;
  Chromium keeps them as on-disk references) and `exchanges` (per-leg LLM exchange, keyed
  by leg id — shown in the LLM tab when editing a saved leg).
- Stored items with old `kind: 'segment'` migrate to `'leg'` on load (persist.ts).
- Workspaces: registry `tripPlanner.workspaces.v1` {active, list:[{id,name}]}; items per
  workspace under `tripPlanner.items.<id>` (legacy `tripPlanner.items.v1` migrates to a
  Default workspace). ☰ menu: `#wsNewBtn` (prompt), `#wsSelectBtn` → `#wsOverlay` rows,
  `#wsRenameBtn` (prompt), `#wsShareBtn` (clipboard `#ws=` URL — grant clipboard-read/write
  permissions in Playwright), `#wsDeleteBtn` (confirm). Brand shows `#brandWs`. Share URLs
  import on load AND on hashchange; payload = gzip+base64url of {v,name,items,geo}.
- LLM endpoints: `generativelanguage.googleapis.com` (Gemini SDK) and
  `openrouter.ai/api/v1/chat/completions` (plain fetch — easy to mock with `ctx.route`
  fulfilling a canned `{choices:[{message:{content: JSON.stringify({legs:[...]})}}]}`).
- Geocoding: `nominatim.openstreetmap.org/search?...&q=<query>` — mock with
  `[{lat:'49.49',lon:'0.11'}]`. Cache in localStorage `tripPlanner.geocache.v1`; requests
  are queued ≥1.1s apart, so mocked multi-lookup tests need generous timeouts. Startup
  backfill re-geocodes records with missing `ll`.
- Persistence: items + settings in `localStorage` (`tripPlanner.items.v1`,
  `tripPlanner.settings.v1` — settings hold a `parsers` array), files in IndexedDB db
  `tripPlanner`, store `attachments`. Segments reference images via `attachment` field.
- Drag-n-drop can be simulated in `page.evaluate` with `new DataTransfer()` +
  `new File(...)` + dispatching a `DragEvent('drop', {dataTransfer, bubbles: true})`.

## Gotchas

- Dialogs animate for 0.16s (`pop`); wait ~400ms before screenshots or they capture a
  semi-transparent frame.
- Real extraction needs a valid Gemini API key (user-supplied) — verify everything around
  the LLM call and say so if the happy-path extraction wasn't exercised.
