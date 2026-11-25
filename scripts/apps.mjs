import {t as sbsI18n} from "./i18n.mjs";
import {
  COINS, ensurePack, findRate, getCatalog, getDenominations, getHoldings, getPack, MODULE_ID, MONEY_TYPE,
  removeCurrency, removeRate, storeCurrency, storeRate, summarizeWallet
} from "./catalog.mjs";
import {formatAmount, SCALE} from "./economy.mjs";
import {denominationPreview, executeTransaction, previewTransaction, transactionRecipients} from "./wallet.mjs";
import {combineOptions, denominationOptions, lowerDenominations} from "./denomination-change.mjs";
import {openSpending} from "./immersive-actions.mjs";
import {immersiveEnabled, ruleCurrency} from "./immersive-rules.mjs";
import {openCatalogDenomination} from "./denomination-sheet.mjs";
import {currencyMark} from "./currency-marks.mjs";

const {ApplicationV2, DialogV2, HandlebarsApplicationMixin} = foundry.applications.api;
const App = HandlebarsApplicationMixin(ApplicationV2);
const template = name => `modules/${MODULE_ID}/templates/${name}.hbs`;

export function reportError(error) {
  ui.notifications.error(error.message || String(error));
}

function choices(entries, selected) {
  return entries.map(entry => ({...entry, selected: entry.id === selected}));
}

function pieceLabel(piece) {
  return `${piece.name} · ${formatAmount(piece.value)} · Tier ${piece.tier}`;
}

function planLines(pieces) {
  return pieces.map(piece => ({name: piece.name, count: piece.count, img: piece.item.img}));
}

export class CurrencyCatalog extends App {
  static DEFAULT_OPTIONS = {
    id: "better-money-catalog",
    classes: ["swade", "better-money", "sbs-standard-swade-sheet", "bm-settings-window"],
    window: {get title() { return sbsI18n("swade-better-money.UI.BetterMoneyCurrencyCatalog_108caa766e"); }, icon: "fa-solid fa-coins", resizable: true},
    position: {width: 670, height: 680},
    actions: {
      editCurrency(_event, target) {
        const catalog = getCatalog();
        const currency = catalog.currencies.find(entry => entry.id === target.dataset.id);
        this.currency = currency ? {...currency, primary: currency.id === catalog.primary} : {};
        return this.render();
      },
      editRate(_event, target) {
        const {from, to} = target.dataset;
        const rate = findRate(getCatalog().rates, from, to);
        this.rate = rate ? {...rate, fromAmount: rate.fromAmount / SCALE, toAmount: rate.toAmount / SCALE} : {fromAmount: 1};
        return this.render();
      },
      closeDraft(_event, target) {
        this[target.dataset.draft] = null;
        return this.render();
      },
      removeCurrency: async function (_event, target) {
        await this.updateCatalog(async () => {
          if (await DialogV2.confirm({
            classes: ["swade", "better-money", "sbs-standard-swade-sheet"],
            window: {title: sbsI18n("swade-better-money.UI.DeleteCurrency_da3f7f4b0e")},
            content: `<p>${sbsI18n("swade-better-money.UI.Deletethiscurrencyanditsexchange_d8964ec88b")}</p>`,
            rejectClose: false
          })) {
            await removeCurrency(target.dataset.id);
            this.currency = null;
          }
        });
      },
      removeRate: async function (_event, target) {
        await this.updateCatalog(async () => {
          await removeRate(target.dataset.from, target.dataset.to);
          this.rate = null;
        });
      },
      addDenomination: async function () {
        await this.updateCatalog(async () => {
          const pack = await ensurePack();
          const catalog = getCatalog();
          const item = await Item.implementation.create({
            name: sbsI18n("swade-better-money.UI.Newdenomination_1743f54f78"), img: COINS, type: MONEY_TYPE,
            system: {currencyId: catalog.primary || catalog.currencies[0]?.id}
          }, {pack: pack.collection});
          if (!item) throw new Error(sbsI18n("swade-better-money.UI.UnabletocreateadenominationCheck_8f694d97b9"));
          await openCatalogDenomination(item);
        });
      },
      editDenomination: async function (_event, target) {
        const item = await getPack()?.getDocument(target.dataset.id);
        if (item) await openCatalogDenomination(item);
      },
      openCompendium: async function () {
        await this.updateCatalog(async () => { (await ensurePack()).render(true); });
      },
      installMacro: async function () {
        try {
          const macro = game.macros.find(entry => entry.getFlag(MODULE_ID, "moneyMacro")) ?? await Macro.implementation.create({
            name: sbsI18n("swade-better-money.UI.ManageMoney_460af20e2f"),
            type: "script",
            img: COINS,
            command: `await game.modules.get("${MODULE_ID}").api.open(actor);`,
            ownership: {default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER},
            flags: {[MODULE_ID]: {moneyMacro: true}}
          });
          await macro.sheet.render({force: true});
        } catch (error) {
          reportError(error);
        }
      }
    }
  };

  static PARTS = {body: {template: template("catalog"), scrollable: [""]}};
  currency = null;
  rate = null;
  busy = false;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const catalog = getCatalog();
    const currencies = catalog.currencies.map(currency => ({...currency, mark: currencyMark(currency), primary: currency.id === catalog.primary}));
    const names = new Map(currencies.map(currency => [currency.id, currency.name]));
    const rates = catalog.rates.map(rate => ({
      ...rate, label: `${formatAmount(rate.fromAmount)} ${names.get(rate.from)} = ${formatAmount(rate.toAmount)} ${names.get(rate.to)}`
    }));
    const denominations = (await getDenominations()).map(piece => ({
      id: piece.id, img: piece.item.img, label: pieceLabel(piece), currency: names.get(piece.currencyId) ?? sbsI18n("swade-better-money.UI.Unlistedcurrency_797fcdf677")
    }));
    return {
      ...context, currencies, rates, denominations, canAddRate: currencies.length > 1, currency: this.currency,
      rate: this.rate && {...this.rate, fromChoices: choices(currencies, this.rate.from), toChoices: choices(currencies, this.rate.to)}
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const form of this.element.querySelectorAll("form[data-money-form]")) {
      form.onsubmit = event => {
        event.preventDefault();
        const data = new foundry.applications.ux.FormDataExtended(form).object;
        void this.updateCatalog(async () => {
          if (form.dataset.moneyForm === "currency") {
            await storeCurrency({...data, id: this.currency?.id});
            this.currency = null;
          } else {
            await storeRate(data, this.rate?.from, this.rate?.to);
            this.rate = null;
          }
        });
      };
    }
    for (const row of this.element.querySelectorAll("[data-drag-denomination]")) {
      row.addEventListener("dragstart", async event => {
        const id = row.dataset.dragDenomination;
        const uuid = `Compendium.${getPack().collection}.Item.${id}`;
        event.dataTransfer.setData("text/plain", JSON.stringify({type: "Item", uuid}));
      });
    }
  }

  async updateCatalog(callback) {
    if (this.busy || !game.user.isGM) return;
    this.busy = true;
    try {
      await callback();
      await this.render();
    } catch (error) {
      reportError(error);
    } finally {
      this.busy = false;
    }
  }
}

const MODES = [
  {id: "spend", get name() { return sbsI18n("swade-better-money.UI.Spend_85f3d558db"); }},
  {id: "transfer", get name() { return sbsI18n("swade-better-money.UI.Transfer_dde8bef78c"); }},
  {id: "break", get name() { return sbsI18n("swade-better-money.UI.Breakadenomination_9844c1a73a"); }},
  {id: "combine", get name() { return sbsI18n("swade-better-money.UI.Combinedenominations_bbd2464df7"); }},
  {id: "exchange", get name() { return sbsI18n("swade-better-money.UI.Exchangecurrency_dec121dac5"); }}
];

const managers = new Map();

export function refreshMoneyManagers() {
  for (const app of managers.values()) if (app.rendered && !app.busy) void app.render();
}

export function refreshMoneyManager(actor) {
  const app = managers.get(actor.uuid);
  if (app?.rendered && !app.busy && ["break", "combine"].includes(app.state.action)) void app.render();
}

export async function openMoney(actor, {action} = {}) {
  actor ??= canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!actor?.isOwner) {
    ui.notifications.warn(sbsI18n("swade-better-money.UI.Selectatokenyouownor_2c99ffc3b1"));
    return;
  }
  const app = managers.get(actor.uuid) ?? new MoneyManager(actor);
  if (!app.busy && MODES.some(mode => mode.id === action)) {
    Object.assign(app.state, {action, quantity: 1});
    app.plan = app.denominationPlan = null;
  }
  return app.render({force: true});
}

class MoneyManager extends App {
  static DEFAULT_OPTIONS = {
    classes: ["swade", "better-money", "sbs-standard-swade-sheet"],
    window: {get title() { return sbsI18n("swade-better-money.UI.ManageMoney_460af20e2f"); }, icon: "fa-solid fa-coins", resizable: true},
    position: {width: 545, height: "auto"},
    actions: {
      planSpending: async function (_event, button) {
        if (this.busy || !immersiveEnabled()) return;
        this.busy = true;
        button.disabled = true;
        try {
          await openSpending(this.actor, this.state.currencyId);
        } catch (error) {
          reportError(error);
        } finally {
          this.busy = false;
          if (this.rendered) await this.render();
        }
      },
      apply: async function () {
        const plan = this.denominationPlan ?? this.plan;
        if (!plan || this.busy) return;
        this.busy = true;
        this.plan = null;
        this.denominationPlan = null;
        this.element.querySelector("[data-action='apply']").disabled = true;
        this.element.querySelector("form > fieldset").disabled = true;
        try {
          await executeTransaction(this.actor, {...this.state}, plan.signature);
          const message = {break: sbsI18n("swade-better-money.UI.Denominationbroken_a2b8362191"), combine: sbsI18n("swade-better-money.UI.Denominationscombined_b25ea60595")};
          ui.notifications.info(message[plan.action] ?? sbsI18n("swade-better-money.UI.Moneytransactioncompleted_ca254b2321"));
        } catch (error) {
          reportError(error);
        } finally {
          this.busy = false;
          if (this.rendered) await this.render();
        }
      }
    }
  };

  static PARTS = {body: {template: template("manager"), scrollable: [""]}};
  state = {action: "spend", quantity: 1};
  plan = null;
  denominationPlan = null;
  busy = false;

  constructor(actor) {
    super({window: {title: sbsI18n("swade-better-money.UI.ManageMoney_ccecd4f19d", {p0: (actor.name)})}});
    this.actor = actor;
    managers.set(actor.uuid, this);
  }

  async _onClose(options) {
    managers.delete(this.actor.uuid);
    await super._onClose(options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const catalog = getCatalog();
    const totals = summarizeWallet(this.actor, catalog);
    const {state} = this;
    if (!totals.some(entry => entry.currency.id === state.currencyId)) {
      const economyCurrency = immersiveEnabled() && ruleCurrency();
      state.currencyId = (totals.find(entry => entry.currency.id === economyCurrency?.id)
        ?? totals.find(entry => entry.units > 0) ?? totals[0])?.currency.id;
    }
    const {action, currencyId} = state;
    const isBreak = action === "break";
    const isCombine = action === "combine";
    const denominationChange = isBreak || isCombine;
    const holdings = denominationChange ? getHoldings(this.actor).filter(piece => piece.currencyId === currencyId) : [];
    const catalogPieces = denominationChange ? (await getDenominations()).filter(piece => piece.currencyId === currencyId) : [];
    const source = isBreak ? holdings.find(piece => piece.id === state.source)
      ?? holdings.find(piece => lowerDenominations(piece, catalogPieces).length) ?? holdings[0] : null;
    if (isBreak) {
      state.source = source?.id;
      if (source && state.quantity > source.count) state.quantity = source.count;
    }
    if (isCombine && !catalogPieces.some(piece => piece.id === state.denomination)) {
      state.denomination = (catalogPieces.find(piece => lowerDenominations(piece, holdings).length) ?? catalogPieces[0])?.id;
    }
    const isTransfer = action === "transfer";
    const isExchange = action === "exchange";
    const destinations = isExchange ? catalog.currencies.filter(currency => findRate(catalog.rates, currencyId, currency.id)) : [];
    const recipients = isTransfer ? transactionRecipients(this.actor).map(actor => ({id: actor.uuid, name: actor.name})) : [];
    const plan = this.plan;
    const output = catalog.currencies.find(currency => currency.id === plan?.outputCurrency);
    return {
      ...context, state, totals: totals.map(entry => ({...entry, mark: currencyMark(entry.currency)})), busy: this.busy, modes: choices(MODES, action),
      immersiveSpend: action === "spend" && immersiveEnabled(),
      currencies: choices(totals.map(({currency}) => currency), currencyId),
      isBreak, isCombine, denominationChange, isTransfer, isExchange,
      holdings, catalogPieces, source, currencyName: totals.find(entry => entry.currency.id === currencyId)?.currency.name,
      sources: choices(holdings.map(piece => ({id: piece.id, label: formatAmount(piece.value)})), state.source),
      combineTargets: choices(catalogPieces.map(piece => ({id: piece.id, label: `${formatAmount(piece.value)} · ${piece.name}`})), state.denomination),
      destinations: choices(destinations, state.exchangeCurrency), recipients: choices(recipients, state.target),
      preview: plan && {
        debit: planLines(plan.debit), change: planLines(plan.change), payout: planLines(plan.payout),
        outputName: output?.name, outputMark: currencyMark(output),
        received: plan.received ? formatAmount(plan.received) : null,
        recipient: isTransfer ? plan.target.name : null
      }
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const form = this.element.querySelector("form");
    if (!form) return;
    const readForm = () => Object.assign(this.state, Object.fromEntries(new FormData(form)));
    const conversion = context.denominationChange ? form.querySelector(".money-denomination-change") : null;
    let conversions = [];
    const refreshConversion = () => {
      const {action, currencyId, denomination} = this.state;
      const quantity = Number(form.elements.quantity.value);
      const {source, holdings, catalogPieces} = context;
      this.state.quantity = form.elements.quantity.value;
      const valid = Number.isSafeInteger(quantity) && quantity > 0;
      const target = context.isCombine ? catalogPieces.find(piece => piece.id === denomination) : null;
      const {options: available, error} = !valid ? {options: []}
        : context.isCombine ? (target ? combineOptions(target, quantity, holdings) : {options: []})
        : denominationOptions(action, quantity, source, holdings, catalogPieces);
      conversions = available;
      const choice = context.isCombine ? this.state.mix : denomination;
      const selected = conversions.find(option => option.id === choice) ?? conversions[0];
      const message = error
        ?? (!holdings.length ? sbsI18n("swade-better-money.UI.Thiswallethasnodenominationsin_1a09114e7a")
          : !valid ? sbsI18n("swade-better-money.UI.Enterawholequantityofat_777a538e60")
          : context.isBreak && quantity > source?.count ? `This stack has only ${source.count.toLocaleString()} pieces.`
          : !catalogPieces.length ? sbsI18n("swade-better-money.UI.Adddenominationsforthiscurrencyin_cca9591730")
          : context.isBreak ? sbsI18n("swade-better-money.UI.Thisstackcannotbebrokeninto_0ae8e583f9")
          : sbsI18n("swade-better-money.UI.Thewalletcannotmakethatquantity_54e5b1cf83"));
      renderDenominationOptions(conversion, conversions, selected, message, context.isBreak);
      selectConversion(selected);
    };
    const selectConversion = selected => {
      this.state[context.isBreak ? "denomination" : "mix"] = selected?.id ?? "";
      this.denominationPlan = selected ? denominationPreview(this.actor, this.state.action, this.state.currencyId, selected.plan) : null;
      renderDenominationSummary(conversion, selected?.plan, context.currencyName);
    };
    if (conversion) refreshConversion();
    form.oninput = event => {
      if (this.busy) return;
      if (conversion && event.target.name === "quantity") {
        refreshConversion();
        return;
      }
      if (conversion && event.target.name === (context.isBreak ? "denomination" : "mix")) {
        selectConversion(conversions.find(option => option.id === event.target.value));
        return;
      }
      if (context.isCombine && event.target.name === "denomination") {
        this.state.denomination = event.target.value;
        this.state.mix = "";
        refreshConversion();
        return;
      }
      this.denominationPlan = null;
      if (conversion) conversion.querySelector("[data-action='apply']").disabled = true;
      this.plan = null;
      const preview = this.element.querySelector(".money-preview");
      if (preview) preview.hidden = true;
    };
    form.onchange = event => {
      if (this.busy) return;
      if (context.isCombine && event.target.name === "denomination" && this.state.denomination !== event.target.value) {
        this.state.denomination = event.target.value;
        this.state.mix = "";
        refreshConversion();
      }
      readForm();
      if (["action", sbsI18n("swade-better-money.UI.currencyId_3fd55412a4"), "source"].includes(event.target.name)) {
        this.state.denomination = "";
        this.state.mix = "";
        this.state.quantity = 1;
        void this.render();
      }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (this.busy || conversion) return;
      readForm();
      this.busy = true;
      form.querySelector("fieldset").disabled = true;
      try {
        this.plan = await previewTransaction(this.actor, {...this.state});
      } catch (error) {
        reportError(error);
      } finally {
        this.busy = false;
        if (this.rendered) await this.render();
      }
    };
  }
}

function makeElement(doc, tag, className, content) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
}

function renderDenominationOptions(panel, options, selected, emptyMessage, isBreak) {
  const doc = panel.ownerDocument;
  const list = panel.querySelector(".money-change-options");
  if (!options.length) {
    list.replaceChildren(makeElement(doc, "p", "hint", emptyMessage));
    return;
  }
  list.replaceChildren(...options.map(option => {
    const row = makeElement(doc, "label", "money-change-option");
    const input = makeElement(doc, "input");
    Object.assign(input, {type: "radio", name: isBreak ? "denomination" : "mix", value: option.id, checked: option === selected});
    const {change, debit} = option.plan;
    const piece = change[0];
    const info = makeElement(doc, "span", "money-grow");
    if (!isBreak) {
      row.append(input);
      info.append(makeElement(doc, "strong", "", debit.map(stack => `${stack.count.toLocaleString()} × ${stack.name}`).join(" + ")));
    } else if (change.length === 1) {
      const img = makeElement(doc, "img", "money-icon");
      Object.assign(img, {src: piece.item.img, alt: ""});
      row.append(input, img);
      info.append(makeElement(doc, "strong", "", `${piece.count} × ${piece.name}`));
      info.append(makeElement(doc, "small", "", `${formatAmount(piece.value)} each`));
    } else {
      row.append(input);
      info.append(makeElement(doc, "strong", "", sbsI18n("swade-better-money.UI.Mixeddenominations_04e751f942")),
        makeElement(doc, "small", "", change.map(stack => `${stack.count} × ${stack.name}`).join(" + ")));
    }
    row.append(info);
    return row;
  }));
}

function renderDenominationSummary(panel, plan, currencyName) {
  const doc = panel.ownerDocument;
  const summary = panel.querySelector(".money-change-summary");
  panel.querySelector("[data-action='apply']").disabled = !plan;
  summary.hidden = !plan;
  if (!plan) {
    summary.replaceChildren();
    return;
  }
  const heading = makeElement(doc, "strong", "", `${formatAmount(plan.amount)} ${currencyName} in denominations`);
  const columns = makeElement(doc, "div", "money-fields");
  for (const [label, pieces] of [[sbsI18n("swade-better-money.UI.Takefromwallet_e884591b0b"), plan.debit], [sbsI18n("swade-better-money.UI.Addtowallet_78a0dae521"), plan.change]]) {
    const column = makeElement(doc, "section");
    const list = makeElement(doc, "ul", "money-list");
    for (const {count, name} of pieces) list.append(makeElement(doc, "li", "", `${count.toLocaleString()} × ${name}`));
    column.append(makeElement(doc, "small", "", label), list);
    columns.append(column);
  }
  summary.replaceChildren(heading, columns);
}
