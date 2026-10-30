// Single season truth for every data script.
//
// An NRL season runs entirely inside one calendar year, so the active season
// is simply the current year in Sydney time - nothing to edit by hand at
// rollover, and no script can drift onto a different year than the others
// (previously four scripts read a hand-edited data/source_config.json
// "season" while capture-player-scores.mjs used its own UTC year).
//
// SEASON in the environment overrides it, for deliberate backfills or manual
// re-runs of a past season. An invalid override throws rather than silently
// falling back to the calendar year.

const SEASON_TIME_ZONE = "Australia/Sydney";
const FIRST_SUPPORTED_SEASON = 2020;

function resolveSeason({ now = new Date(), env = process.env } = {}) {
  const override = env.SEASON;

  if (override !== undefined && override !== "") {
    const season = Number(override);
    if (!Number.isInteger(season) || season < FIRST_SUPPORTED_SEASON) {
      throw new Error(`Invalid SEASON override: ${override}`);
    }
    return season;
  }

  const year = new Intl.DateTimeFormat("en-AU", {
    timeZone: SEASON_TIME_ZONE,
    year: "numeric"
  }).format(now);

  return Number(year);
}

export { resolveSeason, SEASON_TIME_ZONE };
