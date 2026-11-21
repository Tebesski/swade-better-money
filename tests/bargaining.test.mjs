import assert from "node:assert/strict";
import test from "node:test";
import {
  BARGAIN_REACTIONS, bargainAward, bargainConfig, bargainPenalty, defaultBargainMaximum, noticeHint, reactionInterval
} from "../scripts/bargaining-rules.mjs";
import {SCALE} from "../scripts/economy.mjs";

test("the standard gig example applies the acceptable-limit reduction inclusively", () => {
  assert.equal(bargainPenalty(1500, 800, 500, 2500), -2);
  assert.equal(bargainPenalty(1500, 1000, 500, 2500), -2);
  assert.equal(bargainPenalty(1500, 1001, 500, 2500), -6);
  assert.equal(bargainPenalty(1500, 500, 500, 2500), 0);
});

test("bargaining preserves the base on failure and cannot reduce the reward below zero", () => {
  assert.equal(bargainAward(1500, 800, 500, "success"), 2300);
  assert.equal(bargainAward(1500, 800, 500, "raise"), 2300);
  assert.equal(bargainAward(1500, 800, 500, "failure"), 1500);
  assert.equal(bargainAward(1500, 800, 500, "critical"), 1000);
  assert.equal(bargainAward(100, 800, 500, "critical"), 0);
});

test("Notice rolls disclose only the earned level of detail", () => {
  assert.equal(noticeHint(1500, 2499, 500, 2500, "failure"), null);
  assert.deepEqual(noticeHint(1500, 2499, 500, 2500, "success"), {low: 0, high: 1500});
  assert.deepEqual(noticeHint(1500, 2499, 500, 2500, "raise"), {through: 2499, extra: 999, interval: 500});
  assert.deepEqual(noticeHint(1500, 1000, 500, 2500, "raise"), {through: 1000, extra: 0, interval: 500});
});

test("a critically failed Notice check places its private hint away from the actual cutoff", () => {
  assert.deepEqual(noticeHint(1500, 1750, 500, 2500, "critical"), {low: 1500, high: 2250});
  assert.deepEqual(noticeHint(1500, 3750, 500, 2500, "critical"), {low: 250, high: 1000});
});

test("the table defaults load for existing jobs and custom job settings take precedence", () => {
  assert.deepEqual(bargainConfig("hustles", {id: "side"}), {interval: "100", formula: "1d4 * 100 + 100"});
  assert.deepEqual(bargainConfig("gigs", {id: "small"}), {interval: "250", formula: "2d4 * 100 + 250"});
  assert.deepEqual(bargainConfig("gigs", {id: "standard"}), {interval: "500", formula: "2d4 * 400 + 500"});
  assert.deepEqual(bargainConfig("gigs", {id: "major"}), {interval: "1000", formula: "2d4 * 1000 + 1000"});
  assert.deepEqual(bargainConfig("gigs", {id: "standard", bargain: {interval: "23", formula: "4"}}),
    {interval: "23", formula: "4"});
});

test("reaction intervals match every cell of the bargaining table", () => {
  for (const [job, base, amounts] of [
    ["hustles:side", 100, [25, 50, 80, 100, 120, 200, 300]],
    ["gigs:small", 250, [60, 125, 200, 250, 300, 500, 750]],
    ["gigs:standard", 500, [125, 250, 400, 500, 600, 1000, 1500]],
    ["gigs:major", 1000, [250, 500, 800, 1000, 1200, 2000, 3000]]
  ]) {
    const intervals = Object.keys(BARGAIN_REACTIONS).map(reaction => reactionInterval(job, base * SCALE, reaction) / SCALE);
    assert.deepEqual(intervals, amounts);
  }
  assert.equal(reactionInterval("gigs:small", 260 * SCALE, "hostile"), 65 * SCALE);
  assert.equal(reactionInterval("gigs:custom", 1, "hostile"), 1);
});

test("the default maximum is double the base reward in exact wallet units", () => {
  assert.equal(defaultBargainMaximum(1500 * SCALE), 3000 * SCALE);
  assert.equal(defaultBargainMaximum(500001), 1000002);
  assert.throws(() => defaultBargainMaximum(Number.MAX_SAFE_INTEGER));
});
