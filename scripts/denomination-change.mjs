import {exactChange, safeUnits} from "./economy.mjs";

export function lowerDenominations(piece, denominations) {
  return denominations.filter(entry => entry.tier > piece.tier && entry.value < piece.value);
}

export function planDenominationChange(action, piece, count, lower) {
  const amount = safeUnits(count * piece.value);
  const exact = exactChange(amount, lower);
  if (!exact) return null;
  const stack = [{...piece, count}];
  return action === "break"
    ? {amount, debit: stack, change: exact}
    : {amount, debit: exact, change: stack};
}

export function combineOptions(piece, quantity, holdings) {
  const lower = lowerDenominations(piece, holdings);
  const order = new Map(lower.map((stack, index) => [stack.id, index]));
  const options = [];
  const seen = new Set();
  let error;
  const add = (id, sources) => {
    try {
      const plan = planDenominationChange("combine", piece, quantity, sources);
      if (!plan) return;
      plan.debit.sort((a, b) => order.get(a.id) - order.get(b.id));
      const key = JSON.stringify(plan.debit.map(({id, count}) => [id, count]));
      if (seen.has(key)) return;
      seen.add(key);
      options.push({id, plan});
    } catch (cause) {
      error ??= cause.message;
    }
  };
  add("", lower);
  for (const stack of lower) add(`stack:${stack.id}`, [stack]);
  if (lower.length > 1) add("smallest-first", lower.toReversed());
  return {options, error};
}

export function denominationOptions(action, quantity, source, holdings, catalog) {
  const options = [];
  let error;
  function add(id, piece, lower, mixed = false) {
    try {
      const plan = planDenominationChange(action, piece, quantity, lower);
      if (plan && (!mixed || plan.change.length > 1)) options.push({id, plan});
    } catch (cause) {
      error ??= cause.message;
    }
  }

  if (action === "break" && source && quantity <= source.count) {
    const lower = lowerDenominations(source, catalog);
    for (const piece of lower) add(piece.id, source, [piece]);
    if (lower.length > 1) add("", source, lower, true);
  } else if (action === "combine") {
    for (const piece of catalog) add(piece.id, piece, lowerDenominations(piece, holdings));
  }
  return {options, error};
}
