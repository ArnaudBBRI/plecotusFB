# Fixed ten-minute timeline and vertical chart sizing

**User request:** The contact timeline must use ten-minute intervals. Vertical charts with few contacts must retain a normal size.

**Diagnosis:** Timeline currently widens hourly intervals automatically. The vertical chart uses a 360×340 viewBox for one/two species and width:100%/height:auto; in a 1200px container this creates an approximately 1133px-high SVG and wide columns.

**Decisions:** Use fixed 600000ms bins aligned to clock multiples of ten minutes, including empty results. No automatic widening. Keep dense bins up to 720; for longer spans preserve every occupied bin and zero bins at the beginning/end of empty runs, with true timestamp spacing. Add binCount/sparse metadata; compressed gaps only link zero-valued endpoints, so no contacts or occupied intervals are merged. Shared timestamp reader and source-clock/noise rules stay unchanged. Render vertical charts in a 340px-high SVG viewport with max64-unit centered bars, preserving narrow-screen horizontal scrolling and all legends.

- [x] Data/chart tests first: ten-minute boundaries, midnight, calendar parsing, exact counts, sparse long gaps and source timestamps; update timeline-data.js/timeline-chart.js.
- [x] Independent ten-minute oracles and Excel-resume regressions; update timeline regression/UI fixtures.
- [x] Reproduce oversized SVG numerically at multiple container widths, then fix chart CSS/column geometry and retain filters/export/axis behavior.
- [x] Update docs and actual import/export assertions; independent review, full suite and standalone checks; synchronize v22 and manifest, no ZIP.

**Verification:** 548 Node tests pass. Four real CSV ten-minute vectors match independent hashes; Excel 1900/1904 resumes keep the same bins. The original 1133px-height case is reproduced before correction and tested at container widths 280/480/1200/2000 with 1/2/31 species and filtering. Long-date-span data keeps exact occupied bins without allocating empty centuries. All 32 standalone scripts parse and embedded browser modules reproduce the 61-bin, 15,840-contact real example. Root/v22 files match and nine package hashes verify. Browser visual inspection remains blocked by the local-file policy; no alternate surface used.

**Review focus:** Silent coarsening; memory growth across empty years; lines crossing gaps with invented activity; wrong count/clock after rebinning; large height or column width after filtering to one species; regression of the previous unfilled-axis fix.
