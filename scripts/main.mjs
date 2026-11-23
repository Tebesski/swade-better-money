import {t as sbsI18n} from "./i18n.mjs";
import {CurrencyCatalog, openMoney, refreshMoneyManager, refreshMoneyManagers, reportError} from "./apps.mjs";
import {getCatalog, getPack, MODULE_ID, MONEY_TYPE, primaryBalance, summarizeWallet} from "./catalog.mjs";
import {registerDenominations, restrictDenominationSheets} from "./denomination-sheet.mjs";
import {formatAmount, positiveAmount, SCALE} from "./economy.mjs";
import {creditIncome, executeTransaction, listenForTransactions, previewTransaction, spendWithOperations} from "./wallet.mjs";
import {immersiveRules, ruleCurrency} from "./immersive-rules.mjs";
import {analyzeFormula} from "./economy-formulas.mjs";
import {immersiveApi, registerImmersiveSettings, renderImmersive, startImmersiveIntegration} from "./immersive-ui.mjs";
import {createCurrencyMark} from "./currency-marks.mjs";
import {registerTierAppearance, renderSheetTier, styleItemTier} from "./tier-appearance.mjs";
import {automaticMoneyFlags} from "./money-flags.mjs";
import {registerBargaining} from "./bargaining.mjs";
import {refreshMonthlyDue} from "./expense-dialog.mjs";
import {distributeMoney, installDistributionMacro} from "./distribute-money.mjs";

Hooks.once("init", () => {
  if (game.system.id !== "swade") return;
  game.settings.register(MODULE_ID, "catalog", {
    scope: "world", config: false, type: Object,
    default: {currencies: [], primary: "", rates: []},
    onChange: refreshActorSheets
  });
  game.settings.registerMenu(MODULE_ID, "currencyCatalog", {
    name: sbsI18n("swade-better-money.UI.CurrencyCatalog_028b036b91"),
    label: sbsI18n("swade-better-money.UI.OpenCurrencyCatalog_5b434d3453"),
    icon: "fa-solid fa-coins",
    type: CurrencyCatalog,
    restricted: true
  });
  registerImmersiveSettings(refreshActorSheets);
  registerBargaining(immersiveApi);
  registerTierAppearance();
  registerDenominations();
  Hooks.on("swadeBetterEffectsAutomaticFlags", (item, flags) => flags.push(...automaticMoneyFlags(item)));
  deriveSwadeCurrency();
  includeMoneyInVehicleCargo();

  game.modules.get(MODULE_ID).api = {
    open: openMoney,
    refreshMonthlyDue,
    distributeMoney,
    preview: previewTransaction,
    execute: executeTransaction,
    balances: summarizeWallet,
    formatAmount,
    amountScale: SCALE,
    purchaseEconomy: () => {
      const catalog = getCatalog();
      return {currency: ruleCurrency() ?? catalog.currencies.find(entry => entry.id === catalog.primary),
        tiers: immersiveRules().purchases.map(({id, name, formula}) => ({id, name, ...analyzeFormula(formula)}))};
    },
    spendWithOperations,
    credit: (actor, currencyId, amount, {prepareItems} = {}) =>
      creditIncome(actor, currencyId, positiveAmount(amount), undefined, prepareItems),
    currencyMark: createCurrencyMark,
    styleItemTier,
    ...immersiveApi
  };
});

Hooks.once("ready", () => {
  if (game.system.id !== "swade") return;
  restrictDenominationSheets();
  listenForTransactions();
  startImmersiveIntegration(refreshActorSheets);
  void installDistributionMacro().catch(reportError);
  Hooks.on("renderApplicationV2", renderMoney);
  Hooks.on("renderApplicationV2", renderImmersive);
  Hooks.on("renderApplicationV2", renderSheetTier);
  for (const event of [sbsI18n("swade-better-money.UI.createItem_2be87307d5"), sbsI18n("swade-better-money.UI.updateItem_fc765ef48a"), sbsI18n("swade-better-money.UI.deleteItem_0259ed622a")]) {
    Hooks.on(event, item => {
      if (item.type === MONEY_TYPE && item.actor) refreshMoneyManager(item.actor);
      if (item.pack && item.pack === getPack()?.collection) {
        for (const app of CurrencyCatalog.instances()) if (app.rendered && !app.busy) void app.render();
      }
    });
  }
});

function deriveSwadeCurrency() {
  const prototype = CONFIG.Actor.documentClass.prototype;
  const original = prototype.prepareDerivedData;
  prototype.prepareDerivedData = function () {
    original.call(this);
    if (this.type === "group") this.system.currency = primaryBalance(this);
    else if (this.system.details && "currency" in this.system.details) {
      this.system.details.currency = primaryBalance(this);
    }
  };
}

function includeMoneyInVehicleCargo() {
  const prototype = CONFIG.Actor.dataModels.vehicle.prototype;
  const original = prototype.prepareDerivedData;
  prototype.prepareDerivedData = function () {
    original.call(this);
    // SWADE's cargo list enumerates its built-in gear types.
    const money = this.parent.itemTypes[MONEY_TYPE] ?? [];
    this.cargo.items.push(...money);
    this.cargo.value += money.reduce((weight, item) => weight + item.system.weight * item.system.quantity, 0);
  };
}

function refreshActorSheets() {
  if (!game.ready) return;
  for (const actor of game.actors) actor.reset();
  for (const app of foundry.applications.instances.values()) {
    if (app.rendered && app.document?.documentName === "Actor") {
      if (app.document.isToken) app.document.reset();
      void app.render();
    }
  }
  refreshMoneyManagers();
}

function renderMoney(app, root) {
  if (app.document?.type === MONEY_TYPE) {
    root.classList.add("sbs-standard-swade-sheet");
    return;
  }
  const actor = app.document;
  if (actor?.documentName !== "Actor" || !root.matches(".swade.sheet") || root.classList.contains("sbs-party-sheet")) return;

  const body = root.querySelector("[data-tab='inventory'] > section.inventory")
    ?? root.querySelector("section.gear:has([data-action='createGear']) > .quickaccess-list")
    ?? root.querySelector("section[data-tab='stash']")
    ?? root.querySelector("section[data-tab='cargo'] > .item-list");
  if (!body) return;

  const old = root.querySelector("[name='system.details.currency'], [name='system.currency']");
  old?.closest(actor.type === "group" ? "fieldset" : ".form-group")?.remove();
  root.querySelector(".better-money-inventory")?.remove();

  const panel = buildInventory(root.ownerDocument, actor);
  if (actor.type === "group") body.prepend(panel);
  else body.before(panel);
  if (actor.type === "vehicle") {
    for (const row of body.querySelectorAll("[data-item-id]")) {
      if (actor.items.get(row.dataset.itemId)?.type === MONEY_TYPE) row.remove();
    }
  }
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function image(doc, src, className) {
  const img = element(doc, "img", className);
  img.alt = "";
  img.src = src;
  return img;
}

function button(doc, label, icon, click, iconOnly = false) {
  const node = element(doc, "button", iconOnly ? "money-icon-button" : "");
  node.type = "button";
  const glyph = element(doc, "i", `fa-solid fa-${icon}`);
  glyph.setAttribute("aria-hidden", "true");
  node.append(glyph);
  if (iconOnly) {
    node.setAttribute("aria-label", label);
    node.dataset.tooltip = label;
  } else node.append(` ${label}`);
  node.addEventListener("click", () => Promise.resolve(click()).catch(reportError));
  return node;
}

function buildInventory(doc, actor) {
  const panel = element(doc, "fieldset", "better-money-inventory");
  panel.append(element(doc, "legend", null, "Money"));
  const header = element(doc, "div", "money-inventory-header");
  const balances = element(doc, "ul", "money-balances");
  const wallet = summarizeWallet(actor);
  for (const {currency, amount} of wallet) {
    const entry = element(doc, "li");
    entry.append(createCurrencyMark(doc, currency), element(doc, "strong", null, amount),
      element(doc, "span", "sr-only", ` ${currency.name}`));
    balances.append(entry);
  }
  if (!wallet.length) balances.append(element(doc, "li", "hint", sbsI18n("swade-better-money.UI.Nocurrenciesconfigured_6555ff97b4")));
  header.append(balances);
  if (actor.isOwner) header.append(button(doc, sbsI18n("swade-better-money.UI.ManageMoney_460af20e2f"), sbsI18n("swade-better-money.UI.coins_62f014cb31"), () => openMoney(actor)));
  panel.append(header);

  const items = actor.items.filter(item => item.type === MONEY_TYPE);
  if (!items.length) return panel;
  const list = element(doc, "ul", "money-list");
  const names = new Map(wallet.map(({currency}) => [currency.id, currency.name]));
  const unit = game.settings.get("swade", "weightUnit") === "imperial" ? "lbs" : "kg";
  for (const item of items.sort((a, b) => a.system.tier - b.system.tier || b.system.price - a.system.price)) {
    const {quantity, currencyId, price, tier, weight} = item.system;
    const row = element(doc, "li");
    row.draggable = true;
    row.addEventListener("dragstart", event => {
      event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
    });
    const details = [names.get(currencyId) ?? sbsI18n("swade-better-money.UI.Choosecurrency_138f4d7fd9"), formatAmount(Math.round(price * SCALE)), `Tier ${tier}`];
    if (weight) details.push(`${(quantity * weight).toLocaleString()} ${unit}`);
    const description = element(doc, "div", "money-grow");
    const name = element(doc, "strong", null, item.name);
    description.append(name, element(doc, "small", null, details.join(" · ")));
    const art = element(doc, "span", "money-icon");
    art.append(image(doc, item.img, "money-icon"));
    styleItemTier(item, {icon: art, name});
    row.append(art, description, element(doc, "span", null, `×${quantity}`),
      button(doc, sbsI18n("swade-better-money.UI.Open_8f12e592f7", {p0: (item.name)}), sbsI18n("swade-better-money.UI.pen_e21a6b0cb1"), () => item.sheet.render({force: true}), true));
    if (actor.isOwner) row.append(button(doc, sbsI18n("swade-better-money.UI.Delete_0ae262c71c", {p0: (item.name)}), sbsI18n("swade-better-money.UI.trash_e06da30434"), async () => {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        classes: ["swade", "better-money", "sbs-standard-swade-sheet"],
        window: {title: sbsI18n("swade-better-money.UI.DeleteMoneyStack_62ebb66bcc")},
        content: `<p>${sbsI18n("swade-better-money.UI.Removethisentirestackfromthe_8bd2030fd6")}</p>`,
        rejectClose: false
      });
      if (confirmed) await item.delete();
    }, true));
    list.append(row);
  }
  panel.append(list);
  return panel;
}
