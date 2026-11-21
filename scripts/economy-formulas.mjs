import {t as sbsI18n} from "./i18n.mjs";
// Foundry rolls these formulas. Compute the exact expected value of the same arithmetic before rolling.
export function analyzeFormula(formula) {
  const text = String(formula).trim().toLowerCase().replaceAll("×", "*");
  const tokens = text.match(/\d*d\d+|\d+(?:\.\d+)?|[+*/()-]|\S/g) ?? [];
  if (!tokens.length || tokens.length > 100) throw new Error(sbsI18n("swade-better-money.UI.Enterashortdiceformulasuch_d142d5d789"));
  let cursor = 0;
  const constant = value => ({min: value, max: value, mean: value});
  const peek = () => tokens[cursor];

  function atom() {
    const token = tokens[cursor++];
    if (token === "(") {
      const result = sum();
      if (tokens[cursor++] === ")") return result;
    } else if (token === "-") {
      const {min, max, mean} = atom();
      return {min: -max, max: -min, mean: -mean};
    } else if (/^\d+(\.\d+)?$/.test(token)) {
      return constant(Number(token));
    } else if (/^\d*d\d+$/.test(token)) {
      const [dice, faces] = token.split("d");
      const count = Number(dice || 1);
      const sides = Number(faces);
      if (count >= 1 && count <= 100 && sides >= 1 && sides <= 10000) {
        return {min: count, max: count * sides, mean: count * (sides + 1) / 2};
      }
    }
    throw new Error(sbsI18n("swade-better-money.UI.Useordinarydicenumbersparenthesesand_66e94ac416"));
  }

  function product() {
    let left = atom();
    while (["*", "/"].includes(peek())) {
      const operator = tokens[cursor++];
      let right = atom();
      if (operator === "/") {
        if (right.min !== right.max || !right.min) throw new Error(sbsI18n("swade-better-money.UI.Divideonlybyanonzeroconstant_18cb4f0b5b"));
        right = constant(1 / right.min);
      }
      const bounds = [left.min * right.min, left.min * right.max, left.max * right.min, left.max * right.max];
      left = {min: Math.min(...bounds), max: Math.max(...bounds), mean: left.mean * right.mean};
    }
    return left;
  }

  function sum() {
    let left = product();
    while (["+", "-"].includes(peek())) {
      const operator = tokens[cursor++];
      const right = product();
      left = operator === "+"
        ? {min: left.min + right.min, max: left.max + right.max, mean: left.mean + right.mean}
        : {min: left.min - right.max, max: left.max - right.min, mean: left.mean - right.mean};
    }
    return left;
  }

  const result = sum();
  if (cursor !== tokens.length || !(result.min >= 0 && result.max <= 1_000_000_000)) {
    throw new Error(sbsI18n("swade-better-money.UI.Formulasmustproducenonnegativeamounts_a19fbaccdf"));
  }
  return {...result, text};
}

export function formulaUnits(value) {
  const ticks = Math.round(value * 1_000_000);
  if (ticks < 0 || !Number.isSafeInteger(ticks)) throw new Error(sbsI18n("swade-better-money.UI.Therolledamountisoutsidethe_17b978d57e"));
  return ticks;
}

export async function rollMoneyFormula(formula) {
  const {text, min, max} = analyzeFormula(formula);
  if (min === max) return {units: formulaUnits(min), roll: null};
  const roll = await new Roll(text).evaluate();
  return {units: formulaUnits(roll.total), roll};
}
