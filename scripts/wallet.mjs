import {t as sbsI18n} from "./i18n.mjs";
import {findRate, getCatalog, getDenominations, getHoldings, MODULE_ID} from "./catalog.mjs";
import {convert, exactChange, formatAmount, payment, positiveAmount, positiveQuantity, safeUnits, toUnits} from "./economy.mjs";
import {anemicOperations, prepareBilling, prepareExpenses, upkeepPath} from "./upkeep.mjs";
import {combineOptions, lowerDenominations, planDenominationChange} from "./denomination-change.mjs";
import {BETTER_EFFECTS, storedMoneyFlags} from "./money-flags.mjs";
import {immersiveEnabled, ruleCurrency} from "./immersive-rules.mjs";

const requestFlag = "transactionRequest";
const responseFlag = "transactionResponse";
const requestLifetime = 30_000;
const recentRequests = new Map();
let transactionQueue = Promise.resolve();

export function transactionRecipients(actor, user = game.user) {
  const sort = (a, b) => a.name.localeCompare(b.name);
  if (actor.type === "group") {
    return [...actor.system.members.values()].map(member => member.actor).filter(target =>
      ["character", "npc"].includes(target?.type) && target.testUserPermission(user, "LIMITED")).sort(sort);
  }
  return game.actors.filter(target => target.uuid !== actor.uuid && (
    (target.type === "character" && target.hasPlayerOwner) ||
    (target.type === "group" && !target.system.locked && target.system.members.has(actor.uuid) && target.testUserPermission(user, "LIMITED"))
  )).sort(sort);
}

export function expenseWallets(actor, user = game.user) {
  if (!game.modules.get("swade-grid-inventory")?.active || !game.modules.get("swade-better-setting")?.active) return [actor];
  const owner = user.isGM ? game.users.find(player => !player.isGM && player.character?.uuid === actor.uuid)
    ?? game.users.find(player => !player.isGM && actor.testUserPermission(player, "OWNER", {exact: true})) : user;
  if (!owner) return [actor];
  const registry = game.settings.get("swade-better-setting", "partyInventories");
  const vaults = Object.entries(registry).flatMap(([partyId, state]) => {
    const party = game.actors.get(partyId);
    if (!state.grid || !party?.system.members?.has(actor.uuid)) return [];
    return state.slots.filter(slot => slot.ownerId === owner.id).map(slot => game.actors.get(slot.actorId))
      .filter(vault => vault && vault.testUserPermission(owner, "OWNER") && vault.testUserPermission(user, "OWNER"));
  });
  return [actor, ...new Set(vaults)];
}

export async function previewTransaction(actor, request, user = game.user) {
  if (actor?.documentName !== "Actor" || !actor.testUserPermission(user, "OWNER")) {
    throw new Error(sbsI18n("swade-better-money.UI.Youmustownthesourceactor_b70bff6a4a"));
  }
  const {action, currencyId} = request;
  if (action === "expenses") {
    if (!immersiveEnabled() || currencyId !== ruleCurrency()?.id) throw new Error(sbsI18n("swade-better-money.UI.Choosetheupkeepcurrency_9e96294e84"));
    const billing = prepareExpenses(actor, request.expenses);
    let remaining = billing.units;
    const sources = [];
    for (const source of expenseWallets(actor, user)) {
      const balance = getHoldings(source).filter(piece => piece.currencyId === currencyId)
        .reduce((sum, piece) => safeUnits(sum + piece.value * piece.count), 0);
      const amount = Math.min(balance, remaining);
      if (!amount) continue;
      const plan = await previewTransaction(source, {action: "spend", currencyId, amount: String(amount / 1_000_000)}, user);
      sources.push({actor: source, plan});
      remaining -= amount;
      if (!remaining) break;
    }
    if (remaining) throw new Error(sbsI18n("swade-better-money.UI.Notenoughmoneyinthecharacter_3291a967a3"));
    return {action, amount: billing.units, billing, sources,
      signature: JSON.stringify([actor.uuid, billing.signature, sources.map(source => source.plan.signature)])};
  }
  const market = await getDenominations();
  const holdings = getHoldings(actor).filter(piece => piece.currencyId === currencyId);
  const denominations = market.filter(piece => piece.currencyId === currencyId);
  let debit = [], change = [], payout = [], target = actor, amount, received, outputCurrency = currencyId, billing;

  switch (action) {
    case "break": {
      const piece = holdings.find(entry => entry.id === request.source);
      const count = positiveQuantity(request.quantity);
      if (!piece || count > piece.count) throw new Error(sbsI18n("swade-better-money.UI.Chooseastackandaquantity_6ab2ff4da6"));
      const lower = lowerDenominations(piece, denominations).filter(entry => !request.denomination || request.denomination === entry.id);
      const plan = planDenominationChange(action, piece, count, lower);
      if (!plan) throw new Error(sbsI18n("swade-better-money.UI.Thechosenlowerdenominationscannotmake_fd5b4498f2"));
      return denominationPreview(actor, action, currencyId, plan);
    }
    case "combine": {
      const piece = denominations.find(entry => entry.id === request.denomination);
      if (!piece) throw new Error(sbsI18n("swade-better-money.UI.Choosethedenominationyouwantto_ff0e627720"));
      const count = positiveQuantity(request.quantity);
      const {options, error} = combineOptions(piece, count, holdings);
      const choice = options.find(option => option.id === (request.mix ?? ""));
      if (!choice) throw new Error(error ?? sbsI18n("swade-better-money.UI.Thatcombinationisnolongeravailable_0f9517d641"));
      return denominationPreview(actor, action, currencyId, choice.plan);
    }
    case "spend":
    case "transfer":
    case "exchange": {
      billing = action === "spend" ? prepareBilling(actor, request.bills, currencyId) : null;
      amount = billing || action === "spend" && request.allowZero
        ? safeUnits(toUnits(request.amount) + (billing?.units ?? 0)) : positiveAmount(request.amount);
      if (amount) ({debit, change} = payment(amount, holdings, denominations));
      if (action === "transfer") {
        target = transactionRecipients(actor, user).find(entry => entry.uuid === request.target);
        if (!target) throw new Error(sbsI18n("swade-better-money.UI.Chooseanavailablerecipient_3c10fea38f"));
        if (!target.testUserPermission(user, "OWNER") && !game.users.activeGM) {
          throw new Error(sbsI18n("swade-better-money.UI.AnactiveGMisneededto_7ae0b27bb2"));
        }
        received = amount;
        payout = change.length ? exactChange(amount, denominations) : debit;
        if (!payout) throw new Error(sbsI18n("swade-better-money.UI.Therecipientcannotreceivethatexact_ad97e3fb13"));
      } else if (action === "exchange") {
        const catalog = getCatalog();
        outputCurrency = request.exchangeCurrency;
        const rate = findRate(catalog.rates, currencyId, outputCurrency);
        if (!rate || !catalog.currencies.some(currency => currency.id === outputCurrency)) {
          throw new Error(sbsI18n("swade-better-money.UI.Setanexchangerateforthis_4d7a2c21ea"));
        }
        received = convert(amount, rate, currencyId);
        payout = exactChange(received, market.filter(piece => piece.currencyId === outputCurrency));
        if (!payout) throw new Error(sbsI18n("swade-better-money.UI.Thedestinationcurrencyhasnodenomination_e11316747c"));
      }
      break;
    }
    default:
      throw new Error(sbsI18n("swade-better-money.UI.Chooseamoneyoperation_30508e6220"));
  }

  return signPlan(actor, {action, debit, change, payout, target, amount, received, outputCurrency, billing});
}

export function denominationPreview(actor, action, currencyId, plan) {
  return signPlan(actor, {...plan, action, target: actor, payout: [], outputCurrency: currencyId});
}

function signPlan(actor, plan) {
  const {action, target, amount, received, billing, debit, change, payout} = plan;
  const signature = JSON.stringify([action, actor.uuid, target.uuid, amount, received, billing?.signature,
    ...[debit, change, payout].map(pieces => pieces.map(({item, count, value, tier, name}) =>
      [item.uuid, name, value, tier, count, item.system.weight, item.isEmbedded ? item.system.quantity : null, storedMoneyFlags(item)]))]);
  return {...plan, signature};
}

function itemData(item) {
  const {name, img, type} = item;
  const {currencyId, tier, price, weight, description} = item.system.toObject();
  const tags = storedMoneyFlags(item);
  return {
    name, img, type, system: {currencyId, tier, price, weight, description},
    ...(Object.keys(tags).length ? {flags: {[BETTER_EFFECTS]: tags}} : {})
  };
}

function stackIdentity(data) {
  const {quantity, ...system} = data.system;
  return JSON.stringify({...data, system});
}

function buildOperations(actor, plan, prepareItems) {
  const modifications = new Map();
  function inventory(parent) {
    if (!modifications.has(parent.uuid)) modifications.set(parent.uuid, {parent, updates: new Map(), creates: []});
    return modifications.get(parent.uuid);
  }

  const source = inventory(actor);
  for (const {item, count} of plan.debit) {
    source.updates.set(item.id, item.system.quantity - count);
  }

  function credit(parent, pieces) {
    const wallet = inventory(parent);
    const stacks = getHoldings(parent);
    for (const {item, count, currencyId} of pieces) {
      const data = itemData(item);
      const identity = stackIdentity(data);
      const existing = !prepareItems && stacks.find(piece => piece.currencyId === currencyId && !piece.item.effects.size
        && stackIdentity(itemData(piece.item)) === identity);
      if (existing) {
        const quantity = wallet.updates.get(existing.id) ?? existing.count;
        wallet.updates.set(existing.id, positiveQuantity(quantity + count));
      } else {
        const pending = wallet.creates.find(entry => stackIdentity(entry) === identity);
        if (pending) pending.system.quantity = positiveQuantity(pending.system.quantity + count);
        else wallet.creates.push({...data, system: {...data.system, quantity: count}});
      }
    }
  }

  credit(actor, plan.change);
  credit(plan.target, plan.payout);
  const operations = [];
  for (const {parent, updates, creates} of modifications.values()) {
    const ids = [];
    const changes = [];
    for (const [id, quantity] of updates) {
      if (!quantity) ids.push(id);
      else if (parent.items.get(id)?.system.quantity !== quantity) changes.push({_id: id, "system.quantity": quantity});
    }
    const options = {documentName: "Item", parent, noHook: true};
    if (ids.length) operations.push({...options, action: "delete", ids});
    if (changes.length) operations.push({...options, action: "update", updates: changes});
    if (creates.length) operations.push({...options, action: "create", data: prepareItems ? prepareItems(creates) : creates});
  }
  return operations;
}

export function withWalletLock(callback) {
  const result = transactionQueue.then(callback);
  transactionQueue = result.catch(() => {});
  return result;
}

export function actorOperation(actor, changes) {
  return {
    action: "update", documentName: "Actor", parent: actor.parent,
    updates: [{_id: actor.id, ...changes}]
  };
}

export async function commitOperations(operations) {
  const expected = operations.map(operation => (operation.ids ?? operation.updates ?? operation.data).length);
  const results = await foundry.documents.modifyBatch(operations);
  if (results.length !== expected.length || results.some((documents, index) => documents.length !== expected[index])) {
    throw new Error(sbsI18n("swade-better-money.UI.Foundrydidnotconfirmthefull_7648760fcb"));
  }
}

export async function creditIncome(actor, currencyId, amount, prepareUpdate = () => null, prepareItems) {
  if (!actor?.isOwner) throw new Error(sbsI18n("swade-better-money.UI.Youmustowntherecipient_49d73846f8"));
  return withWalletLock(async () => {
    const market = (await getDenominations()).filter(piece => piece.currencyId === currencyId);
    const payout = exactChange(amount, market);
    if (!payout) throw new Error(sbsI18n("swade-better-money.UI.Thecatalogcannotpaythisreward_2d967807b0"));
    const changes = prepareUpdate();
    const operations = buildOperations(actor, {debit: [], change: [], payout, target: actor}, prepareItems);
    if (changes) operations.push(actorOperation(actor, changes));
    await commitOperations(operations);
    return payout;
  });
}

export function spendWithOperations(actor, currencyId, amount, operations) {
  if (!actor?.isOwner) throw new Error(sbsI18n("swade-better-money.UI.Youmustownthesourcewallet_1a895270d7"));
  return withWalletLock(async () => {
    const plan = await previewTransaction(actor, {action: "spend", currencyId, amount});
    await commitOperations([...buildOperations(actor, plan), ...operations]);
  });
}

function runTransaction(actor, request, signature, user) {
  return withWalletLock(async () => {
    const plan = await previewTransaction(actor, request, user);
    if (plan.signature !== signature) throw new Error(sbsI18n("swade-better-money.UI.ThewalletorcatalogchangedPreview_eae795a2d6"));
    const operations = plan.sources ? plan.sources.flatMap(source => buildOperations(source.actor, source.plan)) : buildOperations(actor, plan);
    if (plan.billing) {
      operations.push(actorOperation(actor, {[upkeepPath]: plan.billing.state}), ...await anemicOperations(actor, plan.billing.state));
    }
    await commitOperations(operations);
    return {amount: formatAmount(plan.amount)};
  });
}

export async function executeTransaction(actor, request, signature) {
  const gm = game.users.activeGM;
  if (!gm || gm.id === game.user.id) return runTransaction(actor, request, signature, game.user);
  const id = foundry.utils.randomID();
  const payload = {id, gmId: gm.id, actorUuid: actor.uuid, request, signature};
  return new Promise((resolve, reject) => {
    function finish(error, result) {
      clearTimeout(timer);
      Hooks.off("updateUser", hook);
      if (error) reject(new Error(error));
      else resolve(result);
    }

    const hook = Hooks.on("updateUser", (user, changes, _options, userId) => {
      if (user.id === game.user.id && userId === gm.id) {
        const responseId = changes.flags?.[MODULE_ID]?.[responseFlag]?.id;
        if (responseId === id) {
          const {error, result} = user.getFlag(MODULE_ID, responseFlag);
          finish(error, result);
        }
      }
    });
    const timer = setTimeout(() => finish(sbsI18n("swade-better-money.UI.TheGMdidnotconfirmthe_ae95d5980f")), requestLifetime);
    game.user.setFlag(MODULE_ID, requestFlag, payload).catch(error => finish(error.message));
  });
}

export function listenForTransactions() {
  // The server authenticates both the requester's User update and the GM's response.
  Hooks.on("updateUser", (user, changes, _options, userId) => {
    if (game.users.activeGM?.id !== game.user.id || user.id !== userId || !user.active) return;
    const requestId = changes.flags?.[MODULE_ID]?.[requestFlag]?.id;
    if (!requestId) return;
    const payload = user.getFlag(MODULE_ID, requestFlag);
    const now = Date.now();
    if (payload?.id !== requestId || payload.gmId !== game.user.id) return;
    for (const [id, expires] of recentRequests) if (expires < now) recentRequests.delete(id);
    const key = `${user.id}:${payload.id}`;
    if (recentRequests.has(key)) return;
    recentRequests.set(key, now + requestLifetime);

    void (async () => {
      const response = {id: payload.id, error: null, result: null};
      try {
        const actor = await fromUuid(payload.actorUuid);
        response.result = await runTransaction(actor, payload.request, payload.signature, user);
      } catch (error) {
        response.error = error.message;
      }
      await user.setFlag(MODULE_ID, responseFlag, response);
    })().catch(error => console.error("Better Money could not acknowledge a transaction.", error));
  });
}
