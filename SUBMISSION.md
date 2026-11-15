# Ember Almanac — submission draft

Draft text for the Space Apps project page. Edit freely; every number below comes from the
precomputed example files in `public/data/` and can be re-derived with `scripts/build-example.mjs`.

## High-level summary (about 150 words)

Fire reports compare this year with past years, but the satellites behind the count are changing:
MODIS is near the end of its life and Suomi NPP stopped delivering data on 2 November 2026. A higher
count can mean more fire, or just a different sensor. Ember Almanac puts MODIS and VIIRS detections
from NASA FIRMS on one ~1 km grid and one local-day calendar, then asks a plain question for any
place: is fire activity up or down, and do the satellites agree? For example counties it shows 13
years of history as a calendar, compares each sensor with its own long-term average, and tests the
harmonization on years it was not fitted to, reporting the result as measured. A live explorer builds
the same calendar for any US county or any box drawn on the map. It is for people who prepare
regional fire and smoke reports and have to defend the number.

## What it does

- **Historical calendar.** Year-by-week heatmap of cells with detected fire since 2013, per sensor,
  with missing data shown as missing rather than zero.
- **Is this year unusual?** The last complete year against the earlier average, stated separately for
  MODIS (Terra + Aqua) and VIIRS (Suomi NPP), with a verdict on whether the two agree.
- **Evidence.** Raw detections per year; both sensors indexed to their own average; a table of how
  far apart the sensors are before and after gridding; and a leave-one-year-out test of a single
  scale factor.
- **Live explorer.** Daily calendar, map of ~1 km cells coloured by which sensors saw them, sensor
  agreement over time, data table and CSV, for any county or drawn box and up to a year of dates.

## How the harmonization works

1. Snap every detection to a ~1 km cell (the coarser MODIS footprint); count each cell once per day.
2. Use local solar days, because UTC days split the afternoon burn peak in the Americas.
3. Map MODIS confidence (0–100) to the VIIRS low / nominal / high classes.
4. Take fire radiative power from the strongest single overpass per sensor, then the larger sensor.
5. Treat a cell as seen by both sensors if the other fired in that cell or a neighbouring one that day.
6. Compare years only within a sensor whose satellites did not change (MODIS; Suomi NPP), because
   the combined count rises as the VIIRS fleet grew from one satellite to three.

## What we found (Chase County, Kansas, 2013–2025)

- April was the peak month in every one of the 14 years, and March plus April held more than 90% of
  the year's MODIS cell-days in every year except 2013 (a very quiet year for both sensors).
- VIIRS reported a median of 3.5 detections for every MODIS detection (range 1.3–5.1 across years).
- On the 1 km daily grid that ratio fell to 1.8 (range 1.1–2.8). Gridding narrows the gap; it does
  not close it, because VIIRS also detects smaller and cooler fires.
- The two sensors moved in the same direction in 11 of 12 year-to-year changes (rank correlation 0.93).
- Predicting each year's VIIRS count from MODIS with one scale factor fitted on the other years gave
  a median error of 13% for raw detections and 10% for cell-days: similar, slightly better gridded.
- 2025 was above average by both sensors (MODIS +26%, VIIRS +46%). For 2026 through 1 November the
  sensors disagree (MODIS −7%, VIIRS +26%), so the direction is not established.

(Add the other example counties here once their files are built.)

## Limits

- A detection is heat consistent with fire in a pixel, not burned area. Cloud and smoke hide fires.
- Sensitivity, overpass time and cloud at overpass still differ between sensors after gridding.
- Small counties with few detections give percentages that swing widely; the page says so.
- The live explorer needs a server with a FIRMS key; the public page serves precomputed examples.

## NASA data

NASA FIRMS active fire data: MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP,
NOAA-20, NOAA-21), standard-quality archive where available and near-real-time for recent months,
through the FIRMS area API and data-availability API.

## Other data and tools

US Census county boundaries (via the `us-atlas` package), OpenStreetMap tiles, Leaflet,
topojson-client. Node.js with no other dependencies.

## Use of AI

The code, tests and this text were written with Claude Code (Anthropic) during the event, directed
and reviewed by the team. No AI-generated data is used: every number shown comes from NASA FIRMS.
A sample-data mode exists for development only and is labelled on screen when active.

## 30-second demo

`demo/walkthrough.mp4` is a silent 30-second screen recording of the app (made by
`demo/record-walkthrough.mjs`). To add narration: `npm run demo`, open http://localhost:8799,
press "Record with my voice" and read the highlighted lines. The take downloads as a `.webm`
with picture and voice, ready to upload.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Clicks "Load example" | Fire counts get compared across years. But the satellites change. |
| 0:03 | Headline for Chase County | Ember Almanac asks: is fire up or down, and do the satellites agree? |
| 0:09 | Raw detections chart | Raw counts mislead: VIIRS sees three and a half times more than MODIS. |
| 0:13 | Indexed chart, then the table | On one shared grid, they move together in eleven of twelve years. |
| 0:18 | Historical calendar | Thirteen years as a calendar. In Chase County, Kansas, the burn season is April, every year. |
| 0:24 | Live calendar, a day clicked, map | And for any place you pick, a live daily calendar and map. |
