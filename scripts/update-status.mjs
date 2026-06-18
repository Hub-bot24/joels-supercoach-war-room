Node 20 is being deprecated. This workflow is running with Node 24 by default. If you need to temporarily use Node 20, you can set the ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true environment variable. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
Run actions/setup-node@v4
  with:
    node-version: 20
    always-auth: false
    check-latest: false
    token: ***
Attempting to download 20...
(node:2274) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
Acquiring 20.20.2 - x64 from https://github.com/actions/node-versions/releases/download/20.20.2-23521894959/node-20.20.2-linux-x64.tar.gz
Extracting ...
/usr/bin/tar xz --strip 1 --warning=no-unknown-keyword --overwrite -C /home/runner/work/_temp/d1b183e5-e9e9-42fb-915f-6f63259f263f -f /home/runner/work/_temp/348c78a0-bf9b-4c5e-a69b-d75ec513a3ec
Adding to the cache ...
Environment details
  
20s
Run node scripts/update-status.mjs
  node scripts/update-status.mjs
  shell: /usr/bin/bash -e {0}
  env:
    ACTIVE_ROUND: 
  
{
  "step": "teamlist_sources",
  "configured": 6,
  "fetched": 0,
  "used": 0,
  "detectedRound": 0,
  "fixtureRound": 16,
  "storedRound": 16,
  "envRound": "",
  "round": 16,
  "urls": [],
  "rejected": []
}
{
  "step": "contract_validation_passed",
  "round": 16,
  "current_round": 16,
  "weather_round": 16,
  "weather_status": "fresh"
}
{
  "ok": true,
  "round": 16,
  "players": 563,
  "teamlistsLoaded": false,
  "summary": {
    "NAMED": 0,
    "EXPECTED": 18,
    "ORIGIN": 3,
    "NOT_NAMED": 395,
    "INJURED": 44,
    "SUSPENDED": 0,
    "BYE": 103
  },
  "newChanges": 0,
  "warnings": [
    "No current team-list data was loaded. No player can be GREEN/NAMED from fallback data."
  ]
}
0s
Run ls -la data || true
total 2520
drwxr-xr-x 3 runner runner   4096 Jun 18 02:49 .
drwxr-xr-x 6 runner runner   4096 Jun 18 02:48 ..
-rw-r--r-- 1 runner runner    205 Jun 18 02:49 current_round.json
drwxr-xr-x 2 runner runner   4096 Jun 18 02:48 history
-rw-r--r-- 1 runner runner 344220 Jun 18 02:49 injuries.json
-rw-r--r-- 1 runner runner    104 Jun 18 02:49 notifications.json
-rw-r--r-- 1 runner runner    173 Jun 18 02:49 official_teamlists.json
-rw-r--r-- 1 runner runner  10681 Jun 18 02:49 origin.json
-rw-r--r-- 1 runner runner    130 Jun 18 02:49 origin_unavailable.json
-rw-r--r-- 1 runner runner   1233 Jun 18 02:48 source_config.json
-rw-r--r-- 1 runner runner 623933 Jun 18 02:49 status_previous.json
-rw-r--r-- 1 runner runner 625773 Jun 18 02:49 status_truth.json
-rw-r--r-- 1 runner runner    128 Jun 18 02:49 suspensions.json
-rw-r--r-- 1 runner runner 702042 Jun 18 02:48 teamlist_baseline_tuesday.json
-rw-r--r-- 1 runner runner 196142 Jun 18 02:49 teamlist_changes.json
-rw-r--r-- 1 runner runner    124 Jun 18 02:49 teamlists.json
-rw-r--r-- 1 runner runner  21360 Jun 18 02:49 weather.json
FOUND data/weather.json
FOUND data/official_teamlists.json
FOUND data/origin_unavailable.json
 M data/current_round.json
 M data/history/round_16_status.json
 M data/injuries.json
 D data/notification_message.md
 M data/notifications.json
 M data/official_teamlists.json
 M data/origin.json
 M data/origin_unavailable.json
 M data/status_previous.json
 M data/status_truth.json
 M data/suspensions.json
 M data/teamlists.json
 M data/weather.json
M  data/current_round.json
M  data/history/round_16_status.json
M  data/injuries.json
 D data/notification_message.md
M  data/notifications.json
M  data/official_teamlists.json
M  data/origin.json
M  data/origin_unavailable.json
M  data/status_previous.json
M  data/status_truth.json
M  data/suspensions.json
M  data/teamlists.json
M  data/weather.json
1s
Node 20 is being deprecated. This workflow is running with Node 24 by default. If you need to temporarily use Node 20, you can set the ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true environment variable. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
Run stefanzweifel/git-auto-commit-action@v5
Started: bash /home/runner/work/_actions/stefanzweifel/git-auto-commit-action/v5/entrypoint.sh
INPUT_REPOSITORY value: .
INPUT_STATUS_OPTIONS: 
INPUT_FILE_PATTERN: data/status_truth.json
data/teamlists.json
data/weather.json
data/official_teamlists.json
data/origin_unavailable.json
data/injuries.json
data/suspensions.json
data/current_round.json
data/origin.json
data/status_previous.json
data/teamlist_baseline_tuesday.json
data/teamlist_changes.json
data/notifications.json
data/notification_message.md
data/source_audit.json
data/history/*.json
INPUT_BRANCH value: 
From https://github.com/Hub-bot24/joels-supercoach-war-room
 * [new branch]      cursor/source-driven-position-updater-8668 -> origin/cursor/source-driven-position-updater-8668
 * [new branch]      devin/1780705193-persist-positions-load-fixtures -> origin/devin/1780705193-persist-positions-load-fixtures
 * [new branch]      devin/1780705745-player-status-engine-v1 -> origin/devin/1780705745-player-status-engine-v1
 * [new branch]      devin/1780706814-status-engine-v2 -> origin/devin/1780706814-status-engine-v2
 * [new branch]      devin/1780709273-return-window-engine-v1 -> origin/devin/1780709273-return-window-engine-v1
 * [new branch]      devin/1780710081-bye-missing-colour -> origin/devin/1780710081-bye-missing-colour
 * [new branch]      devin/1780710589-mobile-option-b -> origin/devin/1780710589-mobile-option-b
 * [new branch]      devin/1780789612-fix-duncan-identity -> origin/devin/1780789612-fix-duncan-identity
 * [new branch]      fix/player-weather-icons -> origin/fix/player-weather-icons
 * [new branch]      fix/weather-api-timeout-fail-soft -> origin/fix/weather-api-timeout-fail-soft
 * [new branch]      fix/weather-reliability-performance -> origin/fix/weather-reliability-performance
 * [new branch]      fix/weather-reliability-performance-clean -> origin/fix/weather-reliability-performance-clean
 * [new branch]      fix/weather-venue-matching -> origin/fix/weather-venue-matching
 * [new branch]      restore-good-version   -> origin/restore-good-version
 * [new branch]      v11-warroom            -> origin/v11-warroom
 * [new branch]      v34-disable-unsafe-status-schedules -> origin/v34-disable-unsafe-status-schedules
 * [new branch]      v34-final-teamlist-source-cleanup -> origin/v34-final-teamlist-source-cleanup
 * [new branch]      v34-harden-live-teamlist-discovery -> origin/v34-harden-live-teamlist-discovery
 * [new branch]      v34-source-discovery-dry-run -> origin/v34-source-discovery-dry-run
 * [new branch]      v35-field-trade-search-full-results -> origin/v35-field-trade-search-full-results
 * [new branch]      v35-field-trade-search-full-results-2 -> origin/v35-field-trade-search-full-results-2
 * [new branch]      v35-player-identity-resolution -> origin/v35-player-identity-resolution
 * [new branch]      v36-core-data-contract -> origin/v36-core-data-contract
 * [new branch]      v36-data-update-info-panel -> origin/v36-data-update-info-panel
 * [new branch]      v36-diagnose-data-contract-writes -> origin/v36-diagnose-data-contract-writes
 * [new branch]      v36-enable-auto-status-udates -> origin/v36-enable-auto-status-udates
 * [new branch]      v36-fix-data-freshness-layout -> origin/v36-fix-data-freshness-layout
 * [new branch]      v36-fix-data-loader-paths -> origin/v36-fix-data-loader-paths
 * [new branch]      v36-round-explicit-status-labels -> origin/v36-round-explicit-status-labels
M	data/current_round.json
M	data/history/round_16_status.json
M	data/injuries.json
D	data/notification_message.md
M	data/notifications.json
M	data/official_teamlists.json
M	data/origin.json
M	data/origin_unavailable.json
M	data/status_previous.json
M	data/status_truth.json
M	data/suspensions.json
M	data/teamlists.json
M	data/weather.json
Your branch is up to date with 'origin/main'.
INPUT_ADD_OPTIONS: 
INPUT_FILE_PATTERN: data/status_truth.json
data/teamlists.json
data/weather.json
data/official_teamlists.json
data/origin_unavailable.json
data/injuries.json
data/suspensions.json
data/current_round.json
data/origin.json
data/status_previous.json
data/teamlist_baseline_tuesday.json
data/teamlist_changes.json
data/notifications.json
data/notification_message.md
data/source_audit.json
data/history/*.json
INPUT_COMMIT_OPTIONS: 
INPUT_COMMIT_USER_NAME: github-actions[bot]
INPUT_COMMIT_USER_EMAIL: 41898282+github-actions[bot]@users.noreply.github.com
INPUT_COMMIT_MESSAGE: Update status truth data
INPUT_COMMIT_AUTHOR: Hub-bot24 <231393628+Hub-bot24@users.noreply.github.com>
[main 344662b] Update status truth data
 Author: Hub-bot24 <231393628+Hub-bot24@users.noreply.github.com>
 12 files changed, 12253 insertions(+), 21736 deletions(-)
INPUT_TAGGING_MESSAGE: 
No tagging message supplied. No tag will be added.
INPUT_PUSH_OPTIONS: 
To https://github.com/Hub-bot24/joels-supercoach-war-room
   6d1958b..344662b  main -> main
0s
0s
Node 20 is being deprecated. This workflow is running with Node 24 by default. If you need to temporarily use Node 20, you can set the ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true environment variable. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
Post job cleanup.
(node:2380) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
1s
Node 20 is being deprecated. This workflow is running with Node 24 by default. If you need to temporarily use Node 20, you can set the ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true environment variable. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
Post job cleanup.
/usr/bin/git version
git version 2.54.0
Temporarily overriding HOME='/home/runner/work/_temp/f1eaf560-7c6f-4783-8ef3-89593b70df5a' before making global git config changes
Adding repository directory to the temporary git global config as a safe directory
/usr/bin/git config --global --add safe.directory /home/runner/work/joels-supercoach-war-room/joels-supercoach-war-room
/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
http.https://github.com/.extraheader
/usr/bin/git config --local --unset-all http.https://github.com/.extraheader
/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
/usr/bin/git config --local --name-only --get-regexp ^includeIf\.gitdir:
/usr/bin/git submodule foreach --recursive git config --local --show-origin --name-only --get-regexp remote.origin.url
