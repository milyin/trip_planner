# Trip Planner

Plan a multi-leg trip by hand — pick the flights, trains, buses and hotel stays
you want, arrange them into a single itinerary, and see the whole thing on a map.
Trip Planner checks that your connections actually work, adds up the time and
cost, and keeps everything in your browser so there's nothing to install and no
account to create.

**Open the app:** https://milyin.github.io/trip_planner/

## What it's for

You gather a pool of candidate options — a morning flight and an afternoon one, a
couple of hotels, a train for the last leg — and then compose the ones you like
into a plan. As you build the plan, the app makes sure the pieces fit: it hides
options that clash in time with what you've already chosen, flags connections
that are too tight to make, and tells you when you've left an overnight gap with
no hotel. It's a planning tool for a trip you're still designing, not a booking
site.

## The three panels

- **Segments** — your pool of options: transport legs (a single ride from A to B)
  and hotel stays you've added but not yet committed to.
- **Plan** — the itinerary you're building, in order. Between each pair of items
  the app inserts a row showing the elapsed time, the distance, and whether the
  connection is feasible.
- **Map** — every place in your plan and pool, drawn as coloured lines and pins.

On a phone the three panels become a bottom tab bar — tap **Segments**, **Plan**,
or **Map** to switch. The selected tab is highlighted.

## Building a plan

- **Add a leg or a hotel** with the buttons in the Segments panel header (or the
  ☰ menu). Fill in the cities, times, and price in the dialog.
- **Add an item to the plan** by pressing **→** on its card. The moment you do,
  any other option whose time overlaps it is greyed out — you can't pick two
  things that happen at once.
- **Drag** cards between the Segments and Plan panels, or **remove** a planned
  item with **↩** to put it back in the pool.
- **Fill a gap in one click.** When two consecutive plan items leave an overnight
  gap in one city, the row between them offers **🏨 Add hotel**; when they're far
  apart with no connection, it offers **🧭 Add leg**. Either one opens the dialog
  already filled in from the surrounding items.
- **Read the totals** at the bottom of the Plan: number of legs, nights, total
  duration, cost per currency, and whether every connection works.

### How connections are checked

Between two plan items the app compares the time you have against the time you
need. A connection is flagged **impossible** (red) when there isn't enough time
to make the next departure, and **long layover** (yellow) when you're waiting
more than eight hours. How much lead time each mode needs before departure:

| Transport | Buffer before departure |
|-----------|-------------------------|
| Plane     | 2 hours                 |
| Train     | 20 minutes              |
| Bus       | 15 minutes              |
| Taxi      | 5 minutes               |
| Car       | 5 minutes               |
| Other     | 30 minutes              |

Hotels don't need a buffer and never clash with anything.

## The map

- Each transport mode has its own colour, shared between its icon and its line.
  Planned legs are drawn solid; options still in the pool are dashed; the one you
  have selected gets a highlighted border.
- **Show or hide the pool.** The 👁 button in the Segments header toggles whether
  the dashed pool options appear on the map, so you can declutter down to just
  your plan.
- **Fit** frames everything with the ⤢ button, and the app fits the map to your
  trip automatically when it opens.
- Pan by dragging, zoom with the **+ / −** buttons or the scroll wheel.

## Reading a screenshot instead of typing (optional)

Adding legs and hotels by hand always works. If you'd rather not type, you can
hand the app a **screenshot** — a flight or train search result, a timetable, a
hotel listing, a booking confirmation — and have it fill in the fields for you.

Open the **Recognize** tab in the add dialog, drop in one or more screenshots
(and optionally a note like "the 20:09 direct train"), and press **Recognise**.
The app reads the cities, times, dates, price, carrier, and so on, and drops them
into the form. You always review and edit before saving — nothing is added
without your say-so.

Reading screenshots is powered by an AI model, which you configure once (below).
Everything else in the app works with no model at all.

## Setting up screenshot recognition

Open **⚙ LLM configuration** from the ☰ menu. You add an **account** (a provider
plus your API key) and a **parser** (which model on that account to use). Your
keys are stored only in this browser and are never sent anywhere except to the
provider you chose.

Supported providers:

- **OpenRouter** — the recommended starting point. It's stable and inexpensive
  with the `openai/gpt-4o-mini` model, and the same account reaches OpenAI's GPT
  models, Claude, Gemini and hundreds of others through one key. Get a key at
  openrouter.ai/keys.
- **Claude (Anthropic)** — direct access to Claude models. Get a key at
  console.anthropic.com.
- **Gemini (Google)** — get a key at aistudio.google.com.

You can keep several accounts and parsers and switch between them in the add
dialog. If you never set one up, the app still does everything else — you just
enter trip details yourself.

## Your data stays with you

Trip Planner has no server. Your trips, your screenshots, and your API keys all
live in your browser's local storage and never leave your device except when a
screenshot is sent to the recognition provider you configured.

- **Workspaces** let you keep separate trips side by side. Create, rename, and
  switch between them from the ☰ menu.
- **Share a plan** with **🔗 Share workspace** in the ☰ menu. It copies a link
  that carries the whole plan inside the URL — no server, no upload. Whoever
  opens it gets their own editable copy. A shared link opens showing just the
  plan (the pool is hidden) on the Plan tab.

## Day and night themes

Switch between light and dark from the ☰ menu; the map tiles change to match.
A 📱 preview option renders the mobile layout inside a phone frame on desktop, so
you can check how the plan looks on a small screen.
