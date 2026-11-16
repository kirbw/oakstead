# Mobile layout review

Reviewed 2026-11-16 using current code and disposable, seeded demo data.

## Fixes

- Percentage badges stay on one line. At the reported 1074px width, `84.5%`
  previously occupied a 100px-high vertical badge; it now occupies 25px.
- The dashboard panels stack between 1040px and 1279px instead of squeezing the
  recent grades table. At 1280px the two-panel layout remains, with all averages
  visible. On phones, explicit table column sizes keep the averages visible without
  horizontal scrolling. Assignment titles and subject text can wrap normally.
- Tables that need more space scroll inside their wrapper at all screen sizes.
  Dashboard table scrolling has a keyboard-focusable, named region.
- The grade grid has its own stacking context. Its assignment headings cannot
  overlap the sticky mobile navigation, regardless of assignment count.
- Routes, permissions, grades, database schema and print-specific styling remain
  unchanged. No dependencies added.

## Checks

| CSS viewport | Main screens checked | Result |
| --- | --- | --- |
| 375 x 667 | All seven | No whole-page horizontal overflow |
| 390 x 844 | All seven | No whole-page horizontal overflow |
| 393 x 852 | All seven | No whole-page horizontal overflow |
| 414 x 896 | All seven | No whole-page horizontal overflow |
| 430 x 932 | All seven | No whole-page horizontal overflow |
| 440 x 956 | All seven | No whole-page horizontal overflow |
| 844 x 390, landscape | All seven | No whole-page horizontal overflow |

The seven screens are Dashboard, Assignments, Gradebook, Absences, Reports,
Report Card and School Setup. Actual inner viewport dimensions were recorded
after each resize settled; an initial unsynchronized resize pass was discarded.
All eleven demo-visible Setup sections were checked at 375 x 667: Families,
Districts, Congregations, Teachers, Classrooms, Subjects, Years, Weights, Letter
Grades, Users and Settings. Demo mode excludes Network, Backups and Updates.
The 60 retained checks and their measured page widths are in
[viewport-results.json](screenshots/mobile-review/viewport-results.json).

Additional checks:

- Populated gradebook: grade 4 / Math, five students and four assignments; keyboard
  entry of 90 and 91 saved successfully, Tab moved to the next student, and input
  bounding boxes were 44 x 44px. The grid scrolls horizontally within its panel.
- While the gradebook was scrolled, a hit test over the mobile navigation reached
  the navigation rather than the assignment heading overlay. Rechecked at 430px.
- Populated Hannah Brubaker / Period 1 report card: the 338px preview container
  scrolls internally; page content and scroll widths both measured 360px at a
  375px viewport (Windows reserves 15px for the vertical scrollbar).
- Light and dark dashboard appearance, mobile menu opening/navigation, original
  1074px desktop width, and 1280px desktop width. At 1280px the recent table's
  content and scroll widths both measured 413px; the complete badge was visible.
- Final local demo at localhost:3000: health ready; at 375px, recent table content
  and scroll widths both 336px, badge height 25px, page width/scroll width 360px.
- `npm test`: all 74 tests passed on Node 26.13.1. Node 22.13 syntax, refactor and
  full test suite: all 74 passed on Windows. Dashboard regression assertions cover
  the named keyboard region while retaining authorization and numeric checks.
- `git diff --check` passed.

These are Chromium viewport checks, not physical iPhone or Safari/WebKit tests.
Hardware keyboard appearance, iOS zoom, safe-area behavior and touch scrolling
still need a real-device check. Full-page screenshot capture briefly produced a
malformed gradebook image; it was replaced with a verified viewport screenshot.
No production data was used. The local demo was restarted with these fixes;
demo startup refreshes the sample data.

## Screenshots

- [Original problem at 1074px](screenshots/mobile-review/dashboard-before-1074.jpg)
- [Fixed at 1074px](screenshots/mobile-review/dashboard-after-1074.jpg)
- [Dashboard 375 x 667](screenshots/mobile-review/dashboard-375x667.jpg)
- [Dashboard 390 x 844](screenshots/mobile-review/dashboard-390x844.jpg)
- [Dashboard 393 x 852](screenshots/mobile-review/dashboard-393x852.jpg)
- [Dashboard 414 x 896](screenshots/mobile-review/dashboard-414x896.jpg)
- [Dashboard 430 x 932](screenshots/mobile-review/dashboard-430x932.jpg)
- [Dashboard 440 x 956](screenshots/mobile-review/dashboard-440x956.jpg)
- [Landscape 844 x 390](screenshots/mobile-review/dashboard-landscape-844x390.jpg)
- [Desktop 1280 x 900](screenshots/mobile-review/dashboard-1280x900.jpg)
- [Dark dashboard](screenshots/mobile-review/dashboard-dark-375x667.jpg)
- [Gradebook saved at 375px](screenshots/mobile-review/gradebook-saved-375x667.jpg)
- [Gradebook at 430px](screenshots/mobile-review/gradebook-430x932.jpg)
- [Report selection at 375px](screenshots/mobile-review/report-card-375x667.jpg)
- [Setup at 430px](screenshots/mobile-review/setup-430x932.jpg)

PR: Pending.
