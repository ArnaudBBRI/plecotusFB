# Contact timeline implementation plan

**Goal:** Add a chronological contact-count graph to the imported file summary.

**User choice:** Full chronology using each contact's date and time, rather than a daily time-of-day aggregate. A line chart is authorized; use a lightly filled line with a zero-based count axis.

**Architecture:** Local UMD modules, SVG, no additional dependencies or network access. A data module reads source DATE/TIME and builds contiguous count bins. A chart/UI module displays and exports that result. The existing import controller only supplies the current imported file.

**Constraints:** Update v22 in place, no ZIP, no installation or administrator rights. Preserve imported cells, decisions, settings, existing chart filters and exports. Hourly intervals by default, automatically coarser above 720 bins. Show the interval and exclusions. Exclude source AUTO-ID Noise, include unclassified and NoID, and explain when AUTO-ID is absent. Never interpret DATE-12 as the calendar date. Preserve source clock values without browser timezone conversion.

## Tasks

- [x] Data: tests first for ISO dates, European day-month-year (2-digit year pivot 70), valid dates, midnight, missing/invalid values, source Noise, all-zero gaps, Excel serials/calendars and resumed Excel CSV metadata. Implement `timeline-data.js` exporting `build(imported)`.
- [x] Chart/UI: tests first for proportional geometry, real date/time labels, one bin, empty inputs, many days, escaped strings, hover/focus details and exports. Implement `timeline-chart.js`, `timeline-ui.js`, `timeline.css`.
- [x] Integration: add the card below the existing distribution, load/bundle modules, invoke the UI after every successful import, reset it on a new file. Tests cover the actual import controller and a second import. Document interval semantics (counts, not recording effort), missing timestamps and offline use.
- [x] Review and verification: independent review, full Node suite, real CSV fixture counts, standalone script parsing and local assets, synchronize v22 and verify its manifest. No commit or archive requested.

**Verification:** 484 Node tests pass. Four real CSV hourly vectors and both XLSX calendars round-trip correctly. All 28 standalone scripts parse; embedded browser modules reproduce the real 15,840-contact chronology, and the SVG parses as XML. The packaged v22 matches the root standalone and all nine manifest hashes verify. Browser visual inspection was blocked by its local-file URL policy; no alternate browser access attempted.

## Data contract

`PlecotusTimelineData.build(imported)` returns `{bins, intervalMs, total, sourceContacts, noiseCount, invalidDateTimeCount, hasAutoId, missingColumns, start, end}`. Bins are `{start, end, contacts}` in ascending synthetic UTC milliseconds representing the source wall clock; include every intervening zero-count bin. `start` is the first bin start, `end` is the last bin end; both null for no dated contacts. Counts refer only to contacts with valid dates and times. `noiseCount` is null if AUTO-ID is absent, otherwise the source Noise count. Use ISO YYYY-MM-DD, DD-MM-YY/YYYY, DD/MM/YY/YYYY, HH:MM[:SS[.sss]], and Excel numeric dates/times only with Excel metadata. Reject invalid dates/times rather than guessing. One-hour bins, then 3h/6h/12h/24h/48h/7d/30d or larger explicit whole-day intervals to stay within 720 bins.

## Review focus

1. Day/month inversions and two-digit years; never infer from filename.
2. UTC/DST and midnight: source clocks must stay unchanged.
3. DATE-12 alone and invalid/missing timestamps: transparent exclusions, no invented data.
4. Large gaps and input order: chronological contiguous bins, bounded SVG size, count conservation.
5. Import reset and standalone packaging: no stale previous-file chart or network dependency.
