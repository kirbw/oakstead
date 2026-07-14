<p align="center">
  <img src="assets/oakleaf.png" alt="Oakstead oak leaf" width="96" />
</p>

<h1 align="center">Oakstead</h1>

<p align="center">
  <strong>Rooted Records for Growing Minds.</strong><br />
  A straightforward school records and gradebook app for small schools.
</p>

<p align="center">
  <a href="https://github.com/kirbw/oakstead/releases/latest"><img src="https://img.shields.io/github/v/release/kirbw/oakstead?display_name=tag&amp;sort=semver&amp;style=flat-square&amp;color=2f6f52" alt="Latest Oakstead release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/kirbw/oakstead?style=flat-square&amp;color=2f6f52" alt="MIT license" /></a>
  <a href="https://demo.oakstead.school"><img src="https://img.shields.io/badge/live_demo-open-2f6f52?style=flat-square" alt="Open the live demo" /></a>
</p>

<p align="center">
  <a href="https://demo.oakstead.school"><strong>Explore the live demo</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/kirbw/oakstead/releases/latest">View the latest release</a>
  &nbsp;·&nbsp;
  <a href="docs/INSTALLATION.md">Installation guide</a>
</p>

![Oakstead dashboard showing enrollment totals and recent gradebook activity](assets/screenshots/dashboard.png)

## School records without enterprise complexity

Oakstead gives small schools one calm, organized place for the information they use every day. Keep families and students together, enter grades quickly, track attendance, prepare reports, and carry records forward from one school year to the next.

It is a good fit for private schools, classical schools, microschools, homeschool co-ops, and anyone who has outgrown a collection of spreadsheets but does not want a large subscription-based student information system.

## What Oakstead can do

| | |
|---|---|
| **Families and students**<br />Keep household contacts, birthdays, congregations, districts, enrollment history, grade placement, and classroom assignments together. | **Gradebook and assignments**<br />Enter an entire class quickly, use a spreadsheet-style grid, and calculate averages with custom weights and letter-grade scales. |
| **Attendance and school years**<br />Record absences and tardies, filter by grade or student, promote students, and still view prior-year records. | **Reports and report cards**<br />Create printable family, student, birthday, grade, and school-board reports, plus polished report cards and grade graphs. |
| **The right access for each person**<br />Give administrators, principals, teachers, and parents focused access to the records and tools appropriate to their role. | **Your data, under your control**<br />Run Oakstead on your own computer or trusted network, keep data in a single SQLite database, and create or restore backups from the app. |

## See it in action

<table>
  <tr>
    <td width="50%">
      <img src="assets/screenshots/gradebook.png" alt="Oakstead Gradebook showing Grade 5 Math assignments and scores" />
      <br /><strong>Fast grade entry.</strong> Students, assignments, averages, and letter grades stay visible in one working view.
    </td>
    <td width="50%">
      <img src="assets/screenshots/report-card.png" alt="Oakstead printable report card preview" />
      <br /><strong>Reports families can use.</strong> Build a printable report card directly from marking periods, grades, and attendance.
    </td>
  </tr>
</table>

The [public demo](https://demo.oakstead.school) is filled with sample school data and resets regularly, so you can explore freely.

## Get started

1. **Try it first.** Open the [live demo](https://demo.oakstead.school) to explore the Dashboard, Gradebook, Reports, Report Cards, and School Setup.
2. **Ready to host it?** Follow the [installation and deployment guide](docs/INSTALLATION.md) for source-based Windows or Linux requirements, startup, configuration, networking, backups, and updates.

Oakstead does not currently publish a tested Windows installer. For now, Windows and Linux installations run from source.

The first real login uses `admin` / `ChangeMeNow!`. Change that password before entering school data.

> [!IMPORTANT]
> Oakstead stores sensitive student and family records. Run it on a trusted local network or VPN. If remote access is necessary, use HTTPS and a protective reverse proxy with appropriate access controls. Do not expose a real Oakstead installation directly to the public internet.

## Why self-host Oakstead?

- No required monthly subscription
- No separate database server
- Responsive on phones, tablets, and desktops
- In-app backups and release updates
- Local control over school records and uploaded assets
- Open source under the MIT License

Oakstead uses a lightweight Node.js server and SQLite database, with server-rendered pages and no frontend framework. Technical requirements and configuration live in the [installation guide](docs/INSTALLATION.md).

## Documentation

- [Installation, configuration, and security](docs/INSTALLATION.md)
- [Release notes](RELEASE_NOTES.md)
- [Linux deployment](packaging/linux/README.md)
- [Project website](https://oakstead.school)
- [MIT License](LICENSE)

---

<p align="center">Built for schools that want their records organized, understandable, and close to home.</p>
