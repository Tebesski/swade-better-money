import {t as sbsI18n} from "./i18n.mjs";
import {getCatalog, MONEY_TYPE} from "./catalog.mjs";

export const BETTER_EFFECTS = "swade-better-effects";

export function betterEffectsApi() {
  return game.modules.get(BETTER_EFFECTS)?.api;
}

export function automaticMoneyFlags(item) {
  if (item?.type !== MONEY_TYPE) return [];
  const api = betterEffectsApi();
  if (!api?.normalizeFlag) return [];
  const currency = getCatalog().currencies.find(entry => entry.id === item.system.currencyId);
  const name = api.normalizeFlag(currency?.name);
  if (!name) return [];
  const price = item.system.price.toFixed(6).replace(/\.?0+$/, "");
  const suffix = api.normalizeFlag(price);
  const prefix = name.slice(0, 79 - suffix.length).replace(/-+$/, "");
  return [name, `${prefix}-${suffix}`];
}

export function storedMoneyFlags(item) {
  const flags = item.flags?.[BETTER_EFFECTS];
  const normalize = betterEffectsApi()?.normalizeFlags;
  const result = {};
  for (const key of ["tags", sbsI18n("swade-better-money.UI.excludedTags_e68b10a6ab")]) {
    const value = flags?.[key];
    if (!value?.length) continue;
    const tags = normalize ? normalize(value) : [...new Set(Array.isArray(value) ? value : value.split(","))].sort();
    if (tags.length) result[key] = tags;
  }
  return result;
}
