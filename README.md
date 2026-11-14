# Ember Almanac

One fire calendar for any place, built from MODIS and VIIRS satellite detections.

NASA Space Apps 2026 — challenge: *Harmonization of MODIS and VIIRS Hot Spots*.

Pick a US county or draw a box on the map, choose a date range, and get:

- a day-by-day calendar heatmap of fire activity,
- a map of the ~1 km grid cells that burned on any day, coloured by which sensors saw them,
- a chart of how often MODIS and VIIRS agree over time,
- a data table and CSV download of the daily series.

## Run it

Requires Node 22 or newer. There are no npm dependencies.

1. Get a free FIRMS MAP_KEY: https://firms.modaps.eosdis.nasa.gov/api/map_key/
2. Copy `.env.example` to `.env` and set `FIRMS_MAP_KEY`.
3. `npm start`, then open http://localhost:8787

`npm test` runs the unit tests (no network needed).

## How the harmonization works

MODIS (Terra, Aqua) reports fire pixels of about 1 km; VIIRS (Suomi NPP, NOAA-20, NOAA-21)
reports pixels of about 375 m. Counting raw detections makes VIIRS look several times more
active and counts a fire twice when both sensors see it. Ember Almanac instead:

1. **Uses one grid.** Every detection is snapped to a ~1 km cell, the coarser MODIS footprint.
   The headline metric is the number of distinct cells with fire per day; a cell counts once
   however many sensors or overpasses saw it.
2. **Tags agreement.** Each cell-day is *both*, *MODIS only* or *VIIRS only*. A cell counts as
   seen by both when the other sensor fired in that cell or an adjacent one the same day,
   because a MODIS pixel is often located one cell away from the VIIRS pixels of the same fire.
3. **Uses one confidence scale.** MODIS 0–100 is mapped to the VIIRS low / nominal / high
   classes (below 30, 30–79, 80 and up).
4. **Does not double count fire radiative power.** Within a cell, pixels from one overpass add;
   across overpasses the strongest one is kept; across sensors the larger value is kept.
5. **Uses local solar days.** FIRMS dates are UTC, which splits the afternoon burn peak in the
   Americas across two dates. Days are shifted by `round(longitude / 15)` hours.

The logic lives in `lib/harmonize.js`.

## How it is built

- `server.js` — a small Node server. It keeps the MAP_KEY off the client, serves `public/`,
  and answers `POST /api/calendar` and `GET /api/status`.
- `lib/firms-client.js` — splits a request into the 5-day chunks FIRMS allows, picks the
  standard-quality archive (`_SP`) or near-real-time (`_NRT`) source for each chunk from the
  FIRMS data-availability endpoint, and caches raw responses in `.cache/`.
- `lib/firms-csv.js`, `lib/geo.js` — CSV parsing and point-in-polygon for county shapes.
- `public/` — the page: plain ES modules, Leaflet for the map, no build step.

## Data and credits

- Fire detections: NASA FIRMS — MODIS Collection 6.1 and VIIRS 375 m active fire products.
  Suomi NPP stopped delivering data on 2 November 2026; later dates use NOAA-20, NOAA-21 and MODIS.
- County boundaries: US Census Bureau cartographic boundaries via the `us-atlas` package.
- Basemap: © OpenStreetMap contributors. Map library: Leaflet.

## Limits

- Active-fire detections are not burned area, and cloud or smoke can hide fires from both sensors.
- The one-cell agreement tolerance is a simple rule, not a per-pixel footprint model.
- County search covers the United States; drawn boxes work anywhere, up to 20° per side.
