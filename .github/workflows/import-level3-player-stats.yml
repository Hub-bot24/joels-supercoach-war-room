name: Import Level 3 Player Stats

"on":
  workflow_dispatch:

permissions:
  contents: write

jobs:
  import-level3-stats:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Import CSV into players.json
        run: python scripts/import_level3_player_stats.py

      - name: Commit enriched players.json
        run: |
          git config user.name "github-actions"
          git config user.email "github-actions@github.com"
          git add players.json
          git commit -m "Import Level 3 player stats" || echo "No changes"
          git push
