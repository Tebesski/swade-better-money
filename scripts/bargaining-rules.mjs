import {t as sbsI18n} from "./i18n.mjs";
import {safeUnits, SCALE} from "./economy.mjs";

export const DEFAULT_BARGAIN_TRAITS = "Eloquence, Intimidation";

export const BARGAIN_REACTIONS = {
  hostile: {get label() { return sbsI18n("swade-better-money.UI.Hostile_b3478c03ae"); }, percent: 25},
  unfriendly: {get label() { return sbsI18n("swade-better-money.UI.Unfriendly_ddf76ef659"); }, percent: 50},
  uncooperative: {get label() { return sbsI18n("swade-better-money.UI.Uncooperative_ea03d49058"); }, percent: 80},
  neutral: {get label() { return sbsI18n("swade-better-money.UI.Neutral_1c6ac69f1e"); }, percent: 100},
  cooperative: {get label() { return sbsI18n("swade-better-money.UI.Cooperative_2ba147f408"); }, percent: 120},
  friendly: {get label() { return sbsI18n("swade-better-money.UI.Friendly_397423500c"); }, percent: 200},
  helpful: {get label() { return sbsI18n("swade-better-money.UI.Helpful_63c432db3e"); }, percent: 300}
};

export function reactionInterval(jobId, base, reaction) {
  if (!Object.hasOwn(BARGAIN_REACTIONS, reaction)) throw new Error(sbsI18n("swade-better-money.UI.Chooseanemployerattitude_5cad14ace5"));
  // The table gives this one default interval as 60 rather than 62.5.
  if (jobId === "gigs:small" && base === 250 * SCALE && reaction === "hostile") return 60 * SCALE;
  const percent = BigInt(BARGAIN_REACTIONS[reaction].percent);
  const adjusted = Number((BigInt(base) * percent + 50n) / 100n);
  return Math.max(1, safeUnits(adjusted));
}

export function defaultBargainMaximum(base) {
  return safeUnits(base * 2);
}

const defaults = {
  "hustle:side": {interval: "100", formula: "1d4 * 100 + 100"},
  "gig:small": {interval: "250", formula: "2d4 * 100 + 250"},
  "gig:standard": {interval: "500", formula: "2d4 * 400 + 500"},
  "gig:major": {interval: "1000", formula: "2d4 * 1000 + 1000"}
};

export function bargainConfig(group, entry) {
  const baseFormula = entry.formula ?? entry.outcomes?.success?.formula ?? "0";
  const key = `${group === "gigs" ? "gig" : "hustle"}:${entry.id}`;
  return entry.bargain ?? defaults[key] ?? {interval: "500", formula: baseFormula};
}

export function bargainPenaltyDetails(base, extra, interval, limit) {
  const steps = Number((BigInt(extra) + BigInt(interval) - 1n) / BigInt(interval));
  const requested = safeUnits(base + extra);
  const withinLimit = requested <= limit;
  const basePenalty = -2 * steps;
  const reduction = withinLimit ? 2 : 0;
  return {steps, requested, withinLimit, basePenalty, reduction, modifier: Math.min(0, basePenalty + reduction)};
}

export function bargainPenalty(base, extra, interval, limit) {
  return bargainPenaltyDetails(base, extra, interval, limit).modifier;
}

export function bargainAward(base, extra, interval, outcome) {
  if (outcome === "critical") return Math.max(0, base - interval);
  return outcome === "success" || outcome === "raise" ? safeUnits(base + extra) : base;
}

export function noticeHint(base, limit, interval, maximum, outcome) {
  if (outcome === "raise") return {through: limit, extra: Math.max(0, limit - base), interval};
  if (outcome === "critical") {
    const cutoff = Math.max(0, Math.min(maximum, limit - base));
    return cutoff < maximum / 2
      ? {low: Math.floor(maximum * 0.6), high: Math.floor(maximum * 0.9)}
      : {low: Math.floor(maximum * 0.1), high: Math.floor(maximum * 0.4)};
  }
  if (outcome !== "success") return null;
  const bucket = Math.floor((limit - base) / interval);
  const bound = units => Math.max(0, Math.min(maximum, units));
  return {low: bound((bucket - 1) * interval), high: bound((bucket + 2) * interval)};
}
