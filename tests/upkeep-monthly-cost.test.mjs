import assert from "node:assert/strict";
import test from "node:test";
import {configureLifestyle, invoices, prepareExpenses, setExpenseDues, setExpenseMonthlyCost} from "../scripts/upkeep.mjs";
import {SCALE} from "../scripts/economy.mjs";

test("monthly overrides belong to each character and feed future charges, payment and preset resets", async () => {
  const originalGame = globalThis.game;
  const originalFoundry = globalThis.foundry;
  const rules = {
    lifestyles: [{id: "poor", name: "Poor", formula: "1500"}, {id: "modest", name: "Modest", formula: "2500"}],
    obligations: [{id: "rent", name: "Rent", formula: "500"}]
  };
  function character() {
    let state = {lifestyle: {id: "poor", since: 0}, obligations: [{id: "bill", presetId: "rent", since: 0}]};
    return {isOwner: true, getFlag: () => state, setFlag: async (_scope, _key, next) => { state = next; }};
  }
  try {
    globalThis.foundry = {utils: {deepClone: structuredClone}};
    globalThis.game = {
      user: {isGM: true}, modules: new Map(), settings: {get: () => rules},
      time: {worldTime: 0, calendar: {
        days: {secondsPerMinute: 60, minutesPerHour: 60, hoursPerDay: 24, values: Array(7).fill(0)},
        years: {firstWeekday: 0}, months: {values: [{name: "Month"}]}, timeToComponents: () => ({year: 160, month: 0})
      }}, i18n: {localize: value => value}
    };
    const first = character(), second = character();
    await setExpenseMonthlyCost(first, "lifestyle", "1000");
    await setExpenseMonthlyCost(first, "bill", "125");
    assert.deepEqual(invoices(first).map(row => row.cost), [1000, 125]);
    assert.deepEqual(invoices(second).map(row => row.cost), [1500, 500]);
    assert.deepEqual(rules.lifestyles[0].formula, "1500");
    assert.deepEqual(invoices(first).map(row => row.units), [1500 * SCALE, 500 * SCALE]);
    await setExpenseDues(first, null, true);
    assert.deepEqual(invoices(first).map(row => row.units), [2500 * SCALE, 625 * SCALE]);
    const paid = prepareExpenses(first, [{id: "bill", all: false, amount: "25"}]);
    assert.equal(invoices(first, paid.state).find(row => row.id === "bill").units, 600 * SCALE);
    await setExpenseMonthlyCost(first, "bill", "0");
    assert.equal(invoices(first).find(row => row.id === "bill").cost, 0);
    await setExpenseMonthlyCost(first, "bill", "");
    assert.equal(invoices(first).find(row => row.id === "bill").cost, 500);
    await configureLifestyle(first, "modest");
    assert.equal(invoices(first)[0].cost, 2500);
    await assert.rejects(setExpenseMonthlyCost(first, "bill", "-1"));
    await assert.rejects(setExpenseMonthlyCost({...first, isOwner: false}, "bill", "100"));
    await assert.rejects(setExpenseMonthlyCost(first, "missing", "100"));
    await setExpenseDues(first, [{id: "lifestyle", mode: "money", value: "0"}, {id: "bill", mode: "money", value: "0"}]);
    await setExpenseDues(first, [{id: "lifestyle", mode: "money", value: "-500"}]);
    assert.equal(invoices(first)[0].units, 0);
    assert.equal(invoices(first)[0].nextDiscountUnits, 500 * SCALE);
    await setExpenseDues(first, null, true);
    assert.equal(invoices(first)[0].units, 2000 * SCALE);
    assert.equal(invoices(first)[0].nextDiscountUnits, undefined);
    await setExpenseDues(first, null, true);
    assert.equal(invoices(first)[0].units, 4500 * SCALE);
    await setExpenseDues(first, [{id: "bill", mode: "money", value: "-750"}]);
    const before = invoices(first).find(row => row.id === "bill").units;
    await setExpenseDues(first, null, true);
    assert.equal(invoices(first).find(row => row.id === "bill").units, before);
    assert.equal(invoices(first).find(row => row.id === "bill").nextDiscountUnits, undefined);
    await setExpenseDues(first, null, true);
    assert.equal(invoices(first).find(row => row.id === "bill").units, before + 500 * SCALE);
    await assert.rejects(setExpenseDues(first, [{id: "bill", mode: "months", value: "-1"}]));
  } finally {
    globalThis.game = originalGame;
    globalThis.foundry = originalFoundry;
  }
});
