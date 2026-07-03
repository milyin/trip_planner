# Trip Planner — interactive GUI design prototype

A self-contained, clickable HTML mock-up of the Trip Planner desktop UI. It is a
**design reference** for the native `iced` application (see the crates in the repo
root) — it is not wired to the real backend, it just uses in-memory sample data so
the look, layout, and interactions can be evaluated quickly in a browser.

## What it demonstrates

- **Three-panel layout**: Routes · Plan · zoomable world map (Leaflet).
- **Day / night theme** toggle (also swaps the map tiles).
- **Add / edit / delete** routes through a modal dialog.
- **Move routes** between Routes and Plan (buttons, drag-and-drop, double-click to edit).
- **Map drawing rules**: transport-colored lines; plan legs solid with a halo,
  available legs dashed, overlapping legs hidden (drawn thin/dashed/red only when
  selected); the legend auto-relocates to the emptiest map corner.
- **Plan building**: auto-generated gap rows (time + distance), long-layover and
  impossible-connection warnings, and a totals footer (legs, span, cost).

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
