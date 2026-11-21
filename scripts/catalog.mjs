import {t as sbsI18n} from "./i18n.mjs";
import {compareDenominations, formatAmount, positiveAmount, SCALE} from "./economy.mjs";
import {currencyCharacters, MAX_CURRENCY_SYMBOLS} from "./currency-marks.mjs";

export const MODULE_ID = "swade-better-money";
export const MONEY_TYPE = `${MODULE_ID}.money`;
export const COINS = "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp";
const PACK_NAME = "better-money-denominations";

export function getCatalog() {
  return game.settings.get(MODULE_ID, "catalog");
}

export function getPack() {
  return game.packs.get(`world.${PACK_NAME}`);
}

export async function ensurePack() {
  const existing = getPack();
  if (existing) return existing;
  return foundry.documents.collections.CompendiumCollection.createCompendium({
    name: PACK_NAME,
    label: sbsI18n("swade-better-money.UI.BetterMoneyDenominations_419115ff38"),
    type: "Item",
    system: "swade",
    ownership: {PLAYER: "OBSERVER", TRUSTED: "OBSERVER", ASSISTANT: "OBSERVER", GAMEMASTER: "OWNER"}
  });
}

export function denomination(item) {
  if (item.type !== MONEY_TYPE || !item.system.currencyId) return null;
  return {
    id: item.id,
    name: item.name,
    currencyId: item.system.currencyId,
    tier: item.system.tier,
    value: positiveAmount(item.system.price),
    item
  };
}

export async function getDenominations() {
  const pack = getPack();
  const items = pack?.visible ? await pack.getDocuments({type: MONEY_TYPE}) : [];
  return items.map(denomination).filter(Boolean).sort(compareDenominations);
}

export function getHoldings(actor) {
  return actor.items.contents.map(item => {
    const piece = denomination(item);
    return piece && piece.item.system.quantity > 0 ? {...piece, count: piece.item.system.quantity} : null;
  }).filter(Boolean).sort(compareDenominations);
}

export function primaryBalance(actor) {
  const primary = getCatalog().primary;
  if (!primary) return 0;
  let total = 0n;
  for (const item of actor.items) {
    if (item.type === MONEY_TYPE && item.system.currencyId === primary) {
      total += BigInt(positiveAmount(item.system.price)) * BigInt(item.system.quantity);
    }
  }
  return Number(total) / SCALE;
}

export function summarizeWallet(actor, catalog = getCatalog()) {
  const totals = new Map(catalog.currencies.map(currency => [currency.id, {currency, units: 0n}]));
  for (const piece of getHoldings(actor)) {
    if (!totals.has(piece.currencyId)) {
      totals.set(piece.currencyId, {currency: {id: piece.currencyId, name: sbsI18n("swade-better-money.UI.Unlistedcurrency_797fcdf677")}, units: 0n});
    }
    const entry = totals.get(piece.currencyId);
    entry.units += BigInt(piece.count) * BigInt(piece.value);
  }
  return [...totals.values()].map(({currency, units}) => ({currency, units: Number(units), amount: formatAmount(units)}));
}

export function findRate(rates, from, to) {
  return rates.find(rate => (rate.from === from && rate.to === to) || (rate.to === from && rate.from === to));
}

export async function storeCurrency(data) {
  const catalog = foundry.utils.deepClone(getCatalog());
  const name = String(data.name).trim();
  const symbol = String(data.symbol ?? "").trim();
  const image = String(data.image ?? "").trim();
  const image2 = String(data.image2 ?? "").trim();
  const image3 = String(data.image3 ?? "").trim();
  if (!name) throw new Error(sbsI18n("swade-better-money.UI.Enteracurrencyname_d617df43ce"));
  if (currencyCharacters(symbol).length > MAX_CURRENCY_SYMBOLS) throw new Error(sbsI18n("swade-better-money.UI.Useuptothreecharactersfor_c7ec759969"));
  if ([image, image2, image3].some(path => /^data:/i.test(path))) throw new Error(sbsI18n("swade-better-money.UI.Chooseanimagefileorlink_19880e474a"));
  if (catalog.currencies.some(currency => currency.id !== data.id && currency.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(sbsI18n("swade-better-money.UI.Acurrencywiththisnamealready_1ec79cc219"));
  }
  const id = data.id || foundry.utils.randomID();
  const entry = {id, name, symbol, image, image2, image3};
  const existing = catalog.currencies.find(currency => currency.id === id);
  if (existing) Object.assign(existing, entry);
  else catalog.currencies.push(entry);
  if (!catalog.primary || data.primary) catalog.primary = id;
  await game.settings.set(MODULE_ID, "catalog", catalog);
  return id;
}

export async function removeCurrency(id) {
  const catalog = foundry.utils.deepClone(getCatalog());
  const actors = [...game.actors, ...game.scenes.contents.flatMap(scene =>
    scene.tokens.filter(token => !token.actorLink && token.actor).map(token => token.actor))];
  if ((await getDenominations()).some(piece => piece.currencyId === id)
    || actors.some(actor => actor.items.some(item => item.type === MONEY_TYPE && item.system.currencyId === id))) {
    throw new Error(sbsI18n("swade-better-money.UI.Removeorreassignthiscurrencys_47a3d80382"));
  }
  catalog.currencies = catalog.currencies.filter(currency => currency.id !== id);
  catalog.rates = catalog.rates.filter(rate => rate.from !== id && rate.to !== id);
  if (catalog.primary === id) catalog.primary = catalog.currencies[0]?.id ?? "";
  await game.settings.set(MODULE_ID, "catalog", catalog);
}

export async function storeRate(data, oldFrom, oldTo) {
  const catalog = foundry.utils.deepClone(getCatalog());
  const {from, to} = data;
  if (from === to || ![from, to].every(id => catalog.currencies.some(currency => currency.id === id))) {
    throw new Error(sbsI18n("swade-better-money.UI.Choosetwodifferentcurrencies_5a955d12b1"));
  }
  const rate = {from, to, fromAmount: positiveAmount(data.fromAmount), toAmount: positiveAmount(data.toAmount)};
  const existing = findRate(catalog.rates, oldFrom, oldTo);
  const duplicate = findRate(catalog.rates, from, to);
  if (duplicate && duplicate !== existing) throw new Error(sbsI18n("swade-better-money.UI.Anexchangerateforthispair_4e6f2f0bf5"));
  if (existing) Object.assign(existing, rate);
  else catalog.rates.push(rate);
  await game.settings.set(MODULE_ID, "catalog", catalog);
}

export async function removeRate(from, to) {
  const catalog = foundry.utils.deepClone(getCatalog());
  const rate = findRate(catalog.rates, from, to);
  catalog.rates = catalog.rates.filter(entry => entry !== rate);
  await game.settings.set(MODULE_ID, "catalog", catalog);
}
