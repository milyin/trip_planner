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

### How local recognition works

Local recognition is a two-stage, non-LLM pipeline:

1. **Scribe.js OCR** runs in the browser and turns the screenshot or PDF into
   plain text. It uses the OCR languages selected in **Settings → Local parser**.
   The image and its raw OCR text stay on the device.
2. A **deterministic trip parser** (ordinary TypeScript code) searches that text
   and the optional Additional note for trip fields. It does not understand the
   image semantically and does not call an AI model.

The code parser recognizes common booking formats, including:

- ISO and day-first numeric dates, plus common month names and abbreviations in
  several European languages and Russian;
- 24-hour clocks written with a colon or dot, overnight arrivals, and durations
  that should not be mistaken for departure times;
- routes written as `from … to …`, locations beside departure/arrival times,
  common station names, and an unambiguous pair of IATA airport codes;
- common transport words for planes, trains, buses, taxis and cars, plus direct
  journeys and simple transfer counts;
- prices written with currency symbols, ISO codes, or common currency names,
  including decimal/thousands separators and Russian currency words;
- missing or corrected details supplied in the Additional note.

Recognized values are copied into the edit form for review. Missing required
values remain blank and are highlighted immediately; the app never saves an
incomplete leg. Airport/station identifiers are checked through the normal
OpenStreetMap Nominatim lookup. When that lookup returns a locality, the dialog
can fill the blank city while preserving the original identifier as the stop.
For example, `GVA → ORY` becomes `Geneva → Paris`, with `GVA` and `ORY` kept in
the airport fields.

### Local parsing limitations

Local OCR and code parsing are deliberately conservative. In particular:

- OCR quality depends on resolution, contrast, fonts, layout and the selected
  languages. Logos, icons, columns and small text can be read in the wrong order
  or as the wrong character. Adding languages increases download size, memory
  use and recognition time, and can sometimes introduce additional ambiguity.
- The parser works from flattened OCR text, not the visual relationships in the
  screenshot. It cannot reliably interpret every booking-site layout, fare
  condition, crossed-out price, passenger total or multi-column alternative.
- Transport parsing normally produces one leg. A screen containing several
  alternatives, connections, or more than two timetable-like times is rejected
  when the parser cannot choose safely. An Additional note can identify the
  intended departure or supply missing fields.
- Numeric dates are interpreted as day-first unless they are ISO `YYYY-MM-DD`.
  A missing year is assigned to the next matching future date. Truly ambiguous
  or unreadable dates are left blank rather than guessed.
- There is no bundled worldwide database of cities, airports, railway stations
  or bus stops. IATA recognition requires an unambiguous pair of three-letter
  codes; other names are extracted heuristically. City enrichment needs an
  internet connection and a matching OpenStreetMap result, and should always be
  reviewed by the user.
- Price extraction uses labels, currency tokens and line-level heuristics. When
  several unrelated prices remain plausible, the result may be incomplete or
  require correction. A missing price is reported and left blank.
- Simple hotel-shaped pasted images may be identified locally, but recognition
  started from an already-open hotel dialog is LLM-only. Complex hotel listings
  generally need manual entry or an LLM parser.

Useful partial results stay local for review. You can choose an LLM explicitly
if you believe OCR or parsing missed something. Automatic LLM fallback happens
only when the local parser finds no reliable trip structure—not merely because
some fields are absent.

## Setting up recognition

Open **⚙ Settings → Image recognition** from the ☰ menu. The first option
enables or disables local Scribe.js recognition. Below it, choose one configured LLM parser or
**No LLM parsing**. With Scribe.js enabled, the selected LLM handles definite
local failures and explicit retries; useful partial results are not sent
automatically. With Scribe.js disabled, files go directly to the selected LLM.
Local recognition needs no account or API key.

Choose the Tesseract models used for local OCR under **⚙ Settings → Local
parser**. English is enabled for existing installations; add Russian or any
other languages that may appear in booking images. Each model is downloaded
and cached on first use, and selecting more languages increases recognition
time. OCR language support controls text recognition; it does not add new
grammar or booking-layout knowledge to the deterministic trip parser.

To use an LLM, open **⚙ Settings → LLM Parsers**, add an **account** (a provider
plus your API key) and a **parser** (which model on that account to use), then
select that parser under **Image recognition**.
Your keys are stored only in this browser and are never sent anywhere except to
the provider you chose.

Supported providers:

- **OpenRouter** — the recommended starting point. It's stable and inexpensive
  with the `openai/gpt-4o-mini` model, and the same account reaches OpenAI's GPT
  models, Claude, Gemini and hundreds of others through one key. Get a key at
  openrouter.ai/keys.
- **Claude (Anthropic)** — direct access to Claude models. Get a key at
  console.anthropic.com.
- **Gemini (Google)** — get a key at aistudio.google.com.

You can keep several accounts and parsers while selecting one as the default.
If both Scribe.js and LLM parsing are disabled, the app explains that
recognition is unavailable and manual entry remains available.

The Recognize tab can use Local Scribe.js, the configured **Default Fallback**,
or any parser for that attempt without changing the default. A local attempt
keeps Local Scribe.js selected; choose an LLM explicitly for a remote retry.
Recognition started from an open hotel dialog is LLM-only. A pasted image may
still be inspected locally first to identify a partial hotel or leg result.

## Your data stays with you

Trip Planner has no server. Your trips, your screenshots, and your API keys all
live in your browser's local storage. A screenshot or PDF is sent to a configured
recognition provider when you explicitly choose an LLM parser, when Scribe.js is
disabled and an LLM is selected, when local recognition finds no usable trip
data and a Default Fallback is configured, or when you run the LLM-only hotel
recognition flow. Choosing **No LLM parsing** prevents automatic remote fallback.
The pinned Scribe.js browser engine and its OCR language data are downloaded and
cached on first use, but OCR itself runs in your browser. Place validation may
send only the recognized city, airport, station or stop text to OpenStreetMap
Nominatim; the screenshot and full OCR response are not included in that lookup.

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
