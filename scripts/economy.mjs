import {t as sbsI18n} from "./i18n.mjs";
export const SCALE = 1_000_000;

export function toUnits(value) {
  const match = String(value ?? "").trim().match(/^(\d*)(?:\.(\d{0,6})0*)?$/);
  if (!match || !(match[1] || match[2])) {
    throw new Error(sbsI18n("swade-better-money.UI.Enteranonnegativeamountwith_17bec19292"));
  }
  const units = Number(match[1]) * SCALE + Number((match[2] ?? "").padEnd(6, "0"));
  if (!Number.isSafeInteger(units)) throw new Error(sbsI18n("swade-better-money.UI.Thisamountistoolarge_8900847c35"));
  return units;
}

export function positiveAmount(value) {
  const units = toUnits(value);
  if (!units) throw new Error(sbsI18n("swade-better-money.UI.Enteranamountgreaterthanzero_b07b96712b"));
  return units;
}

export function positiveQuantity(value) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error(sbsI18n("swade-better-money.UI.Enterapositivewholequantity_8edae9409b"));
  return quantity;
}

export function safeUnits(units) {
  if (!Number.isSafeInteger(units)) throw new Error(sbsI18n("swade-better-money.UI.Thisbalanceistoolarge_167f6292bc"));
  return units;
}

export function formatAmount(units) {
  const ticks = BigInt(units);
  const whole = ticks / BigInt(SCALE);
  const fraction = String(ticks % BigInt(SCALE)).padStart(6, "0");
  return new Intl.NumberFormat(undefined, {maximumFractionDigits: 6}).format(`${whole}.${fraction}`);
}

export function compareDenominations(a, b) {
  return a.tier - b.tier || b.value - a.value || a.name.localeCompare(b.name);
}

export function convert(amount, rate, currencyId) {
  const forward = currencyId === rate.from;
  const paid = BigInt(forward ? rate.fromAmount : rate.toAmount);
  const received = BigInt(forward ? rate.toAmount : rate.fromAmount);
  const numerator = BigInt(amount) * received;
  if (numerator % paid) throw new Error(sbsI18n("swade-better-money.UI.Thatamountcannotbeexchangedexactly_5f4290cf78"));
  return safeUnits(Number(numerator / paid));
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function searchBudget() {
  let steps = 0;
  return () => {
    if (++steps > 75_000) {
      throw new Error(sbsI18n("swade-better-money.UI.Thisdenominationmixtakestoomany_7be4d9c132"));
    }
  };
}

// Bounded change-making with suffix value and GCD pruning. Denominations are tried in preference order.
export function exactChange(amount, denominations, step = searchBudget()) {
  if (!amount) return [];
  const eligible = denominations.filter(piece => piece.value <= amount && (piece.count ?? 1) > 0);
  const suffix = [{capacity: 0, divisor: 0}];
  for (const piece of eligible.toReversed()) {
    const next = suffix.at(-1);
    suffix.push({
      capacity: Math.min(amount, next.capacity + piece.value * (piece.count ?? Infinity)),
      divisor: gcd(piece.value, next.divisor)
    });
  }
  suffix.reverse();
  const failures = new Set();
  const selected = [];

  function find(index, remaining) {
    step();
    if (!remaining) return true;
    const {capacity, divisor} = suffix[index];
    if (remaining > capacity || remaining % divisor) return false;
    const key = `${index}:${remaining}`;
    if (failures.has(key)) return false;
    const piece = eligible[index];
    const max = Math.min(piece.count ?? Infinity, Math.floor(remaining / piece.value));
    const min = Math.max(0, Math.ceil((remaining - suffix[index + 1].capacity) / piece.value));
    for (let count = max; count >= min; count--) {
      if (count) selected.push({...piece, count});
      if (find(index + 1, remaining - count * piece.value)) return true;
      if (count) selected.pop();
    }
    failures.add(key);
    return false;
  }

  return find(0, amount) ? selected : null;
}

export function payment(amount, holdings, denominations) {
  const total = safeUnits(holdings.reduce((sum, piece) => sum + piece.count * piece.value, 0));
  if (amount > total) throw new Error(sbsI18n("swade-better-money.UI.Thiswallethasinsufficientfunds_e46c8348d2"));

  const step = searchBudget();
  const exact = exactChange(amount, holdings, step);
  if (exact) return {debit: exact, change: []};

  const checked = new Map();
  function changeFor(tendered) {
    if (!checked.has(tendered)) checked.set(tendered, exactChange(tendered - amount, denominations, step));
    return checked.get(tendered);
  }

  // Look for a single stack before searching combinations of multiple stacks.
  const candidates = holdings.map(piece => ({...piece, count: Math.ceil(amount / piece.value), available: piece.count}))
    .filter(piece => piece.count <= piece.available)
    .sort((a, b) => a.count * a.value - b.count * b.value);
  for (const piece of candidates) {
    const change = changeFor(piece.count * piece.value);
    if (change) return {debit: [piece], change};
  }

  if (denominations.length) {
    const remaining = holdings.map(piece => piece.count * piece.value);
    remaining.push(0);
    for (let index = holdings.length - 1; index >= 0; index--) remaining[index] += remaining[index + 1];
    const debit = [];

    function find(index, tendered) {
      step();
      if (tendered >= amount) {
        const change = changeFor(tendered);
        if (change) return {debit: [...debit], change};
      }
      if (index === holdings.length || tendered + remaining[index] < amount) return null;
      const piece = holdings[index];
      const min = Math.max(0, Math.ceil((amount - tendered - remaining[index + 1]) / piece.value));
      for (let count = min; count <= piece.count; count++) {
        if (count) debit.push({...piece, count});
        const result = find(index + 1, tendered + count * piece.value);
        if (result) return result;
        if (count) debit.pop();
      }
      return null;
    }

    const result = find(0, 0);
    if (result) return result;
  }
  throw new Error(sbsI18n("swade-better-money.UI.Thewalletcannotmakethispayment_9e6d74eb61"));
}
