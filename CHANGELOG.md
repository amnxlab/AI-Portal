# Changelog

All notable changes to the AI/ML Lab Portal.

## [1.1.0] - 2026-11-15

The certificate the lab depends on now renews itself, notifications go where
they say they go, and the budget simulation bills the days people actually
work.

### Certificates and networking

- **The origin certificate is now issued by Let's Encrypt** over a DNS-01
  challenge and renewed automatically every 60 days by certbot, with a deploy
  hook that copies each renewal to nginx and reloads it. It replaces a private
  mkcert certificate that nothing renewed, whose CA key was on another
  machine, and whose expiry in 2028 would have stopped the card reader
  recording attendance with no warning. See `docs/certificates.md`.
- **DNS-01 rather than HTTP-01**, because the site is behind CGNAT: no inbound
  connection is needed, so issuance and renewal keep working behind any ISP.
- Site addressing moved into three environment variables — `WIFI_IP`,
  `PUBLIC_HOST`, `ROUTER_IP`. No configuration file names an address any more,
  which is what makes the deployment portable. See `docs/moving-the-server.md`.
- nginx selects its certificate by SNI, so a private certificate can be served
  alongside a public one during a migration without downtime.

### Notifications

- **Every notification type now has a destination.** Five types covering 43%
  of all notifications previously did nothing when clicked, because the
  routing switch ended in `default: break` and existed in three separate
  copies that had drifted apart. There is now one table, shared by the bell
  menu and the notifications page, and a notification that does not match it
  falls back to the notifications page rather than to nothing.
- **Mentions link to the comment, not just the page.** Notifications carry a
  new `context` column holding the comment id; the thread scrolls to it and
  highlights it briefly on arrival.
- **A manual awaiting review opens the manuals page.** File notifications now
  record what kind of file they are about — manuals and papers are both rows
  in `project_files`, so without that the reviewer was sent to whichever page
  the frontend guessed. Existing rows were backfilled.
- Deep links use URL parameters instead of router state, so a notification
  link survives a reload and the redirect back from the login page.

### Attendance

- **The Today row no longer pairs one session's clock-in with another's
  clock-out.** Someone who clocked in twice was shown the first clock-in
  beside the last clock-out with the day's total between them — a long span
  containing a minute of work. The row now shows the session in progress, or
  the most recent one, and says how many sessions make up the day.
- **The session editor cannot raise an unhandled rejection.** Form validation
  ran outside the try block and rejected with a plain object, which surfaced
  as `Unhandled Promise Rejection: [object Object]` — a crash screen in place
  of "give a reason". Errors are now readable everywhere via a shared
  formatter, and the editor checks the server's own rules (ordering, 24-hour
  limit, no future times) before sending.
- **Everyone can see their own hours.** The dashboard card was rendered only
  for people *without* `manage_attendance`, so every manager was shown
  everyone else's attendance and never their own. It now also summarises the
  month to date.

### Budget simulation

- **Monthly figures reflect the real assignment dates.** The table beside the
  chart priced every row as `rate x hours x 4.33` regardless of its start and
  end dates, so a one-day assignment was displayed at roughly thirty times its
  cost while the chart below showed the correct figure. The engine and the
  table now share one definition of which days count.
- **A Monday-to-Friday working week**, matching the schedule and report tabs.
  Weekly hours are spread over five days, so a Monday-to-Friday booking costs
  exactly one week instead of five sevenths of it. Full weeks and annual
  totals are unchanged.
- **Weekend work is an explicit per-period allowance**, off by default, and a
  period that bills nothing because every day of it is a weekend is flagged
  rather than quietly costing zero.
- **Hour caps are checked, including across overlapping periods.** Two
  overlapping 20 h/wk assignments really do bill 40 h/wk; nothing compared
  that against the person's limit before.

### Security

- Discord webhook URLs, seeded password hashes, the reader's API key, the
  Cloudflare tunnel id and this site's addressing are all out of the
  repository and behind environment variables or ignored files.

