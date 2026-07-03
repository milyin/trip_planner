# trip_planner

Rust desktop trip planner built with a replaceable backend/frontend split. The current GUI uses [`iced`](https://iced.rs/), while route rules, storage, geocoding, and plan generation live outside the GUI.

## Features

- Add, edit, remove, and list travel routes.
- Store routes locally in SQLite.
- Model routes as departure and arrival stops, transport, optional company, and money.
- Geocode places with the Rust `geocoding` crate through an isolated provider trait.
- Build a non-overlapping route plan interactively.
- Grey out routes that overlap already selected plan routes.
- Generate gap rows between selected routes with elapsed time and distance when coordinates are available.
- Prepare storage for future route screenshot attachments.

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

The application creates `trip_planner.sqlite3` in the working directory and seeds the Marseille/Paris/Madrid example routes on first launch.

## Test

```bash
cargo test
```

## Initial interface

The desktop shell uses a three-panel layout:

- **Routes**: all stored routes with selectable, selected, or disabled status.
- **Plan**: selected non-overlapping route rows plus generated gap rows.
- **Map**: geocoded route markers and route-line coordinates.

A bottom editor stays visible for route CRUD and geocoding actions. Screenshot drag-and-drop is intentionally not mixed into the core route model yet; the storage schema already has a route screenshot table for the next implementation step.
