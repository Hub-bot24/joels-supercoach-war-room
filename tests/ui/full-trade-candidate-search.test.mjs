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


function functionBlock(name, nextName) {
  const start = index.indexOf(`function ${name}(`);
  const end = index.indexOf(`function ${nextName}(`, start);

  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} boundary must exist`);

  return index.slice(start, end);
}

test("field and reserve trade searches retain every legal candidate", () => {
  const field = functionBlock(
    "legalFieldTradeOptions",
    "legalReserveTradeOptions"
  );

  const reserve = functionBlock(
    "legalReserveTradeOptions",
    "playerTradePositions"
  );

  assert.doesNotMatch(field, /\.slice\(/);
  assert.doesNotMatch(reserve, /\.slice\(/);

  assert.doesNotMatch(
    index,
    /legalFieldTradeOptions\(slot,\s*80\)/
  );

  assert.doesNotMatch(
    index,
    /legalReserveTradeOptions\(p,\s*80\)/
  );
});

test("all three team trade paths search complete eligible pools", () => {
  const start = index.indexOf("function teamActionHtml()");
  const end = index.indexOf("function selectTeamSlot", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = index.slice(start, end);

  assert.doesNotMatch(
    block,
    /\.slice\(0,\s*(80|200)\)/
  );

  assert.match(block, /legalFieldTradeOptions\(slot\)/);
  assert.match(block, /legalReserveTradeOptions\(p\)/);
});
