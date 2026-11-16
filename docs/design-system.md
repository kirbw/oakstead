# Oakstead visual system

Keep the existing green identity, page layouts, navigation and dense desktop
gradebook. This system standardizes controls and feedback, not school terminology
or grading behavior. Shared server renderers live in `server/ui.js`; browser error
feedback uses `server/ui-feedback.js`. Both escape messages through text/HTML-safe
rendering. CSS is appended to the existing hashed stylesheet.

| Purpose | Tokens / rules |
| --- | --- |
| Surfaces and text | Existing bg/paper/ink/muted tokens; never hardcode white text on a dark-theme green button |
| Actions | accent/button-bg/button-ink; primary and secondary controls retain their existing roles |
| Feedback | status-success, status-warning, status-error; pair color with text and a symbol |
| Keyboard focus | focus-ring, visible 3px outline with offset; maintain gradebook Tab/Shift+Tab behavior |
| Spacing | space-1 through space-4: .25rem, .5rem, .75rem, 1rem |
| Controls | control-height 42px on desktop; touch-target 44px on coarse pointers or narrow screens |
| Corners and type | Existing radius and font family; font-small for supporting status text |

Use shared notice/empty/field/button renderers for new or changed controls.
Existing forms inherit shared control, focus, disabled and invalid styling without
changing their URLs, names or selected-record behavior. Labels remain explicitly
or implicitly associated. Server-rendered field errors use described-by links;
browser validation summaries mark fields invalid and preserve existing hints.

Empty states mean a successful read with no records. Failed reads show an alert
with a safe message, request ID and explicit retry while retaining the last view.
Do not substitute empty results for failures. Session loss offers sign-in in another
tab so pending work is retained. Mutation retries remain explicit.

Navigation announces loading and sets aria-busy. Forms announce saving while their
submit button retains its label/width. Error summaries span the full form width,
receive focus, list field errors and keep entered values. Autosave announces saving,
saved or failed; cell symbols accompany status color and rejected input values are
marked invalid. Grade-category colors and numeric/letter business rules remain unchanged.

Selected navigation exposes aria-current. Buttons/links/fields have visible focus;
mobile/coarse-pointer controls and grid rows have 44px targets while desktop grid
density is retained. Reduced-motion CSS disables transitions and save animations.
Narrow-screen tables scroll within their existing wrapper instead of squeezing
status labels and actions into unreadable columns; print layout is unaffected.
Verify keyboard navigation, mobile/desktop, both themes, and all three empty/loading/
error states for changed flows. To manually verify reduced motion, enable the OS
reduced-motion preference and confirm loading/save indicators do not animate.
