# Trip Planner — interactive GUI design prototype

A self-contained, clickable HTML mock-up of the Trip Planner desktop UI. It is a
**design reference** for the native `iced` application (see the crates in the repo
root) — it is not wired to the real backend, it just uses in-memory sample data so
the look, layout, and interactions can be evaluated quickly in a browser.

## What it demonstrates

- **Three-panel layout**: Segments · Plan (equal width) · zoomable world map (Leaflet).
- **Day / night theme** toggle (also swaps the map tiles).
- **Two record types**: **segments** (a transport leg: departure/arrival place + time,
  transport, company, cost) and **hotels** (a stay: city, hotel name, address, check-in /
  check-out dates, price, and an optional booking link). Both are added from the top bar
  (`＋ Segment` / `🏨 Hotel`) and live together in the Segments and Plan panels.
- **Add / edit / delete** records through a modal dialog (the modal swaps its fields for
  segments vs hotels).
- **Move records** between Segments and Plan (buttons, drag-and-drop, double-click to edit).
- **Boarding-pass segment cards**: each segment is a compact three-column card. Row 1 shows
  the departure city, the transport icon + company (centred), and the arrival city;
  row 2 the departure address, the fare (centred), and the arrival address; row 3 the
  departure time, the trip duration, and the arrival time.
- **Hotel cards**: a two-column card — hotel name (with a 🏨 marker) and price on the top
  row, city · address and an optional 🔗 link on the middle row, and check-in → check-out
  dates plus the number of nights on the bottom row.
- Cards are quiet by default; **hovering or selecting** one reveals compact action buttons
  as a pill pinned to the bottom-right corner without changing the card's size, and
  truncated fields show their full text on hover. **Clicking outside** any card (empty
  panel or map background) clears the selection.
- **Map drawing rules**: transport-colored lines for segments and 🏨 pins for hotels;
  plan legs solid with a halo, available legs dashed, overlapping legs hidden (drawn
  thin/dashed/red only when selected); available hotels are faded and plan hotels are
  filled; the legend auto-relocates to the emptiest map corner.
- **Plan building**: auto-generated gap rows (time + distance) between consecutive
  records, long-layover and impossible-connection warnings, and a totals footer
  (legs, nights, span, cost).

These behaviours are the specification the native GUI mirrors; see the repository
root [`README.md`](../../README.md) for the full design write-up.

## Requirements

- A modern web browser.
- **Internet access** — Leaflet (`unpkg`) and the CARTO map tiles are loaded from
  CDNs at runtime.

## How to run

The prototype is a single static file (`index.html`). Serving it over a local HTTP
server is recommended (some browsers restrict `file://` origins):

```bash
# from the repository root
cd design/prototype
python3 -m http.server 8137 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8137/> in your browser.

Any static server works just as well, for example:

```bash
npx serve design/prototype      # Node.js
```

Or simply open the file directly (needs internet for the CDN assets):

```bash
open design/prototype/index.html        # macOS
xdg-open design/prototype/index.html    # Linux
```

## Notes

- All data is in-memory sample data defined at the top of the `<script>` block in
  `index.html`; edits are not persisted.
- This prototype intentionally lives under `design/` and is independent of the Rust
  build — it will never be compiled or shipped as part of the application binary.
