# Sequential re-review of unresolved identifications

**Goal:** Easily review every Identification incertaine/non résolue contact one at a time, using existing contact decisions, audio opening, chronological context and comments.

**UI:** Revoir un par un in the existing Identifications à reprendre panel opens a single-card pass. Previous/Next, progress and a return-to-list button. Keep the original pass queue after resolution, so Previous can revisit completed contacts. A completed decision or explicit À revoir action moves forward once; Next leaves an unresolved contact unchanged. End-of-pass summary distinguishes finished review from still unresolved contacts and allows another pass over remaining items. No automatic audio launch.

**State:** Snapshot source recordIndex/contact/group metadata from all plan.unresolvedContacts (including Noise/imported uncertainty), merge newly deferred contacts without duplicates, read live decisions for completion. Queue survives removals from the live unresolved list but resets on a new import. Comments/IDs persist through existing model/CSV. Reuse createManualContactCard rather than implementing another decision form.

**Important:** In this pass, Invalider opens the real-ID selector while retaining unresolved until a completed identification is chosen. This prevents incomplete attempts disappearing from CSV-resumable unresolved work, especially Noise contacts outside normal groups. Confirming an empty/pending AUTO-ID also keeps unresolved and requests a real identification. A simple refresh never advances: root explicitly calls afterDecision for user actions. Root focus fallbacks must defer to the pass when its card is replaced.

**Module:** unresolved-review-ui.js, global PlecotusUnresolvedReviewUI.init({document,getItems,getSource,isComplete,renderContactCard,onStateChange}) -> {show,refresh,afterDecision,hide,reset,isActive,focus}. Items {recordIndex,contact,label}; root supplies live plan and human completion predicate. afterDecision(index,{deferred}) advances only if current index and complete or explicit deferred. Dedicated CSS in unresolved-review.css. Root manages outer panel/list visibility through onStateChange.

**DOM IDs:** unresolved-pass-start; unresolved-pass (hidden section); unresolved-pass-heading; unresolved-pass-progress; unresolved-pass-card; unresolved-pass-previous; unresolved-pass-next; unresolved-pass-restart; unresolved-pass-close; unresolved-pass-status. renderContactCard(contact,label) returns the existing review article; the sequential module marks it with data-unresolved-pass=true. No duplicated decision UI.

- [x] UI/state tests first: snapshot/history, single card, previous/next, completed/deferred advance once, no refresh advance, remaining-pass restart, source reset and safe rendering.
- [x] Integration tests first: existing cards, completion/NoID/correction/invalidation, source uncertain/Noise, comments/WAV/context, focus and finalization gates; wire welcome/index/bundle.
- [x] Independent real-model review, full tests, standalone verification, v22 sync and manifest; no ZIP.

**Verification:** 567 Node tests pass, including real Workflow/Decisions/Results regression tests and full welcome-controller integration. Confirmed original AUTO-ID visible, comments retained, no automatic audio launch, correct WAV/Context indices, completed history, repeated deferral, source uncertainty/Noise CSV preservation and stale-card guards. Focus regressions for completed-pass close and final-summary close were reproduced and fixed via onExit. All 33 standalone scripts parse, controls/CSS/browser module are bundled, root/v22 HTML matches and nine manifest hashes verify. No ZIP created; browser visual inspection remains unavailable because of local-file policy.

**Review focus:** Invalidation skipped prematurely; filtered source Noise omitted; comments lost by card rebuild; auto advance caused by unrelated updates; stale card changing the next import; finalization incorrectly unlocked.
