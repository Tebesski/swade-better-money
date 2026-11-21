import {t as sbsI18n} from "./i18n.mjs";
import {COINS, ensurePack, getCatalog, MODULE_ID, MONEY_TYPE, storeCurrency} from "./catalog.mjs";
import {analyzeFormula} from "./economy-formulas.mjs";

const tier = (id, name, formula, description) => ({id, name, formula, description});
export const OUTCOMES = {get critical() { return sbsI18n("swade-better-money.UI.CriticalFailure_e551e13767"); }, get failure() { return sbsI18n("swade-better-money.UI.Failure_7031edbcf9"); }, get success() { return sbsI18n("swade-better-money.UI.Success_c88a0b9074"); }, get raise() { return sbsI18n("swade-better-money.UI.Raise_0fd3685adc"); }};
export const YUAN = "immersive-yuan";
export const DEFAULT_RULES = {
  currencyId: YUAN,
  get earnLabel() { return sbsI18n("swade-better-money.UI.Hustle_ffafaee5b6"); },
  purchases: [
    tier("pocket", sbsI18n("swade-better-money.UI.PocketChange_69b94a65ca"), "2d10", sbsI18n("swade-better-money.UI.Smalleverydayexpensessuchassnacks_b74ff483ad")),
    tier("everyday", "Everyday", "1d4 * 20", "A restaurant meal, hand tools, or a disposable radio."),
    tier("costly", "Costly", "1d4 * 100", sbsI18n("swade-better-money.UI.Workclothesbasicweaponsmedicalsupplies_2daba05e50")),
    tier("significant", "Significant", "1d4 * 400", "Armor, specialized equipment, or expensive street drugs."),
    tier("major", "Major", "1d4 * 2000", "A used or inexpensive satomobile."),
    tier("luxury", "Luxury", "1d4 * 6000", "Airships, sponsorships, and custom prototypes. Add any GM-set premium as a manual amount.")
  ],
  lifestyles: [
    {...tier("destitute", "Destitute", "0", sbsI18n("swade-better-money.UI.Sleepingroughandeatingwhatyou_a6d1635fd8")),
      noNaturalHealing: true, anemic: true, sessionFatigue: 1, monthlyBennies: 0, maxBennies: 0},
    {...tier("poor", "Poor", "1000", sbsI18n("swade-better-money.UI.Cheapmealsandacrampedtenement_b9bdbe2a33")),
      noNaturalHealing: true, anemic: true, sessionFatigue: 0, monthlyBennies: 0, maxBennies: 0},
    {...tier("modest", "Modest", "2500", "A secure apartment with utilities and decent food."),
      noNaturalHealing: false, anemic: false, sessionFatigue: 0, monthlyBennies: 0, maxBennies: 0},
    {...tier("comfortable", "Comfortable", "6000", sbsI18n("swade-better-money.UI.Goodmealsandanapartmentin_6eb83b63e5")),
      noNaturalHealing: false, anemic: false, sessionFatigue: 0, monthlyBennies: 1, maxBennies: 0},
    {...tier("wealthy", "Wealthy", "15000", "A penthouse in one of the best districts."),
      noNaturalHealing: false, anemic: false, sessionFatigue: 0, monthlyBennies: 0, maxBennies: 1}
  ],
  obligations: [
    tier("minor", sbsI18n("swade-better-money.UI.MinorObligation_edc024974e"), "500", sbsI18n("swade-better-money.UI.Recurringfinancialsupportorasmaller_d72989b9b2")),
    tier("major", sbsI18n("swade-better-money.UI.MajorObligation_ee710efd88"), "1500", "A substantial recurring debt or financial responsibility.")
  ],
  gigs: [
    tier("small", sbsI18n("swade-better-money.UI.SmallTimeGig_a3770c9a91"), "2d4 * 100 + 100", "A small job paid per person."),
    tier("standard", sbsI18n("swade-better-money.UI.StandardGig_eb646093a1"), "2d4 * 400 + 100", "A typical job paid per person."),
    tier("major", sbsI18n("swade-better-money.UI.MajorGig_dcc72cd1f1"), "2d4 * 1000 + 100", "A high-paying job paid per person.")
  ],
  hustles: [{
    id: "side", get name() { return sbsI18n("swade-better-money.UI.SideHustle_fee3bbcff7"); }, get description() { return sbsI18n("swade-better-money.UI.Pickarelevantskilltoearn_ac7ad02e70"); },
    outcomes: {
      critical: {formula: "0", fatigue: 0, get note() { return sbsI18n("swade-better-money.UI.EarnnothingTheGMdeterminesa_33c1b1436e"); }},
      failure: {formula: "1d4 * 20 + 50", fatigue: 1, get note() { return sbsI18n("swade-better-money.UI.Youearnalittlebuttake_af19879c94"); }},
      success: {formula: "1d4 * 100 + 100", fatigue: 0, get note() { return sbsI18n("swade-better-money.UI.Youscrapebythisweek_0c3012b0d3"); }},
      raise: {formula: "2d4 * 100 + 100", fatigue: 0, get note() { return sbsI18n("swade-better-money.UI.Itwasaprofitableweek_0e13ef0523"); }}
    }
  }]
};

export function immersiveEnabled() {
  return game.settings.get(MODULE_ID, "immersiveEconomy");
}

export function immersiveRules() {
  return game.settings.get(MODULE_ID, "immersiveRules");
}

export function purchaseTierId(item, tiers = immersiveRules().purchases) {
  const assigned = item.getFlag(MODULE_ID, "purchaseTier");
  if (assigned != null) return assigned;
  const price = Number(item.system.price);
  if (!price) return "";
  const suggestions = tiers.map(entry => ({id: entry.id, ...analyzeFormula(entry.formula)}))
    .sort((a, b) => Math.abs(price - a.mean) - Math.abs(price - b.mean));
  return suggestions.find(entry => price >= entry.min && price <= entry.max)?.id ?? suggestions[0]?.id ?? "";
}

export function hustleLabel() {
  return immersiveRules().earnLabel.trim() || sbsI18n("swade-better-money.UI.Hustle_ffafaee5b6");
}

export function hudHustlesEnabled() {
  return immersiveEnabled() && game.settings.get(MODULE_ID, "replaceEarn");
}

export function ruleCurrency() {
  const catalog = getCatalog();
  return catalog.currencies.find(entry => entry.id === immersiveRules().currencyId);
}

let installPending;
export function installYuan() {
  if (!game.user.isGM) return;
  installPending ??= installYuanPreset().finally(() => { installPending = null; });
  return installPending;
}

async function installYuanPreset() {
  const currency = getCatalog().currencies.find(entry => entry.id === YUAN || entry.name.toLowerCase() === "yuan");
  const currencyId = currency?.id ?? await storeCurrency({id: YUAN, name: sbsI18n("swade-better-money.UI.Yuan_3be835c58e"), symbol: "¥"});
  const pack = await ensurePack();
  const items = await pack.getDocuments({type: MONEY_TYPE});
  const examples = [10000, 5000, 2500, 1000, 500, 100, 50, 20, 10, 5, 1];
  const missing = examples.flatMap((price, index) => {
    if (items.some(item => item.system.currencyId === currencyId && item.system.price === price)) return [];
    return [{
      type: MONEY_TYPE, name: `${price}¥ ${price >= 20 ? sbsI18n("swade-better-money.UI.Note_d8da2c49df") : sbsI18n("swade-better-money.UI.Coin_0241ccff2d")}`, img: COINS,
      system: {price, tier: index + 1, weight: 0, currencyId}
    }];
  });
  if (missing.length) {
    const added = await Item.implementation.createDocuments(missing, {pack: pack.collection});
    if (added.length !== missing.length) throw new Error(sbsI18n("swade-better-money.UI.Checkthelockandpermissionson_796e674c66"));
  }
  const rules = immersiveRules();
  if (rules.currencyId === YUAN && currencyId !== YUAN) {
    await game.settings.set(MODULE_ID, "immersiveRules", {...rules, currencyId});
  }
  await game.settings.set(MODULE_ID, "yuanInstalled", true);
}
