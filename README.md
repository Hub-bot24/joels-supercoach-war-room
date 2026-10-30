# Joel's SuperCoach War Room

Fresh clean repo upload.

Files:
- index.html = app
- players.json = player database
- my_team.json = Joel's saved team
- scripts/update-players.mjs = GitHub Actions updater script
- .github/workflows/update-supercoach-data.yml = automation workflow

After upload:
1. Go to Settings > Pages.
2. Source: Deploy from branch.
3. Branch: main, folder: /(root).
4. Save.
5. Go to Actions.
6. You should see "Update SuperCoach Data".

## Season rollover

Automatic - nothing to edit. Every data script gets the season from
`scripts/lib/season.mjs`, which uses the current year in Sydney time (an NRL
season sits inside one calendar year). The active round is resolved by
`scripts/update-status.mjs` from real team lists and fixtures, and team-list
articles are discovered from `teamlistIndexUrls`, so no round or season is
stored in `data/source_config.json`.

To re-run a past season deliberately, set `SEASON` in the environment (e.g.
`SEASON=2025 node scripts/update-fixtures.mjs`). An invalid value throws.

From 1 January (Sydney time) the scripts target the new season. The new
draw loads as soon as the source publishes it, and the active round then
resolves to round 1. The price/BE updater stays on its normal schedule and
skips until round 1's price-update window has passed.

If the "Update SuperCoach Data" workflow ever goes red with "matched 0
canonical identities", check the job log's `[debug] price-be-source` /
`[debug] dpp-source` lines first - the source site most likely changed
its row format, and those lines show the real row text that's now
failing to parse.