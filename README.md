# Fandango Odyssey seat notifier

A read-only GitHub Action that checks returned tickets for *The Odyssey* in
IMAX 70MM every five minutes and sends Discord alerts with a highlighted PNG
seat map. It never holds, reserves, or purchases tickets.

## Active filters

| Theater | Fandango ID | Showtimes |
| --- | --- | --- |
| Regal Edwards Ontario Palace | `AAEDM` | 2:20 PM, 3:00 PM |
| Regal Irvine Spectrum | `AABTB` | 2:30 PM |

- Exact rolling window: now through 168 hours from now
- Two adjacent standard seats
- Rows E, F, G, H, I, or K
- Geometric seat-quality score strictly greater than 50
- First successful observation is a silent baseline; alerts require an
  unavailable-to-available transition after that baseline

## Fast, conservative polling

- The workflow starts every five minutes, offset two minutes from the top of
  the hour to reduce GitHub scheduler congestion.
- Showtime catalogs refresh every 30 minutes; eligible seat maps refresh on
  every run.
- Seat maps use an interleaved three-request pool with starts staggered by
  250 ms. The order prioritizes the earliest upcoming showtimes across both
  theaters.
- All snapshots share one state object. The workflow commits it only when
  availability or error state changes, so unchanged checks do not create
  repository churn.
- Ontario uses Fandango's explicit neighbor links. Irvine's sparse neighbor
  metadata falls back to same-row coordinate and column proximity, preventing
  aisles and special-seat gaps from being treated as adjacent.
- HTML/bot responses are identified before JSON parsing. A blocking response
  opens an in-run circuit breaker, and invalid responses never replace the last
  good snapshot.
- Repeated identical errors are deduplicated for six hours; the next fully
  successful run sends a recovery message.

## GitHub deployment

1. Create a public repository and push this directory.
2. In **Settings → Secrets and variables → Actions**, create the repository
   secret `DISCORD_WEBHOOK_URL`.
3. Open **Actions → Fandango seat notifier → Run workflow** once. The first
   successful run silently establishes the baseline; scheduled checks then run
   every five minutes.

The committed `.notifier-state/state.json` contains only cached public
showtime/seat-availability data. The Discord webhook exists only as an
encrypted GitHub Actions secret.

## Local verification

```sh
npm install
npm run check
npm run coverage
npm run live-smoke -- --warm
```

The live smoke test uses an in-memory state store and suppresses Discord
delivery.

This project is unofficial and is not affiliated with Fandango or Regal. The
upstream interfaces are undocumented and can change without notice.
