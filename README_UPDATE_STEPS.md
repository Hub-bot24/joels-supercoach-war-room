# Upload steps

1. Open your GitHub repo:
   https://github.com/hub-bot24/joels-supercoach-war-room

2. Upload/replace these files:
   - index.html
   - players.json
   - PLAYER_DATA_SCHEMA.md
   - scripts/update_players.py
   - .github/workflows/update-player-data.yml

3. Keep GitHub Pages set to:
   - Deploy from branch
   - main
   - /root

4. Open:
   https://hub-bot24.github.io/joels-supercoach-war-room/

5. The app will now try to load `players.json` automatically.

Blunt truth:
The automation shell is ready. The missing piece is the real allowed data source.
This version will not magically pull Ballr/SuperCoach data unless we connect a legal/allowed feed.