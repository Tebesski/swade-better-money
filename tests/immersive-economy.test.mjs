import assert from "node:assert/strict";
import test from "node:test";
import {analyzeFormula, formulaUnits} from "../scripts/economy-formulas.mjs";
import {DEFAULT_RULES} from "../scripts/immersive-rules.mjs";

test("purchase formulas give the expected basket average and range", () => {
  const [pocket, everyday, costly, significant, major, luxury] = DEFAULT_RULES.purchases.map(entry => analyzeFormula(entry.formula));
  assert.deepEqual([pocket.mean, everyday.mean, costly.mean, significant.mean, major.mean, luxury.mean],
    [11, 50, 250, 1000, 5000, 15000]);
  assert.equal(2 * pocket.mean + everyday.mean, 72);
  assert.deepEqual([2 * pocket.min + everyday.min, 2 * pocket.max + everyday.max], [24, 120]);
});

test("default gig and hustle rewards use the source ranges and failure fatigue", () => {
  assert.deepEqual(DEFAULT_RULES.gigs.map(entry => analyzeFormula(entry.formula).mean), [600, 2100, 5100]);
  const {critical, failure, success, raise} = DEFAULT_RULES.hustles[0].outcomes;
  assert.deepEqual([critical, failure, success, raise].map(entry => analyzeFormula(entry.formula).mean), [0, 100, 350, 600]);
  assert.equal(failure.fatigue, 1);
});

test("custom formulas calculate independent products and reject unsupported inputs", () => {
  assert.equal(analyzeFormula("(d6 + 1) * (1d4 + 2) / 2").mean, 10.125);
  assert.equal(formulaUnits(10.125), 10_125_000);
  assert.equal(analyzeFormula("1d4 × 20").text, "1d4 * 20");
  for (const formula of ["2d6x", "1d4 / 1d6", "1d4 - 5", "1d4 / 0", "999d6", "1d4;1"]) {
    assert.throws(() => analyzeFormula(formula));
  }
});
