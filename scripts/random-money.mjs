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
  const pieces = shuffled(denominations.filter(piece => piece.value <= amount), random);
  let remaining = amount;
  let fallback = exactChange(remaining, pieces);
  if (!fallback) throw new Error("The currency’s denominations cannot make this exact total.");
  const payouts = Array.from({length: recipients}, () => []);
  for (let index = 0; index < pieces.length && remaining; index++) {
    const piece = pieces[index];
    const rest = pieces.slice(index + 1);
    let count = fallback.find(entry => entry.id === piece.id)?.count ?? 0;
    let next = fallback.filter(entry => entry.id !== piece.id);
    for (let attempt = 0; attempt < 4; attempt++) {
      const candidate = Math.floor(random() * (Math.floor(remaining / piece.value) + 1));
      const change = exactChange(remaining - candidate * piece.value, rest);
      if (change) {
        count = candidate;
        next = change;
        break;
      }
    }
    remaining -= count * piece.value;
    fallback = next;
    // Random cuts split even very large stacks without iterating over every coin.
    const cuts = [0, count, ...Array.from({length: recipients - 1}, () => Math.floor(random() * (count + 1)))].sort((a, b) => a - b);
    const order = shuffled(Array.from({length: recipients}, (_, recipient) => recipient), random);
    for (let recipient = 0; recipient < recipients; recipient++) {
      const quantity = cuts[recipient + 1] - cuts[recipient];
      if (quantity) payouts[order[recipient]].push({...piece, count: quantity});
    }
  }
  return payouts;
}
