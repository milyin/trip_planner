# trip_planner

Rust desktop trip planner built with a replaceable backend/frontend split. The current GUI uses [`iced`](https://iced.rs/), while segment rules, storage, geocoding, and plan generation live outside the GUI.

## Features

- Add, edit, remove, and list travel segments.
- Store segments locally in SQLite.
- Model segments as departure and arrival stops, transport, optional company, and money.
- Geocode places with the Rust `geocoding` crate through an isolated provider trait.
- Build a non-overlapping segment plan interactively.
- Grey out segments that overlap already selected plan segments.
- Generate gap rows between selected segments with elapsed time and distance when coordinates are available.
- Classify plan gaps by feasibility using per-transport connection buffers (impossible = red, long layover = yellow).
- Show plan totals: number of legs, total span, and total cost per currency.
- Prepare storage for future segment screenshot attachments.

## Specification — domain rules

**Minimum connection buffer** (required arrival-before-departure of the *next* leg). These are domain data in `trip_core`, reused by any frontend:

| Transport | Buffer |
|-----------|--------|
| Plane     | 2h     |
| Train     | 20m    |
| Bus       | 15m    |
| Taxi      | 5m     |
| Car       | 5m     |
| Other     | 30m    |

**Gap feasibility** between two consecutive plan legs, where `available = next.departure - previous.arrival`:

- `available < buffer(next.transport)` (including negative) → **impossible** (red).
- `available > 8h` → **long layover** (yellow).
- otherwise → **ok**.

## Workspace layout

```text
crates/trip_core      # domain model, validation, overlap and plan algorithms
crates/trip_storage   # SQLite persistence and future screenshot attachment schema
crates/trip_geo       # geocoding and distance abstractions
crates/trip_app       # UI-independent application service layer
crates/trip_iced      # iced desktop frontend
```

The GUI depends on `trip_app`; it does not own business rules or persistence details.

## Run

```bash
cargo run -p trip_iced
```

The application creates `trip_planner.sqlite3` in the working directory and seeds the Marseille/Paris/Madrid example segments on first launch.

## Test

```bash
cargo test
```

## Initial interface

The desktop shell uses a three-panel layout (Segments | Plan | Map) with a top bar:

- **Segments**: all stored segments with selectable, selected, or disabled status; an `Add →` button moves a segment into the plan. Each card shows the **trip duration**, and hovering reveals the full untrimmed text of any ellipsized title/address.
- **Plan**: selected non-overlapping segment rows plus generated gap rows, with a totals footer (legs, span, cost per currency); a `↩ Remove` button moves a segment back.
- **Map**: a zoomable world map. Non-overlapping segments are drawn and color-coded by transport type (the line matches its transport icon color); plan legs are solid with a halo, available legs are dashed. Overlapping segments are hidden to reduce clutter and are drawn thin, dashed and red only while selected. The legend auto-relocates to the map corner least covered by segments.

Segments are created and edited through a **modal dialog** (add/edit/delete). Selecting a card reveals compact action **icon buttons pinned to its top-right corner** (Add/Remove and Edit); they overlay the card so selection never changes card size. **Double-click** opens the edit modal, and cards can be **dragged** between the Segments and Plan panels to add/remove them (a drop that would time-overlap the plan is rejected with a red indicator). A **day/night theme toggle** switches both the UI palette and the map tiles. Screenshot drag-and-drop is intentionally not mixed into the core segment model yet; the storage schema already has a segment screenshot table for the next implementation step.

A clickable HTML/Leaflet prototype of this design is used to validate look-and-feel before the `iced` implementation.
