import assert from "node:assert/strict";
import test from "node:test";
import {convert, exactChange, payment, toUnits} from "../scripts/economy.mjs";

const piece = (value, count) => ({value, count});

test("makes exact change when the highest denomination leaves an impossible remainder", () => {
  assert.deepEqual(exactChange(8, [piece(6), piece(4), piece(3)]), [piece(4, 2)]);
  assert.equal(exactChange(8, [piece(6), piece(4, 1), piece(3)]), null);
});

test("breaks a 5,000 note into either eligible denomination", () => {
  assert.deepEqual(exactChange(5_000, [piece(2_500), piece(1_000)]), [piece(2_500, 2)]);
  assert.deepEqual(exactChange(5_000, [piece(1_000)]), [piece(1_000, 5)]);
});

test("spends exact inventory first and can combine stacks to receive change", () => {
  assert.deepEqual(payment(8, [piece(10, 1), piece(4, 2)], [piece(2)]), {debit: [piece(4, 2)], change: []});
  assert.deepEqual(payment(7, [piece(6, 1), piece(5, 1)], [piece(4)]), {
    debit: [piece(6, 1), piece(5, 1)], change: [piece(4, 1)]
  });
  assert.throws(() => payment(7, [piece(6, 1), piece(5, 1)], [piece(3)]), /exact change/);
});

test("converts decimal exchange rates exactly in both directions", () => {
  const rate = {from: "yen", to: "credits", fromAmount: toUnits("0.3"), toAmount: toUnits("0.1")};
  assert.equal(convert(toUnits("1.5"), rate, "yen"), toUnits("0.5"));
  assert.equal(convert(toUnits("0.5"), rate, "credits"), toUnits("1.5"));
  assert.throws(() => convert(toUnits("0.1"), rate, "yen"), /exactly/);
  assert.throws(() => toUnits("0.0000001"), /six decimal places/);
});
