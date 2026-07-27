import test from "node:test";
import assert from "node:assert/strict";

import {
  hasInjuryWords,
  hasSuspensionWords,
  injuryTypeFromText,
  injuryWindowHasPlayerEvidence
} from "../../scripts/update-status.mjs";

// Real bug found while hardening the injury pipeline: INJURY_WORDS/SUSPENSION_WORDS matching used
// plain substring checks, which is unsafe for short words. "squad" contains "quad", "expected"
// contains "pec", "comeback"/"setback"/"background" contain "back", "describe"/"contribute"
// contain "rib", "bandage" contains "ban", "ground"/"around"/"surround" contain "round". NRL
// reporting uses "squad" and "back" constantly for reasons that have nothing to do with an actual
// injury or suspension - this was a real, generic false-positive source across every player's
// evidence text, not specific to any one case. Word-boundary matching fixes it while a genuine
// match ("hamstring injury") still works.

test("hasInjuryWords does not fire on common words that merely contain an injury word as a substring", () => {
  assert.equal(hasInjuryWords("named in the extended squad this week"), false);
  assert.equal(hasInjuryWords("not confirmed as expected for round 22"), false);
  assert.equal(hasInjuryWords("a big comeback win after a slow start"), false);
  assert.equal(hasInjuryWords("analysts describe the game plan"), false);
});

test("hasInjuryWords still fires on genuine injury language", () => {
  assert.equal(hasInjuryWords("suffered a hamstring injury at training"), true);
  assert.equal(hasInjuryWords("has a quad strain and will be tested"), true);
  assert.equal(hasInjuryWords("back injury will keep him out"), true);
  assert.equal(hasInjuryWords("rib cartilage damage"), true);
});

test("hasSuspensionWords does not fire on words that merely contain 'ban' as a substring", () => {
  assert.equal(hasSuspensionWords("wearing a bandage on the wrist"), false);
  assert.equal(hasSuspensionWords("an urban legend about the club"), false);
});

test("hasSuspensionWords still fires on genuine suspension language", () => {
  assert.equal(hasSuspensionWords("suspended for one match"), true);
  assert.equal(hasSuspensionWords("banned by the judiciary"), true);
});

test("injuryTypeFromText does not misreport 'Pec' or 'Quad' from unrelated words", () => {
  assert.equal(injuryTypeFromText("not confirmed as expected for round 22"), "");
  assert.equal(injuryTypeFromText("named in the extended squad this week"), "");
});

test("injuryTypeFromText still correctly identifies a real body part", () => {
  assert.equal(injuryTypeFromText("suffered a hamstring tear"), "Hamstring");
  // Word-boundary matching also incidentally fixes a precision bug: "pec" used to match as a
  // substring prefix of "pectoral" before "pectoral" itself was ever checked, truncating the more
  // specific real word into the vaguer one. Now "pectoral" resolves to "Pectoral", not "Pec".
  assert.equal(injuryTypeFromText("pectoral injury in the warm-up"), "Pectoral");
  assert.equal(injuryTypeFromText("suffered a pec strain at training"), "Pec");
});

test("injuryWindowHasPlayerEvidence does not fire on 'squad'/'ground' mentions with no real injury word", () => {
  assert.equal(injuryWindowHasPlayerEvidence("named in the extended squad around the training ground"), false);
});

test("injuryWindowHasPlayerEvidence still fires on a genuine injury/return row", () => {
  assert.equal(injuryWindowHasPlayerEvidence("hamstring injury, expected to return in round 24"), true);
});
