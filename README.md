# Trip Planner

A browser-based trip planner for designing a **non-conflicting itinerary** from a
pool of transport segments and hotel stays, with everything visualised on a
zoomable world map. It runs entirely in the browser — no backend, no build-time
secrets — and is deployed to GitHub Pages.

**Live app:** https://milyin.github.io/trip_planner/

## What it does

- **Two record types** — *segments* (a transport leg: departure/arrival place +
  time, transport mode, company, fare) and *hotels* (city, name, address,
  check-in/out, price, optional booking link). Both are added, edited, deleted
  through a modal dialog and geocoded onto the map.
- **Three panels** — **Segments** (the pool), **Plan** (your chosen itinerary),
  and a **Map**. On phones these collapse into a bottom tab bar showing one
  full-screen panel at a time.
- **Conflict-free planning** — adding a segment to the plan greys out every other
  segment whose time overlaps it (they can't be added while the conflict stands).
- **Generated gap rows** — between consecutive plan items the app inserts a row
  with the elapsed time, great-circle distance, and a feasibility check:
  - **impossible** (red) when the slack is below the next leg's connection buffer,
  - **long layover** (yellow) when it exceeds 8 hours,
  - otherwise neutral.
- **One-click gap filling** — an overnight gap offers **🏨 Add hotel** and a
  geographically remote gap offers **🧭 Add segment**, each opening the dialog
  pre-filled from the surrounding items and dropped straight into the plan.
- **Colour-coded map** — each transport mode has a fixed colour shared by its
  icon and its map line. Plan legs are solid with a halo, available legs are
  dashed, and a selected leg gets an accent border mirroring the selected-hotel
  pin. The legend re-homes itself to the map corner least covered by lines.
- **Totals footer** — number of legs, total nights, total span, cost per
  currency, and an overall connection-feasibility flag.
- **Day / night themes** that also swap the map tiles, plus a 📱 preview toggle
  that renders the mobile layout in a phone frame on desktop.

## Domain rules

**Minimum connection buffer** — how long you must arrive before the *next* leg
departs. These live in `src/domain/transport.ts` and are reused by every part of
the UI:

| Transport | Buffer |
|-----------|--------|
| Plane     | 2h     |
| Train     | 20m    |
| Bus       | 15m    |
| Taxi      | 5m     |
| Car       | 5m     |
| Other     | 30m    |

**Gap feasibility** between two consecutive plan items, where
`available = next.start − prev.end`:

- `available < buffer(next)` (including negative) → **impossible** (red);
- `available > 8h` (and neither side is a hotel) → **long layover** (yellow);
- otherwise → **ok**.

Hotels never grey out segments and need no connection buffer before them.

## Tech stack

- [TypeScript](https://www.typescriptlang.org/) (strict) + [Vite](https://vitejs.dev/)
- [Leaflet](https://leafletjs.com/) for the map (CARTO tiles)
- No framework — a small typed domain layer with a plain observer/render loop

## Project layout

The code is split so the **domain logic is UI-agnostic and testable**, and the UI
is a thin, replaceable layer on top:

```text
src/
  domain/     # pure, DOM-free: types, transport metadata, geocoding, plan/gap algorithms
    types.ts        # Place, Segment, Hotel, TripItem, TransportKind, CurrencyCode
    transport.ts    # icons, colours, connection buffers, thresholds, currency symbols
    geo.ts          # geocoder + haversine distance
    item.ts         # start/end accessors that unify segments and hotels
    plan.ts         # planItems/listItems, conflict detection, gap classification, totals
    format.ts       # duration/time/money formatting
  state/      # mutable store + observer, id generator, seed itinerary
  ui/         # cards, panels, modal, topbar, tabbar, selection, theme, render loop
  map/        # Leaflet map view (draw, legend placement, fit, tabs)
  styles/     # CSS split by concern (theme, topbar, panels, cards, map, modal, responsive)
  main.ts     # bootstraps the map, wires the UI, subscribes the renderer
index.html    # static markup queried by id; no inline script/style
```

State changes call `emitChange()`, which re-runs `renderAll()` (rebuild the two
lists + redraw the map). Swapping the frontend means replacing `src/ui` +
`src/map` while keeping `src/domain` and `src/state`.

## Develop

```bash
npm install
npm run dev        # start the Vite dev server (hot reload)
```

## Build & preview

```bash
npm run build      # type-check (tsc --noEmit) then bundle to dist/
npm run preview    # serve the production build locally
```

`npm run typecheck` runs the strict type check on its own.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the app
and publishes `dist/` to GitHub Pages. Because the site is served from a project
subpath, `vite.config.ts` sets `base: '/trip_planner/'`.

To enable it once: in the repository's **Settings → Pages**, set **Source** to
**GitHub Actions**.

## Roadmap

- Drag-and-drop of route screenshots stored alongside records (a field is
  reserved for this next step).
- Persisting the itinerary (local storage / shareable links).
- A real geocoding provider behind the existing `geocode()` interface.

<!-- CI preview smoke test (PR will be closed, not merged) -->
