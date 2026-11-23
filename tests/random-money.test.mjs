import assert from "node:assert/strict";
import test from "node:test";
import {randomMoneyDistribution} from "../scripts/random-money.mjs";

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function total(payouts) {
  return payouts.flat().reduce((sum, piece) => sum + piece.value * piece.count, 0);
}

test("random payouts conserve the shared total across recipients and produce varied mixes", () => {
  const denominations = [1000, 500, 100, 50, 10, 5, 1].map(value => ({id: String(value), value}));
  const variations = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const payouts = randomMoneyDistribution(1000, denominations, 3, seededRandom(seed));
    assert.equal(payouts.length, 3);
    assert.equal(total(payouts), 1000);
    assert.ok(payouts.flat().every(piece => Number.isSafeInteger(piece.count) && piece.count > 0));
    variations.add(JSON.stringify(payouts));
  }
  assert.ok(variations.size > 40);
});

test("random denominations preserve exact change even when greedy change fails", () => {
  const denominations = [4, 3].map(value => ({id: String(value), value}));
  for (let seed = 0; seed < 20; seed++) {
    assert.equal(total(randomMoneyDistribution(6, denominations, 3, seededRandom(seed))), 6);
  }
  assert.throws(() => randomMoneyDistribution(5, denominations, 3), /exact total/);
});

test("small, fractional-unit, zero and very large totals stay exact", () => {
  assert.equal(total(randomMoneyDistribution(1, [{id: "small", value: 1}], 10)), 1);
  assert.deepEqual(randomMoneyDistribution(0, [], 3), [[], [], []]);
  assert.equal(total(randomMoneyDistribution(1_000_000_000, [{id: "small", value: 1}], 3)), 1_000_000_000);
  assert.throws(() => randomMoneyDistribution(-1, [], 3));
  assert.throws(() => randomMoneyDistribution(1, [], 0));
});
