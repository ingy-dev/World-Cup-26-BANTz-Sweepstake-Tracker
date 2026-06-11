# BANTz World Cup '26 Sweepstake Tracker

A live, browser-based wall-chart tracker for our FIFA World Cup 2026 group-chat
sweepstake and the "Sweepception" side bet. It pulls live results straight from
ESPN's free public API and updates itself automatically.

- **Wall Chart** - all 12 groups (A-L) with live tables, results, a country flag
  on every team and a colour-coded chip for the player who drew it.
- **Knockouts** - the bracket from the Round of 32 to the Final, filling in
  automatically as matches finish.
- **Leaderboard** - who's leading both pots:
  - `BANTz World Cup '26` (£60) -> owner of the team that wins the final.
  - `World Cup '26 Sweepception` (£30) -> the better assigned to the winner.
- **My Teams** - pick your name to see all the teams you have riding: your four
  picks plus the four belonging to the player you drew in the Sweepception.

## No build step required

This is a plain static site (HTML + CSS + vanilla JavaScript). There is nothing
to install or compile.

### Run it locally

Either just open `index.html` in your browser, or serve the folder (any of
these work):

```bash
# Ruby (preinstalled on macOS)
ruby -run -e httpd . -p 8000

# or Python 3
python3 -m http.server 8000
```

Then visit http://localhost:8000.

> Live results come from ESPN over HTTPS, so you need an internet connection.

## Deploy a shareable link (free)

Pick one:

- **GitHub Pages**: create a repo, push these files, then in
  *Settings -> Pages* set the source to your `main` branch (root). Your link
  will be `https://<you>.github.io/<repo>/`. No extra config is needed because
  all asset paths are relative.
- **Netlify / Vercel / Cloudflare Pages**: drag-and-drop this folder (or connect
  the repo). No build command, publish directory = project root.

## Updating the draw

Everything about the sweepstake lives in one file:
[`src/data/sweepstake.js`](src/data/sweepstake.js).

- `participants[].teams` reference team ids from
  [`src/data/teams.js`](src/data/teams.js).
- `participants[].better` is the person who drew that player in the Sweepception.
- `payouts` and `titles` control the headline amounts.

Edit, save, and redeploy - that's it. The team reference list (names, flags and
the aliases used to match ESPN's data) lives in `teams.js`.

## How the live data works

- Group tables: ESPN standings endpoint
  (`/apis/v2/sports/soccer/fifa.world/standings`).
- Fixtures, live scores and knockouts: ESPN scoreboard endpoint, fetched per
  matchday.
- The app loads the full tournament once, caches finished days, then re-checks
  the current day every 45 seconds for live updates.

Not affiliated with FIFA or ESPN. Team data and flags are used for personal,
non-commercial fun.
