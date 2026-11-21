import assert from "node:assert/strict";
import test from "node:test";
import {combineOptions, denominationOptions} from "../scripts/denomination-change.mjs";

const piece = (id, value, tier, count) => ({id, value, tier, count});

test("break options show exact single denominations for the requested stack quantity", () => {
  const source = piece("large", 5_000, 2, 2);
  const catalog = [piece("medium", 2_500, 3), piece("small", 1_000, 4), piece("awkward", 4_000, 3)];
  const {options} = denominationOptions("break", 1, source, [source], catalog);
  assert.deepEqual(options.map(({id, plan}) => [id, plan.change[0].count]), [["medium", 2], ["small", 5]]);
  assert.deepEqual(denominationOptions("break", 3, source, [source], catalog).options, []);
});

test("break options include a mixed choice when no single denomination is exact", () => {
  const source = piece("large", 10, 1, 1);
  const catalog = [piece("six", 6, 2), piece("four", 4, 3)];
  const {options} = denominationOptions("break", 1, source, [source], catalog);
  assert.deepEqual(options.map(({id, plan}) => [id, plan.change.map(stack => stack.id)]), [["", ["six", "four"]]]);
});

test("combine checks the exact requested quantity even when one piece is impossible", () => {
  const holdings = [piece("three", 3, 2, 4)];
  const catalog = [piece("six", 6, 1), piece("four", 4, 1), piece("same-tier", 6, 2)];
  assert.deepEqual(denominationOptions("combine", 1, null, holdings, catalog).options.map(entry => entry.id), ["six"]);
  const {options} = denominationOptions("combine", 3, null, holdings, catalog);
  assert.deepEqual(options.map(({id, plan}) => [id, plan.debit[0].count, plan.change[0].count]), [["four", 4, 3]]);
});

test("combine offers distinct exact mixes for one chosen denomination", () => {
  const target = piece("target", 10, 1);
  const holdings = [piece("five", 5, 2, 4), piece("two", 2, 3, 10), piece("same", 9, 1, 3)];
  const {options} = combineOptions(target, 2, holdings);
  assert.deepEqual(options.map(({id, plan}) => [id, plan.debit.map(stack => [stack.id, stack.count])]),
    [["", [["five", 4]]], ["stack:two", [["two", 10]]]]);
  assert.ok(options.every(({plan}) => plan.change[0].count === 2 && plan.change[0].id === "target"));
  assert.deepEqual(combineOptions(target, 5, holdings).options, []);
});
