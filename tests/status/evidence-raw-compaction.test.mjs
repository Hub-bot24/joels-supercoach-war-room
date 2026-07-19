import test from "node:test";
import assert from "node:assert/strict";

import {
  compactEvidenceRecord
} from "../../scripts/update-status.mjs";

function rawDepth(record){
  let depth = 0;
  let current = record;

  while(
    current &&
    typeof current === "object" &&
    current.raw &&
    typeof current.raw === "object"
  ){
    depth++;
    current = current.raw;

    if(depth > 1000){
      throw new Error(
        "Unexpected unbounded raw chain"
      );
    }
  }

  return depth;
}

test(
  "recursive raw history is removed while useful evidence is preserved",
  () => {
    const record = {
      displayStatus: "ORIGIN",
      reason: "Representative-duty context found",
      updatedAt: "2026-07-20T00:00:00.000Z",
      sources: [
        {
          name: "Fixture source",
          url: "https://example.test/source"
        }
      ],
      metadata: {
        confidence: "high",
        raw: {
          oldMetadata: true
        }
      },
      raw: {
        displayStatus: "ORIGIN",
        reason: "Previous generated record",
        raw: {
          displayStatus: "ORIGIN",
          raw: {
            displayStatus: "ORIGIN"
          }
        }
      }
    };

    const compacted =
      compactEvidenceRecord(record);

    assert.equal(rawDepth(compacted), 0);
    assert.equal(compacted.raw, undefined);
    assert.equal(compacted.metadata.raw, undefined);
    assert.equal(
      compacted.displayStatus,
      "ORIGIN"
    );
    assert.equal(
      compacted.reason,
      "Representative-duty context found"
    );
    assert.equal(
      compacted.sources[0].url,
      "https://example.test/source"
    );
    assert.equal(
      compacted.metadata.confidence,
      "high"
    );
  }
);

test(
  "repeated compaction is idempotent",
  () => {
    const record = {
      status: "EXPECTED",
      evidence: {
        note: "Current evidence",
        raw: {
          old: true
        }
      },
      raw: {
        previous: true
      }
    };

    const once =
      compactEvidenceRecord(record);

    const twice =
      compactEvidenceRecord(once);

    assert.deepEqual(twice, once);
    assert.equal(rawDepth(twice), 0);
  }
);

test(
  "large recursive history collapses to a bounded record",
  () => {
    let record = {
      displayStatus: "ORIGIN",
      reason: "Current context",
      sources: [
        {
          name: "Current source"
        }
      ]
    };

    for(let index = 0; index < 400; index++){
      record = {
        displayStatus: "ORIGIN",
        reason: "Current context",
        sources: [
          {
            name: "Current source"
          }
        ],
        raw: record
      };
    }

    const beforeBytes =
      Buffer.byteLength(
        JSON.stringify(record),
        "utf8"
      );

    const compacted =
      compactEvidenceRecord(record);

    const afterBytes =
      Buffer.byteLength(
        JSON.stringify(compacted),
        "utf8"
      );

    assert.equal(rawDepth(compacted), 0);
    assert.ok(beforeBytes > 30000);
    assert.ok(afterBytes < 1000);
  }
);
