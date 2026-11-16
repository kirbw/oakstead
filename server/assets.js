const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DEMO_MODE } = require('./config');
const { createScoreSaveQueue } = require('./score-save-queue');
const APP_STYLESHEET = `:root {
  color-scheme: light;
  --bg: #fbfcfb;
  --paper: #ffffff;
  --paper-strong: #ffffff;
  --ink: #17211c;
  --muted: #66716b;
  --line: #e5e9e6;
  --line-strong: #d3dad5;
  --accent: #1f6f54;
  --accent-dark: #175843;
  --accent-soft: #e9f3ee;
  --gold: #8a5a10;
  --red: #a33a2e;
  --blue: #3f72c4;
  --grade-grid-head: #e2efe9;
  --grade-grid-head-ink: #175843;
  --grade-grid-head-line: #bcd4c8;
  --grade-grid-band: #e9f3ee;
  --grade-grid-band-strong: #d5e8de;
  --grade-grid-band-ink: #175843;
  --shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 6px 16px rgba(16, 24, 40, .05);
  --radius: 8px;
  --demo-offset: ${DEMO_MODE ? '34px' : '0px'};
  --topbar-height: 66px;
  --mobile-strip-height: 50px;
}
[data-theme="dark"] {
  color-scheme: dark;
  --bg: #101613;
  --paper: #171e1a;
  --paper-strong: #1d2621;
  --ink: #eaf1ec;
  --muted: #98a69e;
  --line: #27312b;
  --line-strong: #37453d;
  --accent: #4fae86;
  --accent-dark: #8fd0b2;
  --accent-soft: #1d3229;
  --gold: #e2b46a;
  --red: #eb9a8b;
  --blue: #8fb2ec;
  --grade-grid-head: #1b241f;
  --grade-grid-head-ink: #cfe6d9;
  --grade-grid-head-line: #3a4d43;
  --grade-grid-band: #21382e;
  --grade-grid-band-strong: #315444;
  --grade-grid-band-ink: #dff0e6;
  --shadow: 0 18px 60px rgba(0, 0, 0, .34);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100svh;
  background: var(--bg);
  color: var(--ink);
  font-family: "Public Sans", "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
}
a { color: inherit; }
button, input, select, textarea { font: inherit; }
button, select, input { min-height: 42px; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.app {
  width: min(1440px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
}
.demo-banner {
  grid-column: 1 / -1;
  position: sticky;
  top: 0;
  z-index: 30;
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: .38rem .85rem;
  background: #b42318;
  color: #fff;
  font-size: .84rem;
  font-weight: 850;
  text-align: center;
  letter-spacing: .015em;
}
.topbar {
  position: sticky;
  top: var(--demo-offset);
  z-index: 24;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: .75rem;
  min-height: var(--topbar-height);
  padding: .55rem max(.85rem, env(safe-area-inset-left)) .55rem max(.85rem, env(safe-area-inset-right));
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  backdrop-filter: blur(16px);
}
.brand-row, .top-actions, .year-form, .user-chip { display: flex; align-items: center; gap: .5rem; min-width: 0; }
.brand-row { justify-content: space-between; }
.brand { display: flex; align-items: center; gap: .65rem; min-width: 0; text-decoration: none; }
.brand img { width: 44px; height: 34px; object-fit: contain; flex: 0 0 auto; }
.brand-text { min-width: 0; }
.brand-text strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1.02rem; font-weight: 760; letter-spacing: 0; line-height: 1.2; }
.brand-text span { display: block; color: var(--muted); font-size: .82rem; margin-top: .05rem; line-height: 1.35; }
.top-actions { justify-content: flex-end; flex-wrap: nowrap; margin-left: auto; }
.year-form { flex: 0 0 auto; }
.year-form select { min-height: 38px; width: 150px; border-color: var(--line); background: var(--paper); font-size: .84rem; font-weight: 700; padding: .42rem .54rem; }
.year-form button, .icon-btn, .logout-btn {
  border: 1px solid var(--line);
  background: var(--paper-strong);
  color: var(--ink);
  border-radius: var(--radius);
  padding: .42rem .58rem;
  cursor: pointer;
}
.logout-form { margin: 0; }
.logout-btn {
  min-height: 36px;
  font-size: .82rem;
  font-weight: 760;
  white-space: nowrap;
}
.user-chip {
  min-height: 34px;
  max-width: 170px;
  color: var(--muted);
  font-size: .82rem;
  font-weight: 700;
  white-space: nowrap;
}
.user-name { overflow: hidden; text-overflow: ellipsis; }
.user-role::before { content: " · "; }
.mobile-nav-strip {
  grid-column: 1 / -1;
  position: sticky;
  top: calc(var(--demo-offset) + var(--topbar-height));
  z-index: 22;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(108px, 140px);
  gap: .5rem;
  min-height: var(--mobile-strip-height);
  padding: .42rem max(.75rem, env(safe-area-inset-left)) .42rem max(.75rem, env(safe-area-inset-right));
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 96%, transparent);
  backdrop-filter: blur(16px);
}
.nav-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: .65rem;
  min-width: 0;
  min-height: 38px;
  padding: .42rem .58rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-strong);
  color: var(--ink);
  cursor: pointer;
  font-weight: 800;
}
.nav-toggle-main {
  display: inline-flex;
  align-items: center;
  gap: .48rem;
  min-width: 0;
}
.nav-toggle-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-toggle svg {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  fill: currentColor;
}
.nav-toggle-chevron {
  transition: transform .16s ease;
}
.nav-open .nav-toggle-chevron {
  transform: rotate(180deg);
}
.mobile-year-form { justify-content: end; }
.mobile-year-form select {
  width: 100%;
  min-width: 0;
}
.sidebar {
  position: sticky;
  top: calc(var(--demo-offset) + var(--topbar-height) + var(--mobile-strip-height));
  z-index: 21;
  display: none;
  gap: .35rem;
  max-height: calc(100svh - var(--demo-offset) - var(--topbar-height) - var(--mobile-strip-height));
  overflow: auto;
  padding: .48rem .65rem .65rem;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  scrollbar-width: none;
}
.nav-open .sidebar { display: grid; }
.sidebar::-webkit-scrollbar { width: 0; height: 0; display: none; }
.sidebar-context { display: none; }
.nav-links {
  display: grid;
  gap: .28rem;
}
.nav-link {
  display: flex;
  align-items: center;
  gap: .65rem;
  text-decoration: none;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--muted);
  border-radius: var(--radius);
  padding: .7rem .75rem;
  font-weight: 650;
  font-size: .88rem;
  white-space: nowrap;
  transition: color .18s ease, border-color .18s ease, background .18s ease;
}
.nav-link svg {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  fill: currentColor;
  opacity: .88;
}
.nav-link.active { color: var(--accent-dark); background: var(--accent-soft); border-left-color: var(--accent); }
.nav-link:hover { color: var(--accent-dark); background: var(--accent-soft); }
.nav-link.active:hover { color: var(--accent-dark); }
.sidebar-utility {
  display: block;
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.theme-icon-btn {
  width: 38px;
  height: 38px;
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.theme-icon-btn:hover { color: var(--accent-dark); background: var(--accent-soft); }
.theme-icon-btn svg { width: 18px; height: 18px; fill: currentColor; }
.main {
  padding: 1rem .85rem 3.5rem;
  transition: opacity .14s ease;
}
.main.app-loading {
  opacity: .48;
}
@media (prefers-reduced-motion: reduce) {
  .main { transition: none; }
}
.app-footer {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  padding: .8rem max(.85rem, env(safe-area-inset-left)) max(.9rem, env(safe-area-inset-bottom)) max(.85rem, env(safe-area-inset-right));
  border-top: 1px solid var(--line);
  color: var(--muted);
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  font-size: .78rem;
  font-weight: 750;
}
.app-footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-footer a {
  color: inherit;
  text-decoration: none;
}
.app-footer a:hover { color: var(--accent-dark); }
.app-footer a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 3px;
}
.app-footer strong { color: var(--ink); font-weight: 850; }
.app-footer a:hover strong { color: inherit; }
.workspace {
  display: grid;
  gap: 1rem;
}
.page-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  padding: .35rem 0 .1rem;
}
.page-head-copy { display: grid; gap: .35rem; min-width: 0; }
.page-head h1 {
  margin: 0;
  font-size: clamp(1.45rem, 4.5vw, 2.35rem);
  line-height: 1.12;
  letter-spacing: 0;
  font-weight: 760;
}
.page-head p { margin: 0; color: var(--muted); max-width: 760px; line-height: 1.45; }
.ledger {
  background: var(--paper);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  border-radius: 12px;
  overflow: hidden;
}
.ledger-head {
  display: grid;
  gap: .3rem;
  padding: .95rem;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper-strong) 72%, var(--bg));
}
.ledger-head h2, .panel-title h2 { margin: 0; font-size: 1rem; letter-spacing: 0; }
.ledger-head p, .panel-title p { margin: 0; color: var(--muted); font-size: .86rem; line-height: 1.4; }
.panel {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: .9rem;
  box-shadow: var(--shadow);
}
.panel-title { display: grid; gap: .25rem; margin-bottom: .85rem; }
.panel-title.inline-title {
  display: flex;
  align-items: baseline;
  gap: .25rem;
  flex-wrap: wrap;
}
.panel-title.inline-title span {
  color: var(--muted);
  font-size: .9rem;
}
.grid-2, .grid-3, .grid-4 { display: grid; gap: .7rem; grid-template-columns: 1fr; }
.form-grid { display: grid; gap: .7rem; grid-template-columns: 1fr; }
.absence-form {
  gap: .85rem .75rem;
  align-items: end;
}
.absence-form fieldset {
  display: grid;
  gap: .32rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.absence-form legend {
  margin: 0;
  padding: 0;
  color: var(--muted);
  font-size: .86rem;
  font-weight: 650;
}
.choice-group {
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  gap: .18rem;
  align-items: center;
  justify-self: start;
  min-height: 42px;
  padding: .18rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-strong);
}
.choice-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  gap: 0;
  color: var(--muted);
  font-size: .84rem;
  font-weight: 820;
  cursor: pointer;
}
.choice-pill input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.choice-pill span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: .35rem .6rem;
  border-radius: calc(var(--radius) - 1px);
  line-height: 1;
  white-space: nowrap;
  transition: background .16s ease, color .16s ease, box-shadow .16s ease;
}
.choice-pill input:checked + span {
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 0 0 1px var(--line);
}
.choice-pill input:focus-visible + span {
  outline: 3px solid color-mix(in srgb, var(--accent) 22%, transparent);
}
.absence-notes-field textarea {
  min-height: 76px;
}
.absence-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  flex-wrap: wrap;
}
.absence-list-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: .5rem;
  flex-wrap: wrap;
}
.absence-header-filters {
  display: flex;
  align-items: center;
  gap: .38rem;
  flex-wrap: wrap;
}
.absence-filter-label {
  color: var(--muted);
  font-size: .78rem;
  font-weight: 850;
}
.absence-header-filters select {
  width: auto;
  min-width: 112px;
  max-width: min(220px, 58vw);
  min-height: 34px;
  padding: .34rem 1.8rem .34rem .55rem;
  border-color: var(--line);
  background-color: var(--paper-strong);
  color: var(--ink);
  font-size: .82rem;
  font-weight: 760;
}
.absence-header-filters select[name="studentId"] {
  min-width: 180px;
}
.absence-clear-filter {
  min-height: 34px;
  padding: .34rem .55rem;
}
.absence-table th,
.absence-table td {
  vertical-align: middle;
}
.absence-date-cell,
.absence-grade-cell,
.absence-kind-cell,
.absence-amount-cell {
  white-space: nowrap;
}
.absence-student-cell {
  font-weight: 750;
}
.absence-grade-cell {
  color: var(--muted);
  font-size: .84rem;
  font-weight: 820;
}
.absence-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  min-width: 70px;
  padding: .16rem .52rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper-strong);
  color: var(--muted);
  font-size: .78rem;
  font-weight: 850;
}
.absence-kind.absence {
  border-color: color-mix(in srgb, var(--red) 34%, var(--line));
  background: color-mix(in srgb, var(--red) 8%, var(--paper));
  color: var(--red);
}
.absence-kind.tardy {
  border-color: color-mix(in srgb, var(--gold) 42%, var(--line));
  background: color-mix(in srgb, var(--gold) 10%, var(--paper));
  color: var(--gold);
}
.family-form-section {
  grid-column: 1 / -1;
  display: grid;
  gap: .7rem;
  padding-top: .15rem;
}
.family-form-section + .family-form-section {
  margin-top: .25rem;
  padding-top: .85rem;
  border-top: 1px solid var(--line);
}
.family-form-section h3 {
  margin: 0;
  color: var(--ink);
  font-size: .92rem;
  letter-spacing: 0;
}
.family-form-section-grid {
  display: grid;
  gap: .7rem;
  grid-template-columns: 1fr;
}
label { display: grid; gap: .32rem; color: var(--muted); font-size: .86rem; font-weight: 650; }
input, select, textarea {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-strong);
  color: var(--ink);
  padding: .62rem .68rem;
}
input[type="checkbox"] { width: auto; min-height: auto; }
.check-row {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: .45rem;
  padding: .62rem .68rem;
  border: 1px solid var(--line-strong);
  background: var(--paper-strong);
  color: var(--ink);
}
textarea { min-height: 82px; resize: vertical; }
input:focus, select:focus, textarea:focus {
  outline: 3px solid color-mix(in srgb, var(--accent) 22%, transparent);
  border-color: var(--accent);
}
.primary-btn, .main button[type="submit"], .login button[type="submit"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-height: 42px;
  height: auto;
  justify-self: start;
  align-self: end;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  padding: .62rem .85rem;
  cursor: pointer;
}
.form-grid button[type="submit"] {
  grid-column: auto;
}
.secondary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-strong);
  color: var(--ink);
  font-weight: 800;
  padding: .62rem .85rem;
}
.text-action {
  color: var(--accent-dark);
  font-weight: 800;
  text-decoration: none;
}
.text-action:hover { text-decoration: underline; }
.compact-action {
  min-height: 34px;
  padding: .38rem .58rem;
  font-size: .82rem;
}
.inline-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .55rem; }
.kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .65rem;
}
.kpi {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: .85rem;
  box-shadow: var(--shadow);
}
.kpi-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: .32rem; }
.kpi-icon svg { width: 20px; height: 20px; fill: var(--muted); display: block; opacity: .55; }
.kpi span { color: var(--muted); font-size: .82rem; font-weight: 650; }
.kpi strong { display: block; font-size: 1.55rem; line-height: 1; }
.week-svg { width: 100%; height: auto; display: block; overflow: visible; margin-top: .4rem; }
.week-svg .guide { stroke: var(--line); fill: none; }
.week-svg .y-label { fill: var(--muted); font-size: 9px; font-family: inherit; }
.week-svg .area { fill: var(--accent); opacity: .1; }
.week-svg .line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.week-svg .dot { fill: var(--accent); stroke: var(--paper); stroke-width: 2; }
.week-svg .x-label { fill: var(--muted); font-size: 9px; text-anchor: middle; font-family: inherit; }
.week-svg .empty-msg { fill: var(--muted); font-size: 11px; text-anchor: middle; font-family: inherit; }
.table-wrap { width: 100%; overflow-x: visible; }
table { width: 100%; min-width: 0; border-collapse: collapse; table-layout: fixed; }
th, td { padding: .68rem .75rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: .9rem; }
th { color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .025em; font-weight: 700; background: color-mix(in srgb, var(--paper-strong) 72%, var(--bg)); }
td { overflow-wrap: anywhere; }
tr:last-child td { border-bottom: 0; }
.compact-table table { min-width: 0; table-layout: auto; }
.assignment-history-table td { overflow-wrap: normal; }
.assignment-history-table th:nth-child(1),
.assignment-history-table td:nth-child(1) {
  width: 6.8rem;
  white-space: nowrap;
}
.assignment-history-table th:nth-child(3),
.assignment-history-table td:nth-child(3),
.assignment-history-table th:nth-child(4),
.assignment-history-table td:nth-child(4),
.assignment-history-table th:nth-child(5),
.assignment-history-table td:nth-child(5),
.assignment-history-table th:nth-child(6),
.assignment-history-table td:nth-child(6) {
  white-space: nowrap;
}
.assignment-history-table th:nth-child(2),
.assignment-history-table td:nth-child(2) {
  min-width: 6.5rem;
}
.assignment-history-table .badge {
  white-space: nowrap;
}
.assignment-history-panel {
  align-self: start;
}
.assignment-history-list {
  display: grid;
}
.history-link {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .65rem;
  align-items: center;
  padding: .78rem .9rem;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--line);
  transition: background .16s ease, color .16s ease;
}
.history-link:last-child { border-bottom: 0; }
.history-link:hover {
  background: color-mix(in srgb, var(--accent-soft) 52%, var(--paper));
}
.history-link.active {
  background: var(--accent-soft);
  color: var(--accent-dark);
}
.history-main,
.history-side {
  display: grid;
  gap: .18rem;
  min-width: 0;
}
.history-main b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: .9rem;
}
.history-main small,
.history-side small {
  color: var(--muted);
  font-size: .76rem;
  font-weight: 700;
  white-space: nowrap;
}
.history-side {
  justify-items: end;
}
.history-side .badge {
  margin: 0;
  white-space: nowrap;
}
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 25px;
  padding: 3px 9px;
  border: 0;
  border-radius: 999px;
  color: var(--muted);
  background: color-mix(in srgb, var(--muted) 12%, var(--paper));
  font-size: .78rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  margin: .05rem .18rem .05rem 0;
}
.badge.good { background: var(--accent-soft); color: var(--accent-dark); }
.badge.watch { background: color-mix(in srgb, var(--gold) 15%, var(--paper)); color: var(--gold); }
.badge.low { background: color-mix(in srgb, var(--red) 14%, var(--paper)); color: var(--red); }
.type-chip { font-size: .78rem; font-weight: 700; color: var(--muted); }
.selected-row > td { background: var(--accent-soft); color: var(--accent-dark); }
.split {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.gradebook-score-panel {
  min-width: 0;
}
.filters {
  display: grid;
  gap: .7rem;
  grid-template-columns: 1fr;
}
.class-average-callout {
  align-self: end;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: .65rem;
  min-height: 42px;
  padding: .55rem .7rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--accent-soft) 54%, var(--paper));
  color: var(--muted);
  font-size: .84rem;
  font-weight: 700;
}
.class-average-callout b {
  color: var(--ink);
  font-size: .95rem;
}
.score-sheet {
  display: grid;
  gap: .45rem;
}
.score-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 96px;
  gap: .55rem;
  align-items: center;
  padding: .55rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-strong);
}
.score-row b { font-size: .92rem; }
.score-student-label {
  display: flex;
  align-items: baseline;
  gap: .35rem;
  flex-wrap: wrap;
}
.student-period-avg {
  color: var(--muted);
  font-size: .82rem;
  font-weight: 800;
  white-space: nowrap;
}
.student-period-avg::before {
  content: "- ";
  color: var(--muted);
}
.score-row small { display: block; color: var(--muted); margin-top: .12rem; }
.score-row input { text-align: center; font-weight: 800; }
.score-entry-cell { display: grid; gap: .15rem; }
.score-entry-cell .score-preview {
  min-height: 1rem;
  margin: 0;
  color: var(--muted);
  text-align: center;
  font-size: .72rem;
  font-weight: 700;
}
.score-mode {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  min-height: 32px;
  color: var(--muted);
  font-size: .8rem;
  font-weight: 800;
}
.score-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 42px;
  height: 24px;
  gap: 0;
  cursor: pointer;
}
.score-switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.score-switch-track {
  position: relative;
  width: 42px;
  height: 24px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--paper-strong);
  transition: background .16s ease, border-color .16s ease;
}
.score-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--muted);
  transition: transform .16s ease, background .16s ease;
}
.score-switch input:checked + .score-switch-track {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 20%, var(--paper-strong));
}
.score-switch input:checked + .score-switch-track .score-switch-thumb {
  transform: translateX(18px);
  background: var(--accent);
}
.score-switch input:focus-visible + .score-switch-track {
  outline: 3px solid color-mix(in srgb, var(--accent) 22%, transparent);
}
.score-help {
  margin: -.2rem 0 .1rem;
  color: var(--muted);
  font-size: .84rem;
}
.assignment-picker {
  max-width: 420px;
}
.score-save-btn {
  justify-self: end;
  min-width: 128px;
}
.gradebook-layout-toggle {
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  min-height: 42px;
  color: var(--muted);
  font-size: .86rem;
  font-weight: 850;
  white-space: nowrap;
}
.gradebook-layout-toggle strong {
  color: var(--ink);
  min-width: 24px;
}
.gradebook-grid-workspace {
  gap: .7rem;
}
.gb-grid-shell {
  display: grid;
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  box-shadow: var(--shadow);
}
.gb-grid-shell.letters-hidden .gb-cell-letter,
.gb-grid-shell.letters-hidden .gb-grid-average sup,
.gb-grid-shell.letters-hidden .gb-grid-student sup,
.gb-grid-shell.letters-hidden .gb-grid-class-row sup {
  display: none;
}
.gb-grid-toolbar {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 190px)) minmax(300px, 1fr) minmax(110px, 140px) minmax(96px, 110px);
  gap: .62rem;
  align-items: end;
  padding: .65rem .75rem;
  background: color-mix(in srgb, var(--paper-strong) 72%, var(--bg));
  border-bottom: 1px solid var(--line);
}
.gb-grid-toolbar label {
  color: var(--ink);
  font-size: .72rem;
  font-weight: 850;
}
.gb-grid-toolbar select {
  min-height: 30px;
  padding: .3rem .45rem;
  border-color: var(--line-strong);
  background: var(--paper);
  color: var(--ink);
}
.gb-toolbar-check .check-row {
  min-height: 30px;
  padding: .3rem .45rem;
  border-color: var(--line-strong);
  background: var(--paper);
  font-size: .78rem;
  font-weight: 850;
}
.gb-type-legend {
  display: flex;
  align-items: center;
  gap: .45rem;
  min-height: 32px;
  color: var(--ink);
  font-size: .78rem;
  white-space: nowrap;
  overflow: auto;
  scrollbar-width: none;
}
.gb-type-legend::-webkit-scrollbar { display: none; }
.gb-type-legend b {
  margin-right: .4rem;
  font-size: .72rem;
}
.legend-box {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: .18rem;
  vertical-align: -2px;
}
.legend-box.lesson { background: #111827; }
.legend-box.quiz { background: #4778d9; }
.legend-box.test { background: #c43a35; }
.gb-grid-form {
  display: grid;
  min-width: 0;
  background: var(--paper);
}
.gb-grid-scroll {
  width: 100%;
  overflow: auto;
  background: linear-gradient(to bottom, var(--grade-grid-head) 0 126px, var(--paper) 126px);
  scrollbar-color: #a6adba #e5e7eb;
  scrollbar-width: thin;
}
.gb-grid-stage {
  position: relative;
  width: max-content;
  min-width: 100%;
}
.gb-grid-header-overlay {
  position: absolute;
  top: 0;
  left: 150px;
  z-index: calc(var(--gb-assignment-count) + 20);
  width: calc((var(--gb-assignment-count) + 1) * 54px);
  height: 126px;
  pointer-events: none;
}
.gb-header-svg {
  display: block;
  width: 100%;
  height: 126px;
  overflow: visible;
}
.gb-header-svg line {
  stroke: var(--grade-grid-head-line);
  stroke-width: 1;
}
.gb-header-svg text {
  fill: var(--grade-grid-head-ink);
  font-family: inherit;
  font-size: 12px;
  font-weight: 900;
}
.gb-header-add {
  position: absolute;
  top: 0;
  left: calc(var(--gb-assignment-count) * 54px);
  width: 54px;
  height: 126px;
  pointer-events: auto;
}
.gb-header-add::after {
  content: "";
  position: absolute;
  left: -0.5px;
  bottom: 30px;
  width: 1px;
  height: 117px;
  background: var(--grade-grid-head-line);
  transform: rotate(43deg);
  transform-origin: bottom center;
  pointer-events: none;
}
.gb-grid-table {
  min-width: max-content;
  width: max-content;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  color: var(--ink);
  font-size: .82rem;
  line-height: 1.1;
}
.gb-grid-student-col { width: 150px; }
.gb-grid-score-col { width: 54px; }
.gb-grid-table th,
.gb-grid-table td {
  width: 54px;
  min-width: 54px;
  height: 40px;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  text-align: center;
  vertical-align: middle;
  overflow: visible;
  background: var(--paper);
}
.gb-grid-table thead th {
  position: sticky;
  top: 0;
  z-index: 4;
  background: var(--grade-grid-head);
  color: var(--grade-grid-head-ink);
  font-weight: 800;
}
.gb-grid-top-row th {
  height: 96px;
  border-right-color: transparent;
  border-bottom: 0;
}
.gb-grid-icon-row th {
  top: 96px;
  height: 30px;
  border-top: 1px solid color-mix(in srgb, var(--grade-grid-head-line) 45%, transparent);
  border-right-color: transparent;
}
.gb-grid-assignment {
  position: relative;
  z-index: var(--gb-header-z, 4) !important;
  vertical-align: bottom;
  overflow: visible !important;
}
.gb-grid-assignment::before {
  content: none;
}
.gb-grid-assignment::after {
  content: none;
}
.gb-grid-assignment a {
  display: none;
}
.gb-grid-assignment span {
  display: none;
}
.gb-grid-icon-row a,
.gb-grid-add a {
  color: #4f8df5;
  font-size: .72rem;
  font-weight: 850;
  text-decoration: none;
}
.gb-edit-icon {
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #4f8df5;
  cursor: pointer;
}
.gb-edit-icon svg {
  width: 15px;
  height: 15px;
  fill: currentColor;
}
.gb-grid-add a {
  color: #16a34a;
  font-size: 1.15rem;
}
.gb-grid-add {
  position: relative;
}
.gb-grid-add-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid color-mix(in srgb, #16a34a 55%, var(--grade-grid-head-line));
  background: color-mix(in srgb, #16a34a 14%, var(--grade-grid-head));
  border-radius: 4px;
  cursor: pointer;
  color: var(--grade-grid-head-ink);
  font-weight: 950;
}
.gb-grid-add-btn:hover {
  background: color-mix(in srgb, #16a34a 24%, var(--grade-grid-head));
}
.gb-grid-year,
.gb-grid-student,
.gb-grid-table tbody th {
  position: sticky;
  left: 0;
  z-index: 5;
  width: 150px !important;
  min-width: 150px !important;
  padding: .38rem .55rem !important;
  text-align: right !important;
  background: var(--grade-grid-band-strong) !important;
  color: var(--grade-grid-band-ink) !important;
  border-right: 1px solid color-mix(in srgb, var(--grade-grid-band) 70%, #000) !important;
}
.gb-grid-year {
  top: 0;
  z-index: 7;
  height: 126px !important;
  text-align: center !important;
  background: var(--grade-grid-head) !important;
}
.gb-grid-year:empty::before {
  content: "";
  display: block;
  min-height: 1px;
}
.gb-grid-year span {
  display: block;
  margin: .25rem 0 1.4rem;
  font-weight: 850;
}
.gb-grid-year label {
  display: flex;
  align-items: center;
  gap: .34rem;
  margin: .2rem 0;
  color: var(--grade-grid-head-ink);
  font-size: .76rem;
  font-weight: 750;
}
.gb-grid-year input[type="checkbox"] {
  accent-color: var(--accent);
}
.gb-grid-table tbody th span {
  margin-left: .25rem;
  font-size: .76rem;
  font-weight: 900;
}
.gb-grid-class-row th,
.gb-grid-class-row td,
.gb-grid-points-row th,
.gb-grid-points-row td {
  background: var(--grade-grid-band) !important;
  color: var(--grade-grid-band-ink) !important;
  border-bottom-color: color-mix(in srgb, var(--grade-grid-band) 70%, var(--line));
}
.gb-grid-class-row th {
  text-align: left !important;
  padding-left: 1rem !important;
}
.gb-grid-points-row th {
  background: var(--grade-grid-band-strong) !important;
}
.gb-grid-points-row td {
  background: var(--grade-grid-band) !important;
  font-weight: 850;
}
.gb-grid-table tbody tr:nth-child(odd) td {
  background: color-mix(in srgb, var(--paper-strong) 70%, var(--bg));
}
.gb-grid-table tbody tr:nth-child(even) td {
  background: var(--paper);
}
.gb-grid-score-cell {
  position: relative;
  overflow: hidden !important;
}
.gb-grid-score-cell input {
  width: calc(100% - 13px);
  height: 100%;
  min-height: 40px;
  padding: .1rem 0 .1rem .08rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  text-align: right;
  font-size: .78rem;
  font-weight: 760;
  appearance: textfield;
  -moz-appearance: textfield;
}
.gb-grid-score-cell input::-webkit-outer-spin-button,
.gb-grid-score-cell input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}
.gb-grid-score-cell input:focus {
  position: relative;
  z-index: 3;
  outline: 2px solid #2563eb;
  background: var(--paper);
}
.gb-cell-letter {
  position: absolute;
  right: .12rem;
  top: .26rem;
  color: var(--ink);
  font-size: .62rem;
  font-weight: 850;
  line-height: 1;
  pointer-events: none;
}
.gb-cell-status {
  position: absolute;
  left: .18rem;
  bottom: .12rem;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  opacity: 0;
  pointer-events: none;
}
.gb-grid-score-cell.saving .gb-cell-status {
  opacity: 1;
  background: #f59e0b;
}
.gb-grid-score-cell.saved .gb-cell-status {
  opacity: 1;
  background: #16a34a;
  animation: saveFade .9s ease forwards;
}
.gb-grid-score-cell.save-error .gb-cell-status {
  opacity: 1;
  background: #dc2626;
}
@keyframes saveFade {
  0%, 55% { opacity: 1; }
  100% { opacity: 0; }
}
.gb-type-quiz input,
.gb-type-quiz .gb-cell-letter,
.gb-grid-average.gb-type-quiz {
  color: #2563eb;
}
.gb-type-test input,
.gb-type-test .gb-cell-letter,
.gb-grid-average.gb-type-test {
  color: #dc2626;
}
.gb-grid-average {
  font-weight: 850;
}
.gb-grid-average sup,
.gb-grid-student sup,
.gb-grid-class-row sup {
  font-size: .62em;
  margin-left: .05rem;
}
.gb-grid-footer button[hidden] { display: none !important; }
.gb-grid-footer {
  position: sticky;
  bottom: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  padding: .55rem .75rem;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper-strong) 72%, var(--bg));
  color: var(--muted);
  font-size: .82rem;
  font-weight: 800;
}
.assignment-dialog {
  width: min(720px, calc(100vw - 2rem));
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0;
  color: var(--ink);
  background: var(--paper);
  box-shadow: 0 24px 80px rgba(16, 24, 40, .3);
}
.assignment-dialog::backdrop {
  background: rgba(17, 24, 39, .68);
}
.assignment-dialog-form {
  display: grid;
}
.assignment-dialog-head {
  display: flex;
  align-items: center;
  gap: .7rem;
  padding: 1rem 1.15rem;
  border-bottom: 1px solid var(--line);
}
.assignment-dialog-head span,
.assignment-dialog-head svg {
  width: 26px;
  height: 26px;
  fill: var(--ink);
}
.assignment-dialog-head h3 {
  margin: 0;
  font-size: 1.1rem;
}
.assignment-dialog-body {
  display: grid;
  gap: 1rem;
  padding: 1.15rem;
}
.assignment-dialog-grid {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(120px, .75fr) minmax(140px, .75fr);
  gap: .9rem;
  align-items: start;
}
.assignment-dialog fieldset {
  display: grid;
  gap: .7rem;
  margin: 0;
  padding: 0;
  border: 0;
}
.assignment-dialog legend {
  margin-bottom: .25rem;
  color: var(--ink);
  font-size: .86rem;
  font-weight: 850;
}
.assignment-type-radio {
  display: flex;
  align-items: center;
  gap: .5rem;
  min-height: 30px;
  color: var(--ink);
  font-weight: 500;
}
.assignment-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: .65rem;
  padding: .85rem 1.15rem;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper-strong) 70%, var(--bg));
}
.assignment-dialog-actions .danger-action {
  margin-right: auto;
  border-color: var(--red);
  color: var(--red);
}
.letter-grade-edit-table input {
  min-height: 34px;
  padding: .38rem .5rem;
}
.quick-scores {
  position: sticky;
  bottom: 0;
  z-index: 9;
  display: flex;
  gap: .38rem;
  overflow-x: auto;
  padding: .55rem 0 .2rem;
  background: linear-gradient(180deg, transparent, var(--paper) 24%);
  scrollbar-width: none;
}
.quick-scores::-webkit-scrollbar { display: none; }
.quick-scores button {
  flex: 0 0 auto;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-strong);
  color: var(--ink);
  font-weight: 900;
  min-width: 54px;
  cursor: pointer;
}
.empty {
  margin: 0;
  color: var(--muted);
  padding: .8rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--paper-strong) 65%, transparent);
}
.page-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  padding: .6rem .85rem;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}
.family-layout {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.family-module-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.assignments-layout {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.assignments-layout .family-list {
  align-self: start;
}
.assignment-editor {
  align-self: start;
}
.module-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: .5rem;
}
.setup-layout {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.setup-nav {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.setup-nav-head {
  padding: .9rem;
  border-bottom: 1px solid var(--line);
}
.setup-nav-head h2 { margin: 0; font-size: 1rem; }
.setup-link {
  display: grid;
  gap: .2rem;
  padding: .82rem .9rem;
  text-decoration: none;
  border-left: 3px solid transparent;
  border-bottom: 1px solid var(--line);
}
.setup-link:last-child { border-bottom: 0; }
.setup-link strong { font-size: .94rem; font-weight: 700; }
.setup-link span { color: var(--muted); font-size: .84rem; line-height: 1.45; }
.setup-link.active { background: var(--accent-soft); border-left-color: var(--accent); color: var(--accent-dark); }
.setup-link:hover { background: var(--accent-soft); color: var(--accent-dark); }
.family-list {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.family-list-head, .family-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  padding: .9rem;
  border-bottom: 1px solid var(--line);
}
.family-list-head h2, .family-detail-head h2 { margin: 0; font-size: 1rem; }
.family-count { color: var(--muted); font-size: .84rem; font-weight: 650; }
.family-link {
  display: grid;
  gap: .28rem;
  padding: .82rem .9rem;
  text-decoration: none;
  border-bottom: 1px solid var(--line);
  transition: background .16s ease, color .16s ease;
}
.family-link:last-child { border-bottom: 0; }
.family-link strong { font-size: .98rem; font-weight: 720; line-height: 1.28; }
.family-link span { color: var(--muted); font-size: .84rem; line-height: 1.4; }
.family-link small { color: var(--muted); font-size: .84rem; line-height: 1.4; }
.family-link.active { background: var(--accent-soft); color: var(--accent-dark); }
.family-link:hover { background: color-mix(in srgb, var(--accent-soft) 60%, var(--paper)); }
.family-detail {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.family-detail-body {
  display: grid;
  gap: 1rem;
  padding: .95rem;
}
.detail-grid {
  display: grid;
  gap: .7rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.detail-item {
  display: grid;
  gap: .15rem;
  padding-bottom: .65rem;
  border-bottom: 1px solid var(--line);
}
.detail-item span { color: var(--muted); font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .025em; }
.detail-item strong { font-size: .98rem; font-weight: 680; line-height: 1.35; }
.asset-preview-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: .75rem;
}
.asset-preview {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: .8rem;
  padding: .75rem;
  border: 1px solid var(--line);
  background: var(--paper-strong);
}
.asset-preview img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}
.asset-preview strong { display: block; font-size: .9rem; }
.asset-preview span { color: var(--muted); font-size: .8rem; }
.child-list {
  display: grid;
  gap: .55rem;
}
.child-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .65rem;
  align-items: center;
  padding: .75rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-strong);
}
.child-row b { font-size: .95rem; }
.child-row span { color: var(--muted); font-size: .84rem; }
.child-row-main { display: grid; gap: .25rem; min-width: 0; }
.child-name-line {
  display: flex;
  align-items: center;
  gap: .5rem;
  min-width: 0;
}
.student-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.student-icon svg { width: 100%; height: 100%; display: block; }
.student-icon.neutral svg { fill: var(--muted); }
.student-icon.girl svg { fill: #be185d; }
.student-icon.boy svg { fill: #1d4ed8; }
.family-detail-body button[type="submit"] { justify-self: start; }
.asgn-link {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .24rem .5rem;
  align-items: center;
  padding: .68rem .75rem;
}
.asgn-link .asgn-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 720;
  font-size: .88rem;
}
.asgn-link .asgn-meta {
  color: var(--muted);
  font-size: .75rem;
  white-space: nowrap;
  grid-column: 1;
}
.asgn-link .badge {
  grid-column: 2;
  grid-row: 1 / span 2;
  margin: 0;
  white-space: nowrap;
}
.grade-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
  gap: .45rem;
}
.grade-checkbox {
  display: flex;
  align-items: center;
  gap: .45rem;
  padding: .48rem .55rem;
  border: 1px solid var(--line);
  background: var(--paper-strong);
  color: var(--ink);
  font-size: .84rem;
  font-weight: 700;
}
.subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  margin-top: .2rem;
}
.subhead h3 { margin: 0; font-size: .95rem; }
.login {
  min-height: 100svh;
  display: grid;
  align-items: center;
  padding: 1rem;
}
.login-panel {
  width: min(440px, 100%);
  margin: 0 auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 1rem;
}
.login-logo { display: flex; align-items: center; gap: .75rem; margin-bottom: 1rem; }
.login-logo img { width: 56px; height: 56px; object-fit: contain; }
.login-logo h1 { margin: 0; font-size: 1.55rem; }
.login-logo p { margin: .1rem 0 0; color: var(--muted); }
.notice { color: var(--muted); font-size: .86rem; line-height: 1.4; }
.danger { color: var(--red); font-weight: 800; }
.update-status {
  display: grid;
  gap: .65rem;
  padding: .75rem;
  border: 1px solid var(--line);
  background: var(--paper-strong);
}
.update-status-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .75rem;
}
.update-status-head strong { font-size: .95rem; }
.update-status-head span { color: var(--muted); font-size: .8rem; font-weight: 800; }
.progress-track {
  height: 12px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  background: var(--paper);
}
.progress-fill {
  height: 100%;
  width: var(--progress-value);
  background: var(--accent);
  transition: width .2s ease;
}
.update-log {
  max-height: 220px;
  overflow: auto;
  margin: 0;
  padding: .65rem;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--muted);
  font-size: .78rem;
  white-space: pre-wrap;
}
.update-actions {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: .65rem;
}
.update-actions label {
  min-width: min(260px, 100%);
}
.update-actions button {
  min-height: 38px;
}
.backup-list {
  display: grid;
  gap: .55rem;
}
.backup-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .75rem;
  align-items: center;
  padding: .65rem;
  border: 1px solid var(--line);
  background: var(--paper-strong);
}
.backup-row strong { display: block; font-size: .88rem; overflow-wrap: anywhere; }
.backup-row span { display: block; color: var(--muted); font-size: .78rem; }
.report-summary {
  display: grid;
  grid-template-columns: 1fr;
  gap: .75rem;
}
.chart-panel {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: .95rem;
  box-shadow: var(--shadow);
}
.chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .75rem;
  margin-bottom: .8rem;
}
.chart-head h2 { margin: 0; font-size: 1rem; }
.chart-head span { color: var(--muted); font-size: .8rem; font-weight: 800; }
.bar-list,
.distribution {
  display: grid;
  gap: .55rem;
}
.bar-row,
.distribution-row {
  --bar-color: var(--accent);
  display: grid;
  grid-template-columns: minmax(92px, .42fr) minmax(0, 1fr) minmax(34px, auto);
  align-items: center;
  gap: .65rem;
  min-height: 34px;
  padding: .26rem .36rem;
  border: 1px solid color-mix(in srgb, var(--bar-color) 16%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--bar-color) 5%, var(--paper));
}
.distribution-row {
  grid-template-columns: 56px minmax(0, 1fr) minmax(34px, auto);
}
.bar-row b,
.distribution-row b {
  color: var(--ink);
  font-size: .84rem;
  font-weight: 820;
  overflow-wrap: anywhere;
}
.bar-track {
  height: 18px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--bar-color) 22%, var(--line));
  border-radius: 999px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--bar-color) 8%, transparent), transparent),
    var(--paper-strong);
  box-shadow: inset 0 1px 2px rgba(16, 24, 40, .08);
}
.bar-fill {
  height: 100%;
  width: var(--bar-value);
  border-radius: inherit;
  background: linear-gradient(90deg, var(--bar-color), color-mix(in srgb, var(--bar-color) 76%, #111827));
  transition: width .35s ease;
}
.bar-fill.good { --bar-color: var(--accent); }
.bar-fill.watch { --bar-color: var(--gold); }
.bar-fill.low { --bar-color: var(--red); }
.bar-row span,
.distribution-row span {
  display: inline-flex;
  justify-content: center;
  min-width: 2rem;
  padding: .12rem .42rem;
  border: 1px solid color-mix(in srgb, var(--bar-color) 24%, var(--line));
  border-radius: 999px;
  background: color-mix(in srgb, var(--bar-color) 10%, var(--paper-strong));
  color: var(--ink);
  font-size: .78rem;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.report-nav-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: .65rem;
}
.report-tile {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: .72rem;
  min-height: 104px;
  padding: .85rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--paper-strong);
  text-decoration: none;
  transition: transform .16s ease, border-color .16s ease, background .16s ease;
}
.report-tile:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 42%, var(--line));
  background: color-mix(in srgb, var(--accent-soft) 46%, var(--paper));
}
.report-tile.active {
  border-color: color-mix(in srgb, var(--accent) 56%, var(--line));
  background: var(--accent-soft);
}
.report-tile-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent-soft) 56%, var(--paper));
  color: var(--accent-dark);
}
.report-tile-icon svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.report-tile:hover .report-tile-icon,
.report-tile.active .report-tile-icon {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--line));
  background: var(--paper);
}
.report-tile-copy {
  display: grid;
  gap: .28rem;
  min-width: 0;
}
.report-tile strong { font-size: .95rem; }
.report-tile-copy span { color: var(--muted); font-size: .82rem; line-height: 1.4; }
.report-kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .65rem;
}
.report-kpi {
  display: grid;
  gap: .28rem;
  padding: .85rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
}
.report-kpi span { color: var(--muted); font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .025em; }
.report-kpi strong { font-size: 1.45rem; line-height: 1; }
.print-report-head {
  display: none;
}
.report-section-list {
  display: grid;
  gap: 1rem;
}
.report-grade-section {
  display: grid;
  gap: .65rem;
}
.report-grade-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .8rem;
  padding: .35rem 0;
  border-bottom: 1px solid var(--line);
}
.report-grade-head h3 { margin: 0; font-size: 1rem; }
.report-grade-head span { color: var(--muted); font-size: .84rem; font-weight: 750; }
.month-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: .75rem;
}
.month-block {
  display: grid;
  align-content: start;
  gap: .55rem;
  min-height: 128px;
  padding: .85rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
}
.month-block h3 {
  margin: 0;
  font-size: .9rem;
}
.birthday-list {
  display: grid;
  gap: .4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.birthday-list li {
  display: grid;
  gap: .12rem;
  padding-top: .4rem;
  border-top: 1px solid var(--line);
  font-size: .86rem;
}
.birthday-list li:first-child { border-top: 0; padding-top: 0; }
.birthday-list span { color: var(--muted); font-size: .78rem; }
.birthday-date { font-variant-numeric: tabular-nums; }
.board-report-list {
  display: grid;
  gap: .95rem;
  padding: .95rem;
}
.board-report-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(140px, .7fr) minmax(160px, .8fr);
  gap: 1rem;
  align-items: start;
}
.board-report-row strong { display: block; font-size: .92rem; }
.board-report-row span {
  display: block;
  color: var(--muted);
  font-size: .84rem;
  line-height: 1.38;
}
.grade-graph {
  display: grid;
  gap: .8rem;
}
.grade-graph-screen {
  display: grid;
  gap: .8rem;
}
.grade-graph-svg {
  width: 100%;
  min-height: 260px;
  display: block;
  overflow: visible;
}
.grade-graph-svg .guide { stroke: var(--line); stroke-dasharray: 4 4; }
.grade-graph-svg .axis { stroke: var(--line-strong); }
.grade-graph-svg .label { fill: var(--muted); font-size: 11px; font-family: inherit; }
.grade-graph-svg .line {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.grade-graph-svg .dot { stroke: var(--paper); stroke-width: 2; }
.grade-graph-svg .empty-msg { fill: var(--muted); font-size: 13px; text-anchor: middle; font-family: inherit; }
.graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: .45rem .75rem;
}
.graph-legend span {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  color: var(--muted);
  font-size: .82rem;
  font-weight: 750;
}
.graph-legend i {
  width: 22px;
  height: 3px;
  border-radius: 999px;
  background: var(--legend-color);
}
.grade-graph-print-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: .9rem 1rem;
}
.grade-graph-print-grid.single {
  grid-template-columns: 1fr;
}
.mini-subject-chart {
  display: grid;
  gap: .42rem;
  min-width: 0;
  padding: .82rem;
  border: 1px solid var(--line);
  border-left: 4px solid var(--subject-color, var(--accent));
  border-radius: 8px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--subject-color, var(--accent)) 5%, transparent), transparent 46%),
    var(--paper-strong);
}
.mini-subject-chart header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .5rem;
  padding-bottom: .12rem;
  border-bottom: 1px solid var(--line-strong);
}
.mini-subject-chart h3 {
  margin: 0;
  color: var(--ink);
  font-size: .92rem;
}
.mini-subject-chart span {
  color: var(--muted);
  font-size: .76rem;
  font-weight: 750;
  white-space: nowrap;
}
.mini-subject-chart svg {
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}
.report-card-actions { display: flex; justify-content: flex-end; gap: .55rem; }
.report-card-document {
  display: grid;
  gap: 1rem;
  color: #285f56;
}
.report-card-spread {
  width: min(1060px, 100%);
  min-height: 816px;
  box-sizing: border-box;
  margin: 0 auto;
  background: #fff;
  border: 1px solid #6d7773;
  box-shadow: var(--shadow);
  font-family: "Trebuchet MS", Arial, sans-serif;
}
.cover-spread {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 76px minmax(0, 1fr);
}
.inside-spread {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 2.4rem;
  padding: 40px 38px 32px;
}
.report-page { position: relative; padding: 66px 80px 32px; }
.report-spine {
  background: #9fb5ae;
  border-left: 4px double #275c53;
  border-right: 4px double #275c53;
}
.parent-page .parent-note {
  margin-top: 4px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
  line-height: 1.35;
}
.signature-line {
  width: 100%;
  border-top: 1px solid #285f56;
  text-align: center;
  margin-top: 50px;
  padding-top: 2px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
}
.generated-note {
  position: absolute;
  bottom: 28px;
  left: 0;
  right: 0;
  text-align: center;
  font-family: Georgia, "Times New Roman", serif;
  font-style: italic;
  color: #164c43;
}
.cover-page {
  display: grid;
  align-content: start;
  justify-items: center;
  text-align: center;
}
.cover-leaf { width: 44px; height: 44px; object-fit: contain; margin-bottom: 6px; }
.cover-page h2 {
  margin: 0 0 10px;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 36px;
  color: #1e5048;
  line-height: 1.1;
}
.cover-of {
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 700;
  margin-bottom: 24px;
}
.script-line {
  width: 330px;
  border-bottom: 1px solid #285f56;
  color: #111827;
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: 22px;
  line-height: 1.1;
  padding-bottom: 2px;
}
.cover-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 20px 0 26px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 700;
}
.blank-line {
  display: inline-block;
  min-width: 62px;
  border-bottom: 1px solid #285f56;
  color: #111827;
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: 20px;
  line-height: 1;
}
.school-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 700;
}
.school-line .script-line {
  width: 200px;
  font-size: 21px;
}
.school-name-line {
  width: 330px;
  border-bottom: 1px solid #285f56;
  color: #111827;
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: 20px;
  line-height: 1.1;
  padding-bottom: 2px;
  white-space: nowrap;
}
.book-mark { width: 132px; height: 96px; margin: 2px 0 16px; }
.verse {
  max-width: 260px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
  font-style: italic;
  line-height: 1.2;
}
.parents-copy {
  max-width: 310px;
  margin-top: 66px;
  text-align: left;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
  line-height: 1.3;
}
.parents-copy em { display: block; margin-bottom: 8px; }
.board-signoff { text-align: right; font-style: italic; }
.period-grid-wrap {
  display: grid;
  grid-template-columns: minmax(155px, 1fr) 216px;
  gap: 16px;
  align-items: start;
}
.subject-list,
.conduct-list {
  color: #2b6b61;
  font-size: 12px;
  line-height: 1.32;
}
.subject-list span { display: block; }
.subject-list .sub,
.conduct-list .sub {
  display: block;
  padding-left: 14px;
  font-size: 12px;
}
.period-table,
.conduct-table,
.attendance-table {
  border-collapse: collapse;
  width: 100%;
  table-layout: fixed;
  border-bottom: 2px solid #2e675d;
}
.period-table th,
.period-table td,
.conduct-table th,
.conduct-table td,
.attendance-table th,
.attendance-table td {
  border: 2px solid #2e675d;
  height: 16px;
  padding: 0 3px;
  text-align: center;
  vertical-align: middle;
  color: #111827;
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: 13px;
  line-height: 1;
}
.period-table th,
.conduct-table th,
.attendance-table th {
  background: #638980;
  color: #fff;
  font-family: "Trebuchet MS", Arial, sans-serif;
  font-size: 11px;
  font-weight: 700;
}
.period-table .average-col {
  background: #eef5f2;
  color: #164c43;
  font-family: "Trebuchet MS", Arial, sans-serif;
  font-weight: 700;
}
.period-table th.average-col {
  background: #51786f;
  color: #fff;
  font-size: 10px;
}
.key-subject {
  margin-top: 24px;
  color: #2b6b61;
  font-size: 12px;
  line-height: 1.55;
}
.key-subject h3,
.conduct-panel h3,
.attendance h3 {
  margin: 0 0 4px;
  color: #285f56;
  font-size: 15px;
}
.key-row {
  display: grid;
  grid-template-columns: 28px 92px 1fr;
  gap: 12px;
}
.conduct-panel {
  display: grid;
  grid-template-columns: minmax(230px, 1fr) 186px;
  gap: 22px;
  color: #2b6b61;
  font-size: 12px;
  line-height: 1.36;
}
.conduct-panel h3 { text-transform: uppercase; letter-spacing: .02em; }
.conduct-section strong {
  display: block;
  color: #2b6b61;
  font-size: 14px;
  line-height: 1.15;
  margin: 1px 0;
  padding-left: 5px;
  background: linear-gradient(90deg, rgba(99, 137, 128, .22), rgba(99, 137, 128, 0));
}
.conduct-section span { display: block; padding-left: 15px; }
.conduct-table td {
  height: 17px;
  font-size: 12px;
  background: #fff;
}
.conduct-table tr.conduct-section-row td {
  background: linear-gradient(90deg, #dcebe6, #f7fbf9);
}
.conduct-table th,
.conduct-table td {
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.conduct-keys {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-top: 14px;
  color: #164c43;
  font-size: 12px;
  line-height: 1.45;
}
.attendance {
  margin-top: 20px;
  display: grid;
  grid-template-columns: minmax(150px, 1fr) 284px;
  gap: 18px;
  align-items: start;
  color: #164c43;
}
.attendance-labels {
  display: grid;
  grid-template-rows: 20px 20px 20px;
  align-items: center;
}
.attendance-labels h3 {
  align-self: center;
  margin: 0;
}
.attendance-labels div,
.attendance-labels strong {
  min-height: 20px;
  display: flex;
  align-items: center;
}
.attendance-table th,
.attendance-table td {
  height: 20px;
  line-height: 1;
  vertical-align: middle;
}
  @media (min-width: 720px) {
  .top-actions { justify-content: end; }
  .main { padding: 1.2rem 1rem 4rem; }
  .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .form-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .form-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .form-grid.five { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .absence-form {
    grid-template-columns: 170px minmax(260px, 1fr);
  }
  .absence-date-field { grid-column: 1; }
  .absence-student-field { grid-column: 2; }
  .absence-notes-field { grid-column: 1 / -1; }
  .family-form-section-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .filters { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); align-items: end; }
  .compact-filters { grid-template-columns: repeat(auto-fill, minmax(130px, 180px)); }
  .class-average-callout { min-width: 190px; }
  .score-row { grid-template-columns: minmax(220px, 1fr) 120px; }
  .asset-preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .report-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .report-nav-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .report-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (min-width: 1040px) {
  .app { grid-template-columns: 168px 1fr; max-width: none; }
  .topbar { grid-column: 1 / -1; }
  .mobile-nav-strip { display: none; }
  .sidebar {
    display: grid;
    position: sticky;
    top: calc(var(--demo-offset) + var(--topbar-height));
    height: calc(100svh - var(--demo-offset) - var(--topbar-height));
    max-height: none;
    align-self: start;
    grid-auto-flow: row;
    grid-auto-columns: auto;
    align-content: start;
    border-right: 1px solid var(--line);
    border-bottom: 0;
    padding: .8rem .65rem;
  }
  .sidebar-context {
    display: grid;
    gap: .55rem;
    margin-bottom: .35rem;
    padding: .05rem .1rem .75rem;
    border-bottom: 1px solid var(--line);
  }
  .sidebar-context .year-form select { width: 100%; }
  .nav-link { border-radius: var(--radius); }
  .main { padding: 1.35rem 1.35rem 4rem; }
  .app-footer { grid-column: 2; }
  .split { grid-template-columns: minmax(0, 1.2fr) minmax(330px, .8fr); align-items: start; }
  .gradebook-split {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
    grid-template-areas: "scores history";
  }
  .absence-form {
    grid-template-columns: 170px minmax(260px, 420px) max-content 104px max-content;
  }
  .absence-notes-field {
    grid-column: 1 / 3;
    max-width: 620px;
  }
  .absence-submit {
    grid-column: 3;
    justify-self: start;
    min-width: 136px;
  }
  .gradebook-score-panel { grid-area: scores; }
  .assignment-history-panel { grid-area: history; }
  .kpis { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .family-layout { grid-template-columns: 320px minmax(0, 1fr); align-items: start; }
  .assignments-layout { grid-template-columns: minmax(270px, 34%) minmax(0, 1fr); align-items: start; }
  .family-module-grid { grid-template-columns: 300px minmax(0, 1fr); align-items: start; }
  .setup-layout { grid-template-columns: 260px minmax(0, 1fr); align-items: start; }
  .sidebar-utility { margin-top: auto; padding-top: .75rem; border-top: 1px solid var(--line); }
}
@media (min-width: 1280px) {
  .assignments-layout { grid-template-columns: minmax(280px, 32%) minmax(0, 1fr); }
}
@media (max-width: 820px) {
  .topbar { gap: .5rem; }
  .brand { gap: .5rem; }
  .brand img { width: 34px; height: 30px; }
  .brand-text span { display: none; }
  .top-actions { gap: .35rem; }
  .user-chip { max-width: 112px; }
  .user-role { display: none; }
  .logout-btn { padding: .36rem .5rem; }
  .page-head { align-items: stretch; flex-direction: column; }
  .detail-grid { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .main { padding: .8rem .7rem 2.4rem; }
  .workspace { gap: .8rem; }
  .page-head { gap: .45rem; padding-top: .15rem; }
  .page-head h1 { font-size: 1.42rem; }
  .page-head p { font-size: .94rem; line-height: 1.38; }
  .panel, .ledger, .chart-panel, .family-list, .family-detail, .setup-nav { border-radius: 10px; }
  .kpis { gap: .55rem; }
  .kpi { padding: .72rem; border-radius: 10px; }
  .kpi strong { font-size: 1.36rem; }
  .kpi span { font-size: .78rem; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .table-wrap table { min-width: 620px; }
  .compact-table table { min-width: 0; }
  .chart-head { align-items: start; }
  .mobile-nav-strip { grid-template-columns: minmax(0, 1fr) minmax(104px, 124px); }
}
@media (max-width: 390px) {
  .topbar { padding-inline: max(.65rem, env(safe-area-inset-left)) max(.65rem, env(safe-area-inset-right)); }
  .user-chip { max-width: 86px; font-size: .78rem; }
  .logout-btn { font-size: .78rem; padding-inline: .42rem; }
  .mobile-nav-strip { padding-inline: max(.65rem, env(safe-area-inset-left)) max(.65rem, env(safe-area-inset-right)); grid-template-columns: minmax(0, 1fr) 108px; }
}
@media print {
  @page { size: letter portrait; margin: .48in .55in; }
  @page report-card-page { size: letter landscape; margin: 0; }
  html, body { width: auto; margin: 0; background: #fff; color: #000; }
  .demo-banner, .topbar, .mobile-nav-strip, .sidebar, .app-footer, .filters, .inline-actions, .quick-scores, .report-card-actions, .panel, .page-head, .report-nav-grid { display: none !important; }
  .app { display: block; width: 100%; }
  .main { padding: 0; }
  .workspace,
  .grade-graph-report,
  .grade-graph {
    display: block;
  }
  .print-report-head {
    display: block;
    margin: 0 0 .22in;
    text-align: center;
    color: #000;
  }
  .print-report-head h1 {
    margin: 0;
    font-size: 18pt;
    line-height: 1.15;
  }
  .print-report-head p {
    margin: .03in 0 0;
    font-size: 10pt;
    color: #222;
  }
  .panel, .ledger, .kpi, .chart-panel, .month-block, .report-kpi {
    box-shadow: none;
    break-inside: avoid;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .grade-graph.chart-panel {
    margin: 0;
    padding: 0;
    break-inside: auto;
    break-before: avoid;
    page-break-before: avoid;
    page-break-inside: auto;
  }
  .grade-graph-report .print-report-head {
    margin-bottom: .08in;
    break-after: avoid;
    page-break-after: avoid;
  }
  .ledger-head, .chart-head { display: none; }
  th, td {
    border-bottom-color: #cfcfcf;
    padding: .05in .06in;
    color: #000;
    font-size: 9.5pt;
  }
  th {
    background: transparent;
    color: #000;
    font-size: 8.5pt;
  }
  .student-report .family-detail-body,
  .birthday-report .family-detail-body { padding: 0; }
  .student-report .report-section-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .08in .42in;
    align-items: start;
  }
  .student-report .report-grade-section {
    gap: 0;
    break-inside: avoid;
  }
  .student-report .report-grade-head {
    padding: .02in 0;
    border-bottom: 1px solid #c8c8c8;
  }
  .student-report .report-grade-head h3,
  .month-block h3 {
    font-size: 10pt;
    font-weight: 800;
  }
  .student-report .report-grade-head span,
  .month-block h3 span {
    color: #000;
    font-size: 9pt;
    font-weight: 400;
  }
  .student-report th,
  .student-report td:nth-child(3),
  .student-report td:nth-child(4) { display: none; }
  .student-report td {
    border: 0;
    padding: .01in 0;
    font-size: 9.2pt;
  }
  .student-report td:nth-child(2) {
    display: table-cell;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .month-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .16in .52in;
  }
  .month-block {
    min-height: 0;
    padding: 0;
  }
  .month-block h3 {
    display: flex;
    justify-content: space-between;
    margin: 0 0 .04in;
    padding: 0 0 .02in;
    border-bottom: 1px solid #c8c8c8;
  }
  .birthday-list {
    gap: 0;
  }
  .birthday-list li {
    grid-template-columns: minmax(0, 1fr) .95in;
    gap: .12in;
    border: 0;
    padding: .01in 0;
    font-size: 9.2pt;
  }
  .birthday-list span {
    color: #000;
    font-size: 9.2pt;
    text-align: right;
  }
  .birthday-meta { display: none !important; }
  .board-report-list {
    gap: .18in;
    padding: 0;
  }
  .board-report-row {
    grid-template-columns: minmax(2.4in, 1fr) 1.55in minmax(1.8in, 1fr);
    gap: .32in;
    break-inside: avoid;
  }
  .board-report-row strong,
  .board-report-row span {
    color: #000;
    font-size: 10pt;
  }
  .board-report-row strong { font-weight: 800; }
  .grade-graph-screen { display: none; }
  .grade-graph-print-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .06in .24in;
    margin: 0;
    break-before: avoid;
    page-break-before: avoid;
  }
  .grade-graph-print-grid.single {
    grid-template-columns: 1fr;
  }
  .mini-subject-chart {
    break-inside: avoid;
    page-break-inside: avoid;
    padding: 0;
    border: 0;
    background: transparent;
  }
  .mini-subject-chart header {
    gap: .08in;
    padding-bottom: .01in;
  }
  .mini-subject-chart h3 { font-size: 9.3pt; }
  .mini-subject-chart span { color: #333; font-size: 7.6pt; }
  .mini-subject-chart svg text { font-family: Arial, sans-serif; }
  body.report-card-printing { page: report-card-page; width: 11in; }
  body.report-card-printing .workspace > :not(.report-card-document) { display: none !important; }
  body.report-card-printing .report-card-document { display: block; gap: 0; width: 11in; }
  body.report-card-printing .report-card-spread {
    width: 11in;
    height: 8.5in;
    min-height: 8.5in;
    margin: 0;
    border: 0;
    box-shadow: none;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  body.report-card-printing .report-card-spread:last-child { page-break-after: auto; break-after: auto; }
  body.report-card-printing .period-table,
  body.report-card-printing .conduct-table,
  body.report-card-printing .attendance-table { border-bottom-width: .75px; }
  body.report-card-printing .period-table th,
  body.report-card-printing .period-table td,
  body.report-card-printing .conduct-table th,
  body.report-card-printing .conduct-table td,
  body.report-card-printing .attendance-table th,
  body.report-card-printing .attendance-table td { border-width: .75px; }
}`;
const APP_CLIENT_SCRIPT = `function generateReportCardPdf(btn) {
  var orig = btn.textContent;
  btn.textContent = 'Preparing…';
  btn.disabled = true;
  function restore() {
    btn.textContent = orig; btn.disabled = false;
    document.body.classList.remove('report-card-printing');
  }
  document.body.classList.add('report-card-printing');
  setTimeout(function() {
    window.print();
    setTimeout(restore, 700);
  }, 50);
}
(function(){
  const root = document.documentElement;
  const saved = localStorage.getItem('oakstead-theme');
  const scoreQueue = (${createScoreSaveQueue.toString()})({ send: sendGridScore, onChange: renderGridSave });
  const resumedForms = new WeakSet();
  let activeScoreInput = null;
  let navAbort = null;
  let navigating = false;
  let displayedUrl = window.location.href;
  if (saved === 'dark') root.setAttribute('data-theme', 'dark');

  function mainEl() {
    return document.querySelector('[data-app-main]') || document.querySelector('.main');
  }

  function setMobileNav(open) {
    const navToggle = document.getElementById('navToggle');
    document.body.classList.toggle('nav-open', open);
    if (navToggle) navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function canUseAppNav(url) {
    return url.origin === window.location.origin
      && !url.pathname.startsWith('/assets/')
      && url.pathname !== '/backup/download'
      && url.pathname !== '/system-update/status';
  }

  function isSamePageHash(url) {
    return url.hash && url.pathname === window.location.pathname && url.search === window.location.search;
  }

  function updateShellFrom(doc) {
    const currentNav = document.querySelector('.nav-links');
    const nextNav = doc.querySelector('.nav-links');
    if (currentNav && nextNav) currentNav.innerHTML = nextNav.innerHTML;
    const currentMobileLabel = document.querySelector('#navToggle .nav-toggle-main span');
    const nextMobileLabel = doc.querySelector('#navToggle .nav-toggle-main span');
    if (currentMobileLabel && nextMobileLabel) currentMobileLabel.textContent = nextMobileLabel.textContent;
  }

  async function navigateApp(to, options) {
    if (navigating) return false;
    navigating = true;
    const inputs = Array.from(document.querySelectorAll('[data-grid-score-input]:not(:disabled)'));
    inputs.forEach(function(input) { input.disabled = true; });
    try {
      if (!(await scoreQueue.flush())) return false;
      scoreQueue.forgetClean();
      return await performNavigation(to, options);
    } finally {
      inputs.forEach(function(input) { input.disabled = false; });
      navigating = false;
    }
  }

  function performNavigation(to, options) {
    options = options || {};
    const nextUrl = new URL(to, window.location.href);
    if (!canUseAppNav(nextUrl)) {
      window.location.href = nextUrl.toString();
      return Promise.resolve(false);
    }
    const currentMain = mainEl();
    if (!currentMain) {
      window.location.href = nextUrl.toString();
      return Promise.resolve(false);
    }
    if (navAbort) navAbort.abort();
    navAbort = new AbortController();
    currentMain.classList.add('app-loading');
    return fetch(nextUrl.toString(), {
      signal: navAbort.signal,
      headers: { Accept: 'text/html', 'X-Requested-With': 'Oakstead-App-Shell' }
    }).then(function(response) {
      if (!response.ok) throw new Error('Navigation failed');
      return response.text().then(function(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const nextMain = doc.querySelector('[data-app-main]') || doc.querySelector('.main');
        if (!nextMain) {
          window.location.href = response.url || nextUrl.toString();
          return false;
        }
        document.title = doc.title || document.title;
        updateShellFrom(doc);
        const liveMain = mainEl();
        liveMain.replaceWith(document.importNode(nextMain, true));
        if (options.push !== false) history.pushState({ oaksteadApp: true }, '', nextUrl.toString());
        displayedUrl = window.location.href;
        if (options.scroll !== false) window.scrollTo(0, 0);
        setMobileNav(false);
        initDynamicContent(mainEl());
        return true;
      });
    }).catch(function(error) {
      if (error.name === 'AbortError') return false;
      window.location.href = nextUrl.toString();
      return false;
    }).finally(function() {
      const liveMain = mainEl();
      if (liveMain) liveMain.classList.remove('app-loading');
    });
  }

  function formToUrl(form) {
    const url = new URL(form.getAttribute('action') || window.location.href, window.location.href);
    url.search = '';
    new FormData(form).forEach(function(value, key) {
      if (key) url.searchParams.append(key, value);
    });
    return url;
  }

  function submitFormSmoothly(form, options) {
    if (!form) return;
    const method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method !== 'get' || form.classList.contains('year-form') || form.dataset.noAppNav !== undefined) {
      if (awaitGridForm(form)) form.requestSubmit();
      return;
    }
    navigateApp(formToUrl(form), options);
  }

  function goToUrl(url, options) {
    const nextUrl = new URL(url, window.location.href);
    navigateApp(nextUrl, options);
  }

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function(){
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next === 'dark' ? 'dark' : '');
      localStorage.setItem('oakstead-theme', next);
    });
  }

  const navToggle = document.getElementById('navToggle');
  const primaryNav = document.getElementById('primaryNav');
  if (navToggle && primaryNav) {
    navToggle.addEventListener('click', function(event) {
      event.stopPropagation();
      setMobileNav(!document.body.classList.contains('nav-open'));
    });
    primaryNav.addEventListener('click', function(event) {
      if (event.target.closest('a')) setMobileNav(false);
    });
    document.addEventListener('click', function(event) {
      if (!document.body.classList.contains('nav-open')) return;
      if (primaryNav.contains(event.target) || navToggle.contains(event.target)) return;
      setMobileNav(false);
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') setMobileNav(false);
    });
  }

  document.querySelectorAll('.year-form select').forEach(function(select) {
    select.addEventListener('change', function() {
      submitFormSmoothly(select.form);
    });
  });

  document.addEventListener('click', function(event) {
    if (event.target.closest('[data-grid-retry]')) { void scoreQueue.retry(); return; }
    if (event.target.closest('[data-grid-discard]')) {
      if (window.confirm('Discard unsaved grade edits? Completed saves will remain.')) void scoreQueue.discard();
      return;
    }
    const printButton = event.target.closest('[data-print-page]');
    if (printButton) {
      window.print();
      return;
    }
    const pdfButton = event.target.closest('[data-generate-pdf]');
    if (pdfButton) {
      generateReportCardPdf(pdfButton);
      return;
    }
    const closeButton = event.target.closest('[data-dialog-close]');
    if (closeButton) {
      closeButton.closest('dialog')?.close();
      return;
    }
    const dialogButton = event.target.closest('[data-dialog-target]');
    if (dialogButton) {
      const dialog = document.getElementById(dialogButton.dataset.dialogTarget);
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      return;
    }
    if (event.target.matches('.assignment-dialog')) {
      event.target.close();
      return;
    }
    const scoreChip = event.target.closest('[data-score-chip]');
    if (scoreChip) {
      const target = activeScoreInput || document.querySelector('[data-score-input]');
      if (!target) return;
      target.value = scoreChip.dataset.scoreChip;
      updateScorePreview(target);
      if (target.matches('[data-grid-score-input]')) autosaveGridInput(target);
      const next = target.closest('.score-row')?.nextElementSibling?.querySelector('[data-score-input]');
      if (next) {
        next.focus();
        next.select();
      }
      return;
    }
    const anchor = event.target.closest('a[href]');
    if (!anchor || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.target || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin === window.location.origin && anchor.dataset.noAppNav !== undefined && scoreQueue.isDirty()) {
      event.preventDefault();
      scoreQueue.flush().then(function(saved) { if (saved) window.location.href = url.toString(); });
      return;
    }
    if (anchor.dataset.noAppNav !== undefined) return;
    if (!canUseAppNav(url) || isSamePageHash(url)) return;
    event.preventDefault();
    navigateApp(url);
  });

  function awaitGridForm(form) {
    if (!scoreQueue.isDirty()) return true;
    scoreQueue.flush().then(function(saved) { if (saved) form.requestSubmit(); });
    return false;
  }

  document.addEventListener('submit', function(event) {
    if (!scoreQueue.isDirty() || resumedForms.has(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = event.target;
    const submitter = event.submitter;
    scoreQueue.flush().then(function(saved) {
      if (!saved || !form.isConnected) return;
      resumedForms.add(form);
      try { form.requestSubmit(submitter || undefined); }
      finally { resumedForms.delete(form); }
    });
  }, true);

  window.addEventListener('beforeunload', function(event) {
    if (!scoreQueue.isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('submit', function(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method !== 'get' || form.classList.contains('year-form') || form.dataset.noAppNav !== undefined) return;
    event.preventDefault();
    navigateApp(formToUrl(form));
  });

  document.addEventListener('change', function(event) {
    const assignmentSelect = event.target.closest('[data-assignment-select]');
    if (assignmentSelect) {
      if (assignmentSelect.dataset.baseUrl) {
        const nextUrl = new URL(assignmentSelect.dataset.baseUrl, window.location.origin);
        if (assignmentSelect.value === '__new__') {
          nextUrl.searchParams.delete('assignmentId');
          nextUrl.searchParams.set('action', 'add');
        } else if (assignmentSelect.value) {
          nextUrl.searchParams.delete('action');
          nextUrl.searchParams.set('assignmentId', assignmentSelect.value);
        }
        goToUrl(nextUrl);
        return;
      }
      if (assignmentSelect.value) {
        submitFormSmoothly(assignmentSelect.form);
      } else {
        const url = new URL(window.location.href);
        url.searchParams.delete('assignmentId');
        goToUrl(url);
      }
      return;
    }
    const scoreModeToggle = event.target.closest('[data-score-mode-toggle]');
    if (scoreModeToggle) {
      goToUrl(scoreModeToggle.checked ? scoreModeToggle.dataset.wrongUrl : scoreModeToggle.dataset.percentUrl);
      return;
    }
    const gridToggle = event.target.closest('[data-grid-toggle]');
    if (gridToggle) {
      goToUrl(gridToggle.checked ? gridToggle.dataset.onUrl : gridToggle.dataset.offUrl);
      return;
    }
    const lettersToggle = event.target.closest('[data-grid-letters-toggle]');
    if (lettersToggle) {
      syncGridLettersToggle(lettersToggle, true);
      return;
    }
    if (event.target.matches('select[name="groupId"]')) {
      syncRoleOptions(event.target.closest('form'));
      return;
    }
    const gridInput = event.target.closest('[data-grid-score-input]');
    if (gridInput) {
      autosaveGridInput(gridInput);
      return;
    }
    const auto = event.target.closest('[data-auto-submit]');
    if (auto && auto.form) submitFormSmoothly(auto.form, { scroll: false });
  });

  document.addEventListener('focusin', function(event) {
    if (event.target.matches('[data-score-input]')) {
      activeScoreInput = event.target;
      window.setTimeout(function() { event.target.select?.(); }, 0);
    }
  });

  document.addEventListener('input', function(event) {
    if (event.target.matches('[data-score-input]')) {
      updateScorePreview(event.target);
      if (!event.target.matches('[data-grid-score-input]')) return;
    }
    if (event.target.matches('[data-grid-score-input]')) {
      const input = event.target;
      autosaveGridInput(input);
      return;
    }
    if (event.target.matches('input[name="maxScore"]')) {
      event.target.form?.querySelectorAll('[data-score-input]').forEach(updateScorePreview);
    }
  });

  document.addEventListener('keydown', function(event) {
    const input = event.target.closest('[data-grid-score-input]');
    if (!input || event.key !== 'Tab') return;
    const inputs = Array.from(document.querySelectorAll('[data-grid-score-input][data-assignment-id="' + input.dataset.assignmentId + '"]'));
    const index = inputs.indexOf(input);
    const next = inputs[index + (event.shiftKey ? -1 : 1)];
    if (!next) return;
    event.preventDefault();
    autosaveGridInput(input);
    next.focus();
    next.select?.();
  });

  window.addEventListener('popstate', function() {
    navigateApp(window.location.href, { push: false, scroll: false }).then(function(moved) {
      if (!moved) history.pushState({ oaksteadApp: true }, '', displayedUrl);
    });
  });

  history.replaceState({ oaksteadApp: true }, '', window.location.href);

  function formatScorePreviewNumber(value) {
    if (!Number.isFinite(value)) return '';
    return value.toFixed(1).replace(/\\.0$/, '');
  }

  function updateScorePreview(input) {
    const preview = input.closest('.score-entry-cell')?.querySelector('[data-score-preview]');
    if (!preview) return;
    const formPoints = Number(input.form?.querySelector('input[name="maxScore"]')?.value);
    const points = Number.isFinite(formPoints) && formPoints > 0 ? formPoints : Number(input.dataset.scorePoints || 100);
    const raw = Number(input.value);
    const mode = input.dataset.scoreMode || input.form?.querySelector('input[name="scoreMode"]')?.value || 'wrong';
    input.max = mode === 'percent' ? '100' : String(points);
    if (!Number.isFinite(raw)) {
      preview.textContent = mode === 'percent' ? formatScorePreviewNumber(points) + ' pts possible' : 'out of ' + formatScorePreviewNumber(points);
      return;
    }
    if (mode === 'percent') {
      const earned = Math.max(0, Math.min(points, (Math.max(0, Math.min(100, raw)) / 100) * points));
      preview.textContent = formatScorePreviewNumber(earned) + ' / ' + formatScorePreviewNumber(points) + ' pts';
      return;
    }
    const wrong = Math.max(0, Math.min(points, raw));
    const percent = points > 0 ? ((points - wrong) / points) * 100 : 0;
    preview.textContent = formatScorePreviewNumber(percent) + '%';
  }

  function syncGridLettersToggle(toggle, save) {
    const shell = toggle.closest('.gb-grid-shell');
    if (!save && localStorage.getItem('oakstead-gradebook-letters') === 'off') toggle.checked = false;
    shell?.classList.toggle('letters-hidden', !toggle.checked);
    if (save) localStorage.setItem('oakstead-gradebook-letters', toggle.checked ? 'on' : 'off');
  }

  function markGridCell(input, state) {
    const cell = input.closest('.gb-grid-score-cell');
    if (!cell) return;
    cell.classList.remove('saving', 'saved', 'save-error');
    if (state) cell.classList.add(state);
  }

  function gridHidden(container, name) {
    return container.querySelector('input[name="' + name + '"]')?.value || '';
  }

  function updateGridAverages(result, container) {
    if (!result || !result.display) return;
    const root = container || document;
    const assignmentId = String(result.assignmentId || '');
    const studentId = String(result.studentId || '');
    const assignmentAverage = assignmentId ? root.querySelector('[data-grid-assignment-average="' + assignmentId + '"]') : null;
    const studentAverage = studentId ? root.querySelector('[data-grid-student-average="' + studentId + '"]') : null;
    const classAverage = root.querySelector('[data-grid-class-average]');
    if (assignmentAverage && result.display.assignmentAverage !== undefined) assignmentAverage.innerHTML = result.display.assignmentAverage;
    if (studentAverage && result.display.studentAverage !== undefined) studentAverage.innerHTML = result.display.studentAverage;
    if (classAverage && result.display.classAverage !== undefined) classAverage.innerHTML = result.display.classAverage;
  }

  function autosaveGridInput(input) {
    const container = input.closest('[data-grid-autosave]');
    if (!container) return;
    const context = { actionUrl: container.dataset.action || '/gradebook' };
    ['csrfToken', 'schoolYearId', 'markingPeriodId', 'gradeLevel', 'subjectId', 'scoreMode'].forEach(function(name) {
      context[name] = gridHidden(container, name);
    });
    context.assignmentId = input.dataset.assignmentId;
    context.studentId = input.dataset.studentId;
    const key = [context.schoolYearId, context.assignmentId, context.studentId].join(':');
    scoreQueue.edit(key, input.value, context, input.dataset.originalValue);
  }

  async function sendGridScore(context, value, signal) {
    const formData = new FormData();
    Object.keys(context).forEach(function(name) { if (name !== 'actionUrl') formData.set(name, context[name]); });
    formData.set('action', 'grid-score');
    formData.set('scoreValue', value);
    const response = await fetch(context.actionUrl, { method: 'POST', body: formData, signal: signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Save failed');
    const result = await response.json();
    if (!result || result.ok !== true) throw new Error('Save failed');
    return result;
  }

  function renderGridSave(entry, result, state) {
    const container = document.querySelector('[data-grid-autosave]');
    if (!container) return;
    const context = entry.context;
    const input = container.querySelector('[data-grid-score-input][data-assignment-id="' + context.assignmentId + '"][data-student-id="' + context.studentId + '"]');
    if (input) {
      input.dataset.originalValue = entry.saved;
      if (!entry.sending && !entry.error && entry.value === entry.saved) input.value = entry.value;
      markGridCell(input, entry.error ? 'save-error' : entry.sending || entry.value !== entry.saved ? 'saving' : 'saved');
      if (result && entry.value === entry.saved) {
        const letter = input.closest('.gb-grid-score-cell')?.querySelector('.gb-cell-letter');
        if (letter && result.letter !== undefined) letter.textContent = result.letter || '';
      }
    }
    if (result) updateGridAverages(result, container);
    const status = container.querySelector('[data-grid-autosave-status]');
    if (status) status.textContent = state.halted ? 'Could not save. Retry or discard unsaved edits before leaving.' : state.dirty ? 'Saving...' : 'Saved';
    container.querySelectorAll('[data-grid-retry], [data-grid-discard]').forEach(function(button) { button.hidden = !state.halted; });
  }

  function syncRoleOptions(form) {
    if (!form) return;
    const groupSelect = form.querySelector('select[name="groupId"]');
    const roleSelect = form.querySelector('select[name="roleTypeId"]');
    if (!groupSelect || !roleSelect) return;
    const groupId = groupSelect.value;
    Array.from(roleSelect.options).forEach(function(option) {
      if (!option.value) return;
      const matches = !groupId || option.dataset.roleGroup === groupId;
      option.disabled = !matches;
      option.hidden = !matches;
    });
    if (roleSelect.selectedOptions[0] && roleSelect.selectedOptions[0].disabled) roleSelect.value = '';
  }

  function initUpdateTools(scope) {
    const panel = scope.querySelector('[data-update-status]');
    if (!panel) return;
    const updateForm = scope.querySelector('[data-update-form]');
    const updateCheckForm = scope.querySelector('[data-update-check-form]');
    const updateDownloadRow = scope.querySelector('[data-update-download-row]');
    const updateDownloadLink = scope.querySelector('[data-update-download]');
    const updateReleaseLink = scope.querySelector('[data-update-release]');
    function renderUpdateStatus(status) {
      if (!panel.isConnected || !status) return;
      const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
      const message = panel.querySelector('[data-update-message]');
      const percentLabel = panel.querySelector('[data-update-percent]');
      const progress = panel.querySelector('[data-update-progress]');
      const phase = panel.querySelector('[data-update-phase]');
      const log = panel.querySelector('[data-update-log]');
      if (message) message.textContent = status.message || '';
      if (percentLabel) percentLabel.textContent = percent + '%';
      if (progress) progress.style.setProperty('--progress-value', percent + '%');
      if (phase) phase.textContent = (status.phase || 'idle') + (status.targetVersion ? ' / target v' + status.targetVersion : '');
      if (log) log.textContent = status.log && status.log.length ? status.log.join('\\n') : 'No update activity yet.';
      if (updateDownloadRow && updateDownloadLink) {
        const downloadUrl = status.downloadUrl || status.installerDownloadUrl || '';
        updateDownloadRow.style.display = downloadUrl || status.releaseUrl ? 'flex' : 'none';
        updateDownloadLink.style.display = downloadUrl ? 'inline-flex' : 'none';
        if (downloadUrl) updateDownloadLink.href = downloadUrl;
        if (status.installerAssetName) updateDownloadLink.textContent = 'Download ' + status.installerAssetName;
      }
      if (updateReleaseLink) {
        updateReleaseLink.style.display = status.releaseUrl ? 'inline-flex' : 'none';
        if (status.releaseUrl) updateReleaseLink.href = status.releaseUrl;
      }
      [updateForm, updateCheckForm].forEach(function(form) {
        const button = form?.querySelector('button[type="submit"]');
        if (button) button.disabled = Boolean(status.running);
      });
      const channelInput = updateForm?.querySelector('input[name="channel"]');
      if (channelInput && status.channel) channelInput.value = status.channel;
    }
    function pollUpdateStatus() {
      if (!panel.isConnected) return;
      fetch('/system-update/status', { headers: { Accept: 'application/json' } })
        .then(function(response) { return response.ok ? response.json() : null; })
        .then(function(status) {
          renderUpdateStatus(status);
          if (status && status.running) setTimeout(pollUpdateStatus, 1400);
        })
        .catch(function() {});
    }
    if (updateForm && !updateForm.dataset.bound) {
      updateForm.dataset.bound = '1';
      updateForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const button = updateForm.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        fetch('/system-update', { method: 'POST', body: new FormData(updateForm), headers: { Accept: 'application/json' } })
          .then(function(response) { return response.json(); })
          .then(function(status) {
            renderUpdateStatus(status);
            if (status && (status.downloadUrl || status.installerDownloadUrl)) {
              window.location.href = status.downloadUrl || status.installerDownloadUrl;
            }
            setTimeout(pollUpdateStatus, 800);
          })
          .catch(function() { if (button) button.disabled = false; });
      });
      pollUpdateStatus();
    }
    if (updateCheckForm && !updateCheckForm.dataset.bound) {
      updateCheckForm.dataset.bound = '1';
      updateCheckForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const button = updateCheckForm.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        fetch('/system-update/check', { method: 'POST', body: new FormData(updateCheckForm), headers: { Accept: 'application/json' } })
          .then(function(response) { return response.json(); })
          .then(function(status) { renderUpdateStatus(status); })
          .catch(function() {})
          .finally(function() { if (button) button.disabled = false; });
      });
    }
  }

  function initDynamicContent(scope) {
    scope = scope || document;
    scope.querySelectorAll('[data-score-input]').forEach(updateScorePreview);
    scope.querySelectorAll('[data-grid-letters-toggle]').forEach(function(toggle) {
      syncGridLettersToggle(toggle, false);
    });
    scope.querySelectorAll('form[action="/person-roles"]').forEach(syncRoleOptions);
    initUpdateTools(scope);
  }

  initDynamicContent(document);
})();`;
function contentVersion(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
}
const APP_STYLESHEET_VERSION = contentVersion(APP_STYLESHEET);
const APP_CLIENT_SCRIPT_VERSION = contentVersion(APP_CLIENT_SCRIPT);
function staticAsset(text, contentType) {
  const body = Buffer.from(text);
  return { contentType, body, gzipped: zlib.gzipSync(body) };
}
const STATIC_ASSETS = new Map([
  ['/assets/app.css', staticAsset(APP_STYLESHEET, 'text/css; charset=utf-8')],
  ['/assets/app.js', staticAsset(APP_CLIENT_SCRIPT, 'text/javascript; charset=utf-8')]
]);

module.exports = { APP_STYLESHEET_VERSION, APP_CLIENT_SCRIPT_VERSION, STATIC_ASSETS };
