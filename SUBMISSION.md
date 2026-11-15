# Ember Almanac — submission draft

Draft text for the Space Apps project page. Edit freely; every number below comes from the
precomputed example files in `public/data/` and can be re-derived with `scripts/build-example.mjs`.

Live app: https://web-production-8baef68a.up.railway.app
Code: https://github.com/darcy0408/ember-almanac

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

## What we found (Mesa County, Colorado, 2013–2025)

- A wildfire-driven record rather than a seasonal one: 2018, 2020 and 2025 stand far above the rest.
- VIIRS reported a median of 3.8 detections for every MODIS detection (range 1.5–6.3).
- The sensors moved in the same direction in 10 of 12 year-to-year changes (rank correlation 0.90).
- Here the held-out test did not favour the grid: median error 20% for raw detections against 23%
  for cell-days. Gridding is not a guaranteed improvement, and the page reports it either way.
- 2025 was far above average by both sensors (MODIS about six times its average, VIIRS about five).

## What we found (Maricopa County, Arizona, 2013–2025)

- The Phoenix area: a record dominated by two years, 2019 and 2020, which both sensors show at
  roughly two to three and a half times their own average.
- VIIRS reported a median of 4.0 detections for every MODIS detection (range 1.9–6.1).
- The sensors moved in the same direction in 11 of 12 year-to-year changes (rank correlation 0.94).
- The held-out test did not favour the grid here: median error 12% for raw detections against 35%
  for cell-days.
- 2025 was below average by both sensors (MODIS −65%, VIIRS −37%), and so is 2026 through
  1 November (MODIS −67%, VIIRS −36%).

## What we found (Butte County, California, 2013–2025)

- Home of Paradise and the 2018 Camp Fire. Two years dominate, 2018 and 2020, and both sensors
  show them: MODIS 1,180 and 1,101 detections, VIIRS 4,984 and 4,555, against a few hundred in
  most other years.
- VIIRS reported a median of 3.1 detections for every MODIS detection (range 1.0–4.2). The low end
  is 2024, when the two counts were nearly equal (605 and 607); we have not traced why.
- The sensors moved in the same direction in 10 of 12 year-to-year changes (rank correlation 0.91).
- The held-out test did not favour the grid: median error 18% for raw detections against 29% for
  cell-days.
- For 2025 the sensors disagree (MODIS −38%, VIIRS −1%), so the page says the direction is not
  established. For 2026 through 1 November both are below average (MODIS −65%, VIIRS −27%).

## What we found (Los Angeles County, California, 2013–2025)

- A second hard case, for a different reason than Multnomah. VIIRS reported a median of 12.8
  detections for every MODIS detection (range 5.1–54.3), three to four times the ratio elsewhere,
  and some sensor reported a detection on 4,438 days, close to nine days in ten.
- Wildfire does not burn nine days in ten. Our reading, not checked against individual detections,
  is that VIIRS picks up permanent heat sources in a large metro (industrial sites, for example)
  that MODIS mostly misses. A hot spot is not always a fire.
- The sensors still moved in the same direction in 10 of 12 year-to-year changes (rank correlation
  0.81), but the held-out test is poor for both measures (75% raw, 74% cell-days).
- 2025 was above average by both sensors (MODIS +47%, VIIRS +11%); 2026 through 1 November is
  below average by both (MODIS −58%, VIIRS −12%).

## What we found (Brevard County, Florida, 2013–2025)

- A steady record with no single dominant year, typical of frequent prescribed burning.
- VIIRS reported a median of 3.2 detections for every MODIS detection (range 2.4–4.7).
- The sensors moved in the same direction in 10 of 12 year-to-year changes (rank correlation 0.86).
- Here the held-out test favoured the grid: median error 6% for cell-days against 12% for raw detections.
- For 2025 the sensors disagree (MODIS −13%, VIIRS +27%), so the page says the direction is not
  established. For 2026 through 1 November both are below average (MODIS −51%, VIIRS −37%).

## What we found (Multnomah County, Oregon, 2013–2025)

- A deliberate hard case: MODIS recorded between 0 and 3 detections in every year except 2017
  (62, the Eagle Creek fire), while VIIRS recorded 16 to 48 in those same years.
- With counts that small the comparison breaks down: the sensors moved together in only 4 of 12
  year-to-year changes (rank correlation 0.12), and the held-out test fails for both measures.
- The page flags the small counts instead of presenting a trend. The one clear signal, 2017, shows
  in both sensors.

Across the seven counties, counting on a shared grid lowers the VIIRS-to-MODIS ratio in every one,
and the two records move in the same direction in at least 10 of 12 year-to-year changes in six of
seven. The held-out test is mixed: it favoured the grid in two counties (Chase narrowly, Brevard),
favoured raw counts in three (Mesa, Maricopa, Butte), and was poor or failed for both measures in
two (Los Angeles, Multnomah). So the grid makes the two records comparable in level, but it does
not by itself make one predict the other better.

## Limits

- A detection is heat consistent with fire in a pixel, not burned area. Cloud and smoke hide fires.
- Sensitivity, overpass time and cloud at overpass still differ between sensors after gridding.
- Small counties with few detections give percentages that swing widely; the page says so.
- The multi-year view exists for any county, but it takes 30 to 60 minutes of FIRMS downloads per
  county, so the app ships with a set already built. The live explorer covers up to 12 months.
- The live explorer runs on a hosted server with one FIRMS key, so many visitors at once can hit the
  FIRMS transaction limit for a few minutes. The examples are precomputed and always load.

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
