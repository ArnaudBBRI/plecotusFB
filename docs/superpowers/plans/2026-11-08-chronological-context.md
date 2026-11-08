# Chronological listening context

**Goal:** A small Contexte button next to each review WAV opens a floating table of its 10 preceding and 10 following contacts, with the original contact highlighted yellow. WAV buttons use the configured audio application.

**User choices:** Include every source contact, including other species and Noise. Keep the original contact highlighted when listening to another row. A maximum of 10 rows on each side, fewer at file boundaries. Add date/time alongside the requested WAV, AUTO-ID, MATCH RATIO, PULSES and MANUAL ID to make the chronological order clear.

**Architecture:** Existing local UMD modules and standard DOM/CSS, no dependencies. Extend timeline-data with a source timestamp reader and reuse the same ISO/European/Excel parsing. Build/cache a stable chronological index once per imported table; tie-break identical timestamps by source index. Resolve manual IDs freshly from current decisions on every open/refresh; do not show SEMIMANUAL ID or prorata as manual work.

**UI:** One modeless floating panel (role=dialog, aria-modal=false), explicit close button and Escape from within the panel, focus return to the opener, scrollable compact table and responsive maximum viewport size. Reference row has yellow background, a text marker and aria-current. Opening neighboring WAVs does not change decisions or move the reference. Do not add editing controls or a second review workflow. The modeless panel allows the existing settings dialog to open if the viewer needs configuration.

**Data:** Preserve recordIndex, source row, raw WAV/AUTO-ID/ratio/pulses and a formatted source timestamp. Include Noise and duplicates as separate contacts. Exclude undated contacts from chronological neighbors and explain the count; an undated reference remains visible alone with an explanation. Never guess chronology from filename, DATE-12 or row order. Preserve source clocks without timezone conversion.

## Tasks

- [x] Tests first: shared timestamp API, stable chronology, boundaries, duplicates, invalid dates, Excel calendars and fresh decision precedence. Implement contact-context-data.js and the small timeline-data API extension.
- [x] Tests first: floating panel, safe DOM table, yellow original reference, close/focus, WAV callback with exact source index, refresh and reset. Implement contact-context-ui.js and contact-context.css.
- [x] Tests first: attach the button in the shared review-card renderer (step 1, supplementary controls, deferred panel), reuse wavOpening.openContact, refresh when decisions change and close on a new import. Update index.html and bundle.cjs.
- [x] Independent review, meaningful full tests and standalone checks. Update v22 in place, documentation and manifest. No new ZIP, installation or administrator access.

**Verification:** 505 Node tests pass. Independent integration tests use the real data/UI/decisions/WAV modules with only the local HTTP request intercepted, confirming exact paths for duplicated filenames, source capture, live manual IDs and modal settings access. All 30 standalone scripts parse; embedded browser modules return 21 exact source contacts and a fresh manual ID from the 26,070-contact example. Root and v22 standalone files match and all nine package hashes verify. No new ZIP created. Browser visual inspection remains unavailable because the local-file URL policy is blocked; no alternate browser surface was used.

**Review focus:** Wrong WAV when filenames repeat; obsolete decisions or source MANUAL ID reappearing after invalidation; reference changed on neighbor playback; missing/invalid timestamps mixed into chronology; stale panel after file changes. Browser local-file visual automation was previously blocked and will not be retried via another surface.
