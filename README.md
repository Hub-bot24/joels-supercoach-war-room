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

## Season rollover checklist

The only manual step required each new season: update `"season"` in
`data/source_config.json` to the new year. It feeds the dual-position
source URL directly, so nothing else needs to change. If it's left
stale, the DPP parser will fail loudly (it already throws when it finds
players but matches none) rather than silently going wrong.

If the "Update SuperCoach Data" workflow ever goes red with "matched 0
canonical identities", check the job log's `[debug] price-be-source` /
`[debug] dpp-source` lines first - the source site most likely changed
its row format, and those lines show the real row text that's now
failing to parse.