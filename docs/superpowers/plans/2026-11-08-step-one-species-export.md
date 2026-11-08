# Step-one species list exports

**Goal:** After identifying every available best contact in step 1, export the unique identified species/categories as CSV and JPEG, with only scientific and vernacular names. Additional manual checks need not be complete.

**Scope and data:** Use actual current human decisions on the current best contacts, including corrected identifications. Resolve and deduplicate recognized aliases with the same catalog as the final activity table; retain explicit NoID/groups/free labels as the final table does, and exclude Noise. Do not use unreviewed AUTO-ID, non-best contacts, SEMIMANUAL ID or prorata. An unresolved or incomplete best identification disables these exports; an unresolved non-best contact does not. Criteria changes use the new best selection immediately. No eligible best means unavailable; completed bests all corrected to Noise allow an explicit empty list.

**Presentation:** A small export block next to the step-1 next button and another above the additional-controls list. Buttons CSV and JPEG; a short readiness/method message. CSV has exactly Nom scientifique and Nom vernaculaire, UTF-8 BOM/semicolon/quoted safe text. JPEG resembles the final table with two columns, complete wrapped names, source filename and a provisional stage-1 note; no contact totals or contact-count column. Existing final table exports stay unchanged.

**Architecture:** New step-one-species.js data module `build(imported,decisions,settings)` reconstructs the best selection freshly and returns `{ready,rows,pendingBestIndices,hasBestContacts,bestIndices,noBestGroupKeys,selectionSignature}`. Rows `{scientificName,frenchName,isSpecies}` only. Add dedicated `namesCsv`, `namesTableSvg`, `exportNamesTable` to final-summary-visuals.js using its existing render/rasterization helpers. New step-one-species-ui.js handles readiness, downloads and stale export cancellation with `init({document,getData})` -> `{refresh,reset}`. Root supplies current source, decisions and saved settings, plus filename/sourceVersion. No new dependencies or server/admin requirements.

## Tasks

- [x] Data tests first: corrected IDs, alias deduplication, Noise/NoID/groups, gates, source/manual vs calculated IDs, ranking changes and input immutability.
- [x] Visuals tests first: exactly two safe CSV columns and two JPEG-source SVG columns, no effects/total, long names and escaping; preserve final three-column exports.
- [x] UI/controller tests first: unavailable before step 1, enabled before supplementary completion, live updates/reset and async cancellation; wire both locations and bundle.
- [x] Independent review, full tests and standalone verification; update v22 and its manifest without a ZIP.

**Verification:** 537 Node tests pass. The real HTML buttons/controllers/data/CSV pipeline exports a corrected species with exactly two columns while supplementary checks remain unfinished. Independent review found no issue. All 32 standalone scripts parse; browser UMD modules build the corrected list and produce two-column CSV/SVG, whose XML is valid. The v22 standalone matches root and all nine manifest hashes verify. No new ZIP. Browser visual inspection remains unavailable because of the local-file URL policy; no alternate browser access attempted.

**Review focus:** AUTO-ID reappearing after a corrected decision; later sampling changing the step-1 list; deferred best treated as complete; formula/markup injection; obsolete JPEG downloaded after new import/settings.
