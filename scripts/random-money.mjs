import {exactChange, safeUnits} from "./economy.mjs";

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function randomMoneyDistribution(amount, denominations, recipients, random = Math.random) {
  safeUnits(amount);
  if (amount < 0 || !Number.isSafeInteger(recipients) || recipients < 1) throw new Error("Choose at least one recipient and a non-negative amount.");
  const pieces = denominations.filter(piece => piece.value <= amount).sort((a, b) => b.value - a.value);
  const initial = exactChange(amount, pieces);
  if (!initial) throw new Error("The currency’s denominations cannot make this exact total.");
  const mix = new Map(initial.map(piece => [piece.id, {...piece}]));
  let pieceCount = initial.reduce((sum, piece) => safeUnits(sum + piece.count), 0);
  const pieceBudget = Math.max(pieceCount, recipients * (4 + Math.floor(random() * 5)));
  const splits = pieces.flatMap(piece => {
    const lower = pieces.filter(other => other.value < piece.value);
    return lower.slice(0, 3).flatMap((_other, index) => {
      const change = exactChange(piece.value, lower.slice(index));
      const count = change?.reduce((sum, entry) => sum + entry.count, 0);
      return count > 1 && count <= pieceBudget ? [{piece, change, increase: count - 1}] : [];
    });
  });
  // Start with an efficient payout, then break only as many notes as fit a modest piece budget.
  while (pieceCount < pieceBudget) {
    const options = splits.filter(split => mix.get(split.piece.id)?.count > 0 && split.increase <= pieceBudget - pieceCount);
    if (!options.length) break;
    const split = options[Math.floor(random() * options.length)];
    const quantity = 1 + Math.floor(random() * Math.min(mix.get(split.piece.id).count, Math.floor((pieceBudget - pieceCount) / split.increase)));
    mix.get(split.piece.id).count -= quantity;
    for (const piece of split.change) {
      const existing = mix.get(piece.id);
      if (existing) existing.count += piece.count * quantity;
      else mix.set(piece.id, {...piece, count: piece.count * quantity});
    }
    pieceCount += split.increase * quantity;
  }
  const payouts = Array.from({length: recipients}, () => []);
  const awaiting = shuffled(Array.from({length: recipients}, (_, recipient) => recipient), random);
  for (const piece of mix.values()) {
    let {count} = piece;
    const assigned = Array(recipients).fill(0);
    while (count && awaiting.length) {
      assigned[awaiting.pop()]++;
      count--;
    }
    // Random cuts split even very large stacks without iterating over every coin.
    const cuts = [0, count, ...Array.from({length: recipients - 1}, () => Math.floor(random() * (count + 1)))].sort((a, b) => a - b);
    const order = shuffled(Array.from({length: recipients}, (_, recipient) => recipient), random);
    for (let recipient = 0; recipient < recipients; recipient++) {
      assigned[order[recipient]] += cuts[recipient + 1] - cuts[recipient];
    }
    assigned.forEach((quantity, recipient) => {
      if (quantity) payouts[recipient].push({...piece, count: quantity});
    });
  }
  return payouts;
}
