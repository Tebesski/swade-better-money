import {t as sbsI18n} from "./i18n.mjs";
import {COINS, getCatalog, getDenominations, MODULE_ID, MONEY_TYPE} from "./catalog.mjs";
import {formatAmount, positiveAmount, SCALE} from "./economy.mjs";
import {automaticMoneyFlags, BETTER_EFFECTS, betterEffectsApi, storedMoneyFlags} from "./money-flags.mjs";

const {HandlebarsApplicationMixin} = foundry.applications.api;
const {ItemSheetV2} = foundry.applications.sheets;

class DenominationSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["swade", "better-money", "denomination-sheet"],
    position: {width: 500, height: "auto"},
    window: {resizable: true},
    sheetConfig: false,
    form: {submitOnChange: true}
  };

  static PARTS = {
    sheet: {template: `modules/${MODULE_ID}/templates/denomination.hbs`, scrollable: [""]}
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const {system} = this.item;
    const currencies = getCatalog().currencies.map(currency => ({
      ...currency, selected: currency.id === system.currencyId
    }));
    if (system.currencyId && !currencies.some(currency => currency.selected)) {
      currencies.unshift({id: system.currencyId, name: sbsI18n("swade-better-money.UI.Unlistedcurrency_797fcdf677"), selected: true});
    }
    this.availableDenominations = await getDenominations();
    const pieces = this.availableDenominations.filter(piece => piece.currencyId === system.currencyId);
    const values = [...new Set([system.price, ...pieces.map(piece => piece.value / SCALE)])].sort((a, b) => a - b);
    const tiers = [...new Set([system.tier, ...pieces.map(piece => piece.tier)])].sort((a, b) => a - b);
    return {
      ...context, item: this.item, system, currencies,
      faceValues: values.map(value => ({value, label: formatAmount(Math.round(value * SCALE)), selected: value === system.price})),
      denominationTiers: tiers.map(value => ({value, selected: value === system.tier})),
      showFlags: Boolean(betterEffectsApi()?.normalizeFlags),
      customFlags: storedMoneyFlags(this.item).tags?.join(", "),
      automaticFlags: automaticMoneyFlags(this.item).join(", "),
      defineValue: context.editable && game.user.isGM,
      showSave: context.editable && this.options.form.closeOnSubmit
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    const currency = root.querySelector('[name="system.currencyId"]');
    const refresh = () => {
      const pieces = this.availableDenominations.filter(piece => piece.currencyId === currency.value);
      for (const [name, values] of [
        ["system.price", pieces.map(piece => piece.value / SCALE)],
        ["system.tier", pieces.map(piece => piece.tier)]
      ]) {
        const select = root.querySelector(`[name="${name}"]`);
        const current = Number(select.value);
        const custom = select.querySelector('[value="custom"]');
        select.replaceChildren(...[...new Set([current, ...values])].sort((a, b) => a - b)
          .map(value => new Option(name === "system.price" ? formatAmount(Math.round(value * SCALE)) : String(value), String(value), false, value === current)),
        ...(custom ? [custom] : []));
      }
    };
    currency.addEventListener("change", refresh);
    for (const name of ["system.price", "system.tier"]) {
      const select = root.querySelector(`[name="${name}"]`);
      let previous = select.value;
      select.addEventListener("change", async event => {
        if (select.value !== "custom") { previous = select.value; return; }
        event.stopPropagation();
        select.value = previous;
        const tier = name === "system.tier";
        const value = await foundry.applications.api.DialogV2.prompt({
          rejectClose: false,
          classes: ["swade", "better-money"], window: {title: tier ? sbsI18n("swade-better-money.UI.Customdenominationtier_715af8c6c4") : sbsI18n("swade-better-money.UI.Customfacevalue_a69afac077")},
          content: `<input name="value" type="number" min="${tier ? 1 : 0.000001}" step="${tier ? 1 : 0.000001}" value="${previous}" required aria-label="${tier ? sbsI18n("swade-better-money.UI.Tier_cb9e8664ed") : sbsI18n("swade-better-money.UI.Facevalue_1b00583a16")}">`,
          ok: {label: sbsI18n("swade-better-money.UI.Usevalue_64aa5b54f1"), callback: (_event, button) => button.form.elements.value.value}
        });
        if (!value) return;
        const number = Number(value);
        if (tier ? !Number.isSafeInteger(number) || number < 1 : !positiveAmount(value)) return;
        if (!Array.from(select.options).some(option => Number(option.value) === number)) {
          select.add(new Option(tier ? String(number) : formatAmount(Math.round(number * SCALE)), String(number)), select.querySelector('[value="custom"]'));
        }
        select.value = previous = String(number);
        select.dispatchEvent(new Event("change", {bubbles: true}));
      });
    }
  }

  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const manual = data.betterEffectsFlags;
    delete data.betterEffectsFlags;
    const api = betterEffectsApi();
    if (manual !== undefined && api?.normalizeFlags) {
      const {tags = [], excludedTags = []} = storedMoneyFlags(this.item);
      const next = api.normalizeFlags(manual);
      if (!foundry.utils.equals(next, tags)) {
        // Keep exclusions set in Better Effects unless a flag is explicitly added here.
        const added = new Set(next.filter(tag => !tags.includes(tag)));
        foundry.utils.setProperty(data, `flags.${BETTER_EFFECTS}`, {
          tags: next,
          excludedTags: excludedTags.filter(tag => !added.has(tag))
        });
      }
    }
    return data;
  }
}

export function openCatalogDenomination(item) {
  const id = `better-money-catalog-denomination-${item.id}`;
  const sheet = item.apps[id] ?? new DenominationSheet({
    id, document: item,
    form: {submitOnChange: false, closeOnSubmit: true}
  });
  return sheet.render({force: true});
}

export function registerDenominations() {
  // SWADE counts GearData instances when it calculates encumbrance.
  const GearData = CONFIG.Item.dataModels.gear;
  const {NumberField, StringField} = foundry.data.fields;
  class MoneyData extends GearData {
    static defineSchema() {
      return {
        ...super.defineSchema(),
        currencyId: new StringField({blank: true, initial: ""}),
        price: new NumberField({
          min: 1 / SCALE, max: Number.MAX_SAFE_INTEGER / SCALE, initial: 1,
          validate: value => {
            try {
              positiveAmount(value);
              return true;
            } catch {
              return false;
            }
          },
          validationError: sbsI18n("swade-better-money.UI.Thefacevaluemustbea_d40e18343d")
        }),
        tier: new NumberField({integer: true, min: 1, max: Number.MAX_SAFE_INTEGER, initial: 1}),
        weight: new NumberField({min: 0, initial: 0}),
        quantity: new NumberField({integer: true, min: 1, max: Number.MAX_SAFE_INTEGER, initial: 1})
      };
    }

    async _preCreate(data, options, user) {
      if (!data.img) this.parent.updateSource({img: COINS});
      return super._preCreate({...data, img: data.img || COINS}, options, user);
    }
  }

  CONFIG.Item.dataModels[MONEY_TYPE] = MoneyData;
  foundry.documents.collections.Items.registerSheet(MODULE_ID, DenominationSheet, {
    types: [MONEY_TYPE], makeDefault: true, label: sbsI18n("swade-better-money.UI.BetterMoneyDenomination_80cd0f5987")
  });
}

export function restrictDenominationSheets() {
  // Catch-all sheet registrations also match module subtypes. Money has its own template.
  const {Items} = foundry.documents.collections;
  for (const {id, cls} of Object.values(CONFIG.Item.sheetClasses[MONEY_TYPE] ?? {})) {
    if (cls === DenominationSheet) continue;
    const scope = id.slice(0, -(cls.name.length + 1));
    Items.unregisterSheet(scope, cls, {types: [MONEY_TYPE]});
  }
}
