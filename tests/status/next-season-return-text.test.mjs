import test from "node:test";
import assert from "node:assert/strict";

import {
  injuryReturnMetaFromRecord,
  suspensionMetaFromRecord
} from "../../scripts/update-status.mjs";

// Real bug found via a user report: player_status.json's upstream generator
// already pre-classifies injuries into a coarse returnType ("indefinite" vs
// a specific round/week), but textOf(rec) stringifies the WHOLE record
// (including that returnType field) to scan for keywords. A record whose
// actual expectedReturn is the specific, meaningful "Next Season" was being
// swallowed into the same generic "Indefinite" bucket as records with truly
// no timeline at all, purely because returnType:"indefinite" happened to be
// present as an internal field - not because any injury text said so.
test("a record with expectedReturn 'Next Season' keeps that specific signal instead of collapsing to generic Indefinite", () => {
  const rec = {
    status: "out",
    reason: "Ankle",
    expectedReturn: "Next Season",
    sourceConfidence: "high",
    returnType: "indefinite",
    returnWindowMinWeeks: null,
    returnWindowMaxWeeks: null,
    returnWindowMinRound: null,
    returnWindowMaxRound: null
  };
  const meta = injuryReturnMetaFromRecord(rec, 22);
  assert.equal(meta.expectedReturnText, "Next season");
});

test("a record with genuinely no timeline (TBC, no returnType override) still falls back to TBC", () => {
  const rec = {
    status: "out",
    reason: "Hamstring",
    expectedReturn: "TBC"
  };
  const meta = injuryReturnMetaFromRecord(rec, 22);
  assert.equal(meta.expectedReturnText, "TBC");
});

test("a record whose text literally says indefinite still reports Indefinite", () => {
  const rec = {
    status: "out",
    reason: "Achilles",
    expectedReturn: "Indefinite"
  };
  const meta = injuryReturnMetaFromRecord(rec, 22);
  assert.equal(meta.expectedReturnText, "Indefinite");
});

test("a specific round match still wins over any indefinite-looking metadata", () => {
  const rec = {
    status: "out",
    reason: "Ankle",
    expectedReturn: "Round 23",
    returnType: "indefinite"
  };
  const meta = injuryReturnMetaFromRecord(rec, 22);
  assert.equal(meta.expectedReturnText, "Round 23");
});

test("suspension records get the same next-season precision fix", () => {
  const rec = {
    status: "out",
    reason: "Judiciary charge",
    expectedReturn: "Next Season",
    returnType: "indefinite"
  };
  const meta = suspensionMetaFromRecord(rec, 22);
  assert.equal(meta.expectedReturnText, "Next season");
});
