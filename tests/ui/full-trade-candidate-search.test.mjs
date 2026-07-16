import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync("index.html", "utf8");

function emptyReserveTradeBlock() {
  const start =
    index.indexOf('if(App.teamActionMode==="emptyReserveTrade")');

  const end =
    index.indexOf('if(App.teamActionMode==="reserveTrade")', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return index.slice(start, end);
}

test("empty reserve trade keeps every legal outside candidate", () => {
  const block = emptyReserveTradeBlock();

  assert.match(
    block,
    /App\.players[\s\S]*reserveSlotAccepts\(slotId,r\)/
  );

  assert.doesNotMatch(
    block,
    /\.slice\(0,\s*200\)/
  );
});

test("empty reserve search filters the complete candidate rendering", () => {
  const block = emptyReserveTradeBlock();

  assert.match(
    block,
    /oninput="filterTradeOptions\(this\.value\)"/
  );

  assert.match(
    block,
    /tradeOpts\.map\(p=>tradeOptionButton\(p,/
  );
});
