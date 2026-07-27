import test from "node:test";
import assert from "node:assert/strict";

import { parseAvgStatsHtml } from "../../scripts/update-players.mjs";

// Real per-player stats card shape: <h2> column headers followed by <td
// style="...font-size:1.6em;...">value</td> data cells, matched separately
// then paired up by array index (see parseAvgStatsHtml).
function cardHtml(headers, values) {
  const headerHtml = headers.map(h => `<h2>${h}</h2>`).join("");
  const cellHtml = values
    .map(v => `<td style="font-size:1.6em;">${v}</td>`)
    .join("");
  return `<div>${headerHtml}</div><table><tr>${cellHtml}</tr></table>`;
}

test("parses a well-formed stats card where headers and cells line up", () => {
  const html = cardHtml(
    ["Price", "~BE", "Pts", "Mins", "3/5Rd", "PPM", "$/Pt"],
    ["$409,600", "63", "47", "70", "40/47", "0.67", "$8,715"]
  );
  const result = parseAvgStatsHtml(html);
  assert.deepEqual(result, {
    avg: 47,
    minutes: 70,
    ppm: 0.67,
    last3Avg: 40,
    last5Avg: 47
  });
});

// Real bug class this guards against: a user-reported discrepancy where a
// player's 5-round average exactly equalled their season average - not
// plausible for real recent-form data. Root cause candidate found while
// investigating: header count and cell count are matched by two
// independent regexes and then indexed together with no check that they're
// the same length, so one missing/extra cell silently shifts every column
// after it into the wrong header's slot.
test("refuses to report any stat when header count and cell count disagree, instead of silently misaligning columns", () => {
  const html = cardHtml(
    ["Price", "~BE", "Pts", "Mins", "3/5Rd", "PPM", "$/Pt"],
    // one cell short - "Mins" is missing, so everything from "3/5Rd"
    // onward would otherwise be read from the wrong column
    ["$409,600", "63", "47", "40/47", "0.67"]
  );
  const result = parseAvgStatsHtml(html);
  assert.equal(result, null);
});

test("returns null when there are no headers or no cells at all", () => {
  assert.equal(parseAvgStatsHtml("<div>no stats card here</div>"), null);
});
