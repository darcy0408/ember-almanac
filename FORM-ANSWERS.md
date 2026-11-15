# Space Apps project page: text to paste, field by field

## Project Name

Ember Almanac

## High-Level Project Summary

Fire reports compare this year with past years, but the satellites behind the count are changing: MODIS is near the end of its life and Suomi NPP stopped delivering data on 2 November 2026. A higher count can mean more fire, or just a different sensor. Ember Almanac puts MODIS and VIIRS detections from NASA FIRMS on one ~1 km grid and one local-day calendar, then asks a plain question for any place: is fire activity up or down, and do the satellites agree? For seven example counties it shows 13 years of history as a calendar, compares each sensor with its own long-term average, and tests the harmonization on years it was not fitted to, reporting the result as measured. A live explorer builds the same calendar for any US county or any box drawn on the map. It is for people who prepare regional fire and smoke reports and have to defend the number.

## Link to Project Demo

(paste your public video link here)

## Link to Final Project

https://web-production-8baef68a.up.railway.app

## Detailed Project Description

Code: https://github.com/darcy0408/ember-almanac

WHAT IT DOES

- Historical calendar. Year-by-week heatmap of cells with detected fire since 2013, per sensor, with missing data shown as missing rather than zero.
- Is this year unusual? The last complete year against the earlier average, stated separately for MODIS (Terra + Aqua) and VIIRS (Suomi NPP), with a verdict on whether the two agree.
- Evidence. Raw detections per year; both sensors indexed to their own average; a table of how far apart the sensors are before and after gridding; and a leave-one-year-out test of a single scale factor.
- Live explorer. Daily calendar, map of ~1 km cells coloured by which sensors saw them, sensor agreement over time, data table and CSV, for any US county or drawn box and up to a year of dates.

HOW THE HARMONIZATION WORKS

1. Snap every detection to a ~1 km cell (the coarser MODIS footprint); count each cell once per day.
2. Use local solar days, because UTC days split the afternoon burn peak in the Americas.
3. Map MODIS confidence (0–100) to the VIIRS low / nominal / high classes.
4. Take fire radiative power from the strongest single overpass per sensor, then the larger sensor.
5. Treat a cell as seen by both sensors if the other fired in that cell or a neighbouring one that day.
6. Compare years only within a sensor whose satellites did not change (MODIS; Suomi NPP), because the combined count rises as the VIIRS fleet grew from one satellite to three.

WHAT WE FOUND (seven counties, 2013–2025)

- Chase County, Kansas (prairie burning): April was the peak month every year. VIIRS reported 3.5 detections per MODIS detection; on the shared grid that fell to 1.8. The sensors moved in the same direction in 11 of 12 year-to-year changes.
- Mesa County, Colorado (wildfire): 2018, 2020 and 2025 stand far above the rest in both sensors. Same direction in 10 of 12 changes.
- Maricopa County, Arizona (Phoenix): 2019 and 2020 dominate in both sensors. Same direction in 11 of 12 changes. 2025 below average by both.
- Butte County, California (Paradise, 2018 Camp Fire): 2018 and 2020 dominate in both sensors. Same direction in 10 of 12 changes. For 2025 the sensors disagree, so the page says the direction is not established.
- Brevard County, Florida (prescribed burning): a steady record. Same direction in 10 of 12 changes.
- Los Angeles County, California (a hard case): VIIRS reported 12.8 detections per MODIS detection, three to four times the ratio elsewhere, with detections on about nine days in ten. Our reading, not checked against individual detections, is that VIIRS picks up permanent heat sources in a large metro that MODIS mostly misses. A hot spot is not always a fire.
- Multnomah County, Oregon (a hard case): MODIS recorded 0 to 3 detections in every year except 2017. With counts that small the comparison breaks down, and the page flags it instead of presenting a trend.

Across the seven counties, counting on a shared grid lowers the VIIRS-to-MODIS ratio in every one, and the two records move in the same direction in at least 10 of 12 year-to-year changes in six of seven. The held-out test is mixed: it favoured the grid in two counties (Chase narrowly, Brevard), favoured raw counts in three (Mesa, Maricopa, Butte), and was poor or failed for both measures in two (Los Angeles, Multnomah). So the grid makes the two records comparable in level, but it does not by itself make one predict the other better. We report this as measured.

LIMITS

- A detection is heat consistent with fire in a pixel, not burned area. Cloud and smoke hide fires.
- Sensitivity, overpass time and cloud at overpass still differ between sensors after gridding.
- Small counties with few detections give percentages that swing widely; the page says so.
- The multi-year view exists for any county, but it takes 30 to 60 minutes of FIRMS downloads per county, so the app ships with a set already built. The live explorer covers up to 12 months.
- The live explorer runs on a hosted server with one FIRMS key, so many visitors at once can hit the FIRMS transaction limit for a few minutes. The examples are precomputed and always load.

TOOLS

JavaScript: a Node.js server with no dependencies, and a no-build web page using Leaflet and topojson-client. Hosted on Railway; a static copy of the examples is on GitHub Pages.

## Use of AI tools (the form may call this "Super Intelligence (SI)")

Yes. The code, tests and documentation were written with Claude Code (Anthropic's Claude), directed and reviewed by me, and this is stated in the repository README and in the commit metadata. I also used AI assistants to discuss and narrow the project's scope and to help draft this text. The demo video is a screen recording of the real app, captured by a script, with my own voice. No AI-generated images, audio or data are used: every number shown comes from NASA FIRMS.

## NASA Data

NASA FIRMS (Fire Information for Resource Management System) active fire data: MODIS Collection 6.1 (Terra and Aqua) and VIIRS 375 m (Suomi NPP, NOAA-20, NOAA-21), standard-quality archive where available and near-real-time for recent months, retrieved through the FIRMS area API and the FIRMS data-availability API.

## Space Agency Partner Data and Other References

- US Census Bureau county boundaries, via the us-atlas package
- OpenStreetMap map tiles (© OpenStreetMap contributors)
- Leaflet (map library)
- topojson-client
- Node.js
- Claude Code (Anthropic), used to write the code
- Railway and GitHub Pages (hosting)
