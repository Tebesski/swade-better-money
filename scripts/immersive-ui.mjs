import {t as sbsI18n, a as sbsI18nAttribute} from "./i18n.mjs";
import {COINS, getCatalog, MODULE_ID, MONEY_TYPE} from "./catalog.mjs";
import {analyzeFormula} from "./economy-formulas.mjs";
import {positiveAmount} from "./economy.mjs";
import {bargainConfig, DEFAULT_BARGAIN_TRAITS} from "./bargaining-rules.mjs";
import {
  DEFAULT_RULES, hudHustlesEnabled, hustleLabel, immersiveEnabled, immersiveRules, installYuan, OUTCOMES, purchaseTierId, ruleCurrency
} from "./immersive-rules.mjs";
import {
  awardSelected, escape, formDialog, moneyText, runHustle, selectOptions
} from "./immersive-actions.mjs";
import {
  configureLifestyle, gamePeriod, invoices,
  removeObligation, saveObligation, upkeepState
} from "./upkeep.mjs";
import {creditIncome, withWalletLock} from "./wallet.mjs";
import {synchroniseUpkeep} from "./upkeep-calendar.mjs";
import {payExpenses, manageExpenses} from "./expense-dialog.mjs";

const {ApplicationV2, DialogV2, HandlebarsApplicationMixin} = foundry.applications.api;
const GROUPS = {
  get purchases() { return sbsI18n("swade-better-money.UI.PurchaseTiers_181c4affb1"); }, get lifestyles() { return sbsI18n("swade-better-money.UI.MonthlyUpkeep_b0e8def75c"); }, get obligations() { return sbsI18n("swade-better-money.UI.MonthlyObligations_598118dbce"); },
  get gigs() { return sbsI18n("swade-better-money.UI.GigRewards_12cedb7f74"); }, get hustles() { return sbsI18n("swade-better-money.UI.Hustles_298fa1dc5f"); }
};
const report = error => ui.notifications.error(error.message || String(error));

function input(label, key, value, type = sbsI18n("swade-better-money.UI.text_982d9e3eb9")) {
  const number = type === "number" ? ' min="0" max="20" step="1"' : "";
  return `<label class="money-field">${escape(label)}<input name="${key}" type="${type}" value="${escape(value)}"${number} required></label>`;
}

const textarea = (label, key, value) =>
  `<label class="money-field">${escape(label)}<textarea name="${key}" rows="2">${escape(value)}</textarea></label>`;

function normalizedFormula(value, fixed = false) {
  const result = analyzeFormula(value);
  if (fixed && result.min !== result.max) throw new Error(sbsI18n("swade-better-money.UI.Monthlycostsmustuseafixed_d28f4225cd"));
  if (!Roll.validate(result.text)) throw new Error(sbsI18n("swade-better-money.UI.Foundrycouldnotparsethatformula_a352f0a81b"));
  return result.text;
}

async function editTier(group, existing) {
  const entry = existing ?? {name: "", description: "", formula: "0"};
  const isHustle = group === "hustles";
  const bargain = ["gigs", "hustles"].includes(group) ? bargainConfig(group, entry) : null;
  const lifestyle = group === "lifestyles";
  const fields = `
    ${input("Name", sbsI18n("swade-better-money.UI.name_82a3537ff0"), entry.name)}
    ${textarea("Description", "description", entry.description)}
    ${isHustle ? Object.entries(OUTCOMES).map(([key, label]) => {
      const outcome = entry.outcomes?.[key];
      return `<fieldset><legend>${label}</legend>
        <div class="money-fields">${input(sbsI18n("swade-better-money.UI.Rewardformula_0673fddc38"), sbsI18n("swade-better-money.UI.formula_51a679f11d", {p0: (key)}), outcome?.formula ?? "0")}</div>
        ${textarea(sbsI18n("swade-better-money.UI.Outcomechatnote_63ef37bbe6"), `note-${key}`, outcome?.note)}
      </fieldset>`;
    }).join("") : input(lifestyle || group === "obligations" ? sbsI18n("swade-better-money.UI.Monthlycost_0d6a2dca33") : sbsI18n("swade-better-money.UI.Formula_d00bd4ec32"), "formula", entry.formula)}
    ${bargain ? `<fieldset><legend>${sbsI18n("swade-better-money.UI.Bargaining_18d902a13d")}</legend><div class="money-fields">
      <label class="money-field">${sbsI18n("swade-better-money.UI.BaseintervalNeutral_0df156cace")} <input type="number" name="bargainInterval" min="0.000001" step="0.000001" value="${escape(bargain.interval)}" required></label>
      ${input(sbsI18n("swade-better-money.UI.Acceptablelimitformula_9a5cd14fa7"), sbsI18n("swade-better-money.UI.bargainFormula_83a42021b1"), bargain.formula)}</div></fieldset>` : ""}
    `;
  const data = await formDialog(GROUPS[group], fields, sbsI18n("swade-better-money.UI.SaveEntry_cf424c8a99"));
  if (!data || data === "cancel") return null;
  const name = data.name.trim();
  if (!name) throw new Error(sbsI18n("swade-better-money.UI.Enteranamefortheentry_fe7ceff92f"));
  const updated = {id: existing?.id ?? foundry.utils.randomID(), name, description: data.description.trim()};
  if (isHustle) {
    updated.outcomes = Object.fromEntries(Object.keys(OUTCOMES).map(key => [key, {
      formula: normalizedFormula(data[`formula-${key}`]), note: data[`note-${key}`].trim()
    }]));
  } else updated.formula = normalizedFormula(data.formula, lifestyle || group === "obligations");
  if (bargain) {
    positiveAmount(data.bargainInterval);
    updated.bargain = {interval: data.bargainInterval, formula: normalizedFormula(data.bargainFormula)};
  }
  return updated;
}

class ImmersiveSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "better-money-immersive-settings",
    classes: ["swade", "better-money", "sbs-standard-swade-sheet"],
    position: {width: 690, height: 710},
    window: {get title() { return sbsI18n("swade-better-money.UI.ImmersiveEconomy_d07815b42a"); }, resizable: true, icon: "fa-solid fa-coins"},
    actions: {
      editEntry: async function (_event, button) {
        await this.applyChange(async () => {
          const {group, id} = button.dataset;
          const old = immersiveRules()[group].find(entry => entry.id === id);
          const entry = await editTier(group, old);
          if (!entry) return;
          const settings = foundry.utils.deepClone(immersiveRules());
          const list = settings[group];
          const index = list.findIndex(current => current.id === entry.id);
          if (index >= 0) list[index] = entry;
          else list.push(entry);
          await game.settings.set(MODULE_ID, "immersiveRules", settings);
        });
      },
      deleteEntry: async function (_event, button) {
        await this.applyChange(async () => {
          const {group, id} = button.dataset;
          const confirmed = await DialogV2.confirm({window: {title: sbsI18n("swade-better-money.UI.DeleteEconomyEntry_c0bc0ea346")},
            content: `<p>${sbsI18n("swade-better-money.UI.Removethisentryfromtheworld_257d18baec")}</p>`, rejectClose: false});
          if (!confirmed) return;
          const settings = foundry.utils.deepClone(immersiveRules());
          settings[group] = settings[group].filter(entry => entry.id !== id);
          await game.settings.set(MODULE_ID, "immersiveRules", settings);
        });
      },
      installYuan: async function () {
        await this.applyChange(async () => {
          if (!await installYuan()) return;
          ui.notifications.info(sbsI18n("swade-better-money.UI.TheYuanexampleisavailablein_9bd56176df"));
        });
      },
      macro: async function (_event, button) {
        try {
          await installMacro(button.dataset.macro);
        } catch (error) {
          report(error);
        }
      }
    }
  };

  static PARTS = {body: {template: `modules/${MODULE_ID}/templates/immersive-settings.hbs`, scrollable: [""]}};
  busy = false;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rules = immersiveRules();
    return {...context, rules: {bargainTraits: DEFAULT_BARGAIN_TRAITS, ...rules},
      currencies: getCatalog().currencies.map(entry => ({...entry, selected: entry.id === rules.currencyId})),
      groups: Object.entries(GROUPS).map(([id, label]) => ({id, label, entries: rules[id].map(entry => ({
        ...entry, notes: ""
      }))}))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const form = this.element.querySelector("form");
    form.onsubmit = event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      void this.applyChange(async () => {
        const bargainTraits = data.bargainTraits.split(",").map(name => name.trim()).filter(Boolean).join(", ");
        if (!bargainTraits) throw new Error(sbsI18n("swade-better-money.UI.Enteratleastoneskillfor_f50938a039"));
        const settings = {...immersiveRules(), currencyId: data.currencyId || immersiveRules().currencyId, earnLabel: data.earnLabel.trim(), bargainTraits};
        await game.settings.set(MODULE_ID, "immersiveRules", settings);
      });
    };
  }

  async applyChange(callback) {
    if (this.busy || !game.user.isGM) return;
    this.busy = true;
    try {
      await callback();
      await this.render();
    } catch (error) {
      report(error);
    } finally {
      this.busy = false;
    }
  }
}

const MACROS = {
  hustle: {get name() { return sbsI18n("swade-better-money.UI.Hustle_ffafaee5b6"); }, command: "hustle(actor)"},
  refreshDue: {get name() { return sbsI18n("swade-better-money.UI.Refreshmonthlydue_e25091a781"); }, command: "refreshMonthlyDue()"}
};

async function installMacro(key) {
  const data = MACROS[key];
  if (!data || !game.user.isGM) return;
  const match = game.macros.find(macro => macro.getFlag(MODULE_ID, "immersiveMacro") === key);
  const macro = match ?? await Macro.implementation.create({
    name: data.name, type: "script", img: COINS,
    command: `await game.modules.get("${MODULE_ID}").api.${data.command};`,
    ownership: {default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER},
    flags: {[MODULE_ID]: {immersiveMacro: key}}
  });
  await macro.sheet.render({force: true});
}

export function registerImmersiveSettings(refresh) {
  game.settings.register(MODULE_ID, "immersiveRules", {
    scope: "world", config: false, type: Object, default: DEFAULT_RULES,
    onChange: () => refreshVariant(refresh)
  });
  game.settings.register(MODULE_ID, "yuanInstalled", {scope: "world", config: false, type: Boolean, default: false});
  game.settings.register(MODULE_ID, "immersiveEconomy", {
    name: sbsI18n("swade-better-money.UI.ImmersiveEconomy_d07815b42a"), hint: sbsI18n("swade-better-money.UI.Usepurchasetiersmonthlyupkeepgigs_318c675888"),
    scope: "world", config: true, type: Boolean, default: false, onChange: () => {
      refreshVariant(refresh);
    }
  });
  game.settings.registerMenu(MODULE_ID, "immersiveSettings", {
    name: sbsI18n("swade-better-money.UI.ImmersiveEconomyRules_a21ace16cd"), label: sbsI18n("swade-better-money.UI.ConfigureImmersiveEconomy_3d95e483b2"), icon: "fa-solid fa-coins",
    type: ImmersiveSettings, restricted: true
  });
}

function refreshHud() {
  if (game.ready) game.modules.get("swade-hud")?.api?.render?.();
}

function refreshVariant(refresh) {
  if (!game.ready) return;
  if (game.user.isGM && canvas.ready) void ui.controls.render({reset: true});
  for (const app of foundry.applications.instances.values()) {
    if (!immersiveEnabled() && app.tabGroups?.about === "money-upkeep") app.tabGroups.about = "advances";
    if (app.rendered && app.document?.documentName === "Item") void app.render();
  }
  refresh();
  refreshHud();
}

export function startImmersiveIntegration(refresh) {
  let previous = gamePeriod().month;
  const update = () => {
    const month = gamePeriod().month;
    if (month === previous) return;
    previous = month;
    if (immersiveEnabled()) refresh();
  };
  Hooks.on("updateWorldTime", update);
  Hooks.on("simple-calendar-date-time-change", update);
  Hooks.on("simple-calendar-ready", update);
}

export const immersiveApi = {
  hustleEnabled: hudHustlesEnabled, hustleLabel,
  hustle: async (...args) => { try {return await runHustle(...args);} catch (error) {report(error);} },
  award: async () => {try {await awardSelected();} catch (error) {report(error);} },
  canHealNaturally: () => true,
  receiveEarnings: async (actor, amount) => {
    const catalog = getCatalog();
    if (!catalog.primary) return false;
    try {
      await creditIncome(actor, catalog.primary, amount * 1_000_000);
      ui.notifications.info(sbsI18n("swade-better-money.UI.earned_80d89c40ca", {p0: (actor.name), p1: (amount)}));
    } catch (error) {
      report(error);
    }
    return true;
  }
};

export function renderImmersive(app, root) {
  if (!immersiveEnabled()) return;
  const document = app.document;
  if (document?.documentName === "Item" && document.type !== MONEY_TYPE) {
    const price = root.querySelector('[name="system.price"]');
    if (!price) return;
    const row = price.closest(".form-group");
    if (!row) return;
    const {purchases} = immersiveRules();
    const current = purchaseTierId(document, purchases);
    const select = root.ownerDocument.createElement("select");
    select.id = price.id;
    select.innerHTML = `<option value="">${sbsI18n("swade-better-money.UI.Unassigned_14d33bd014")}</option>${selectOptions(purchases, current)}`;
    select.disabled = !app.isEditable || price.disabled;
    const label = row.querySelector("label");
    if (label) label.textContent = sbsI18n("swade-better-money.UI.Tier_cb9e8664ed");
    row.classList.add("better-money-tier");
    price.replaceWith(select);
    select.onchange = () => void document.setFlag(MODULE_ID, "purchaseTier", select.value).catch(report);
  } else if (document?.documentName === "Actor" && document.type === "character") {
    renderUpkeep(app, root, document);
  }
}

function renderUpkeep(app, root, actor) {
  const about = root.querySelector('.about-body[data-tab="about"]');
  const nav = about?.querySelector("nav.tabs");
  if (!nav || nav.querySelector('[data-tab="money-upkeep"]')) return;
  const doc = root.ownerDocument;
  const active = app.tabGroups.about === "money-upkeep";
  const tab = doc.createElement("a");
  tab.className = active ? "active" : "";
  Object.assign(tab.dataset, {action: "tab", group: "about", tab: "money-upkeep"});
  const label = doc.createElement("span");
  label.textContent = sbsI18n("swade-better-money.UI.Upkeep_7671224c5c");
  tab.append(label);
  nav.append(tab);
  const panel = doc.createElement("section");
  panel.className = `tab better-money-inventory immersive-upkeep${active ? " active" : ""}`;
  Object.assign(panel.dataset, {group: "about", tab: "money-upkeep"});
  const state = upkeepState(actor);
  const {lifestyles, obligations} = immersiveRules();
  const rows = invoices(actor, state);
  const currency = ruleCurrency();
  const pending = lifestyles.find(entry => entry.id === state.lifestyle?.id);

  panel.innerHTML = `
    <fieldset><legend>${sbsI18n("swade-better-money.UI.Lifestyle_2e6c28eb66")}</legend>
      ${game.user.isGM ? `<button type="button" data-upkeep="sync">${sbsI18n("swade-better-money.UI.Synchronisewiththecalendar_3c5a649d8f")}</button>` : ""}
      ${actor.isOwner ? `<label class="money-field">${sbsI18n("swade-better-money.UI.Lifestyle_2e6c28eb66")}
        <select data-upkeep-tier><option value="">${sbsI18n("swade-better-money.UI.Chooseupkeep_fb31081182")}</option>${selectOptions(lifestyles, state.lifestyle?.id)}</select>
      </label>` : ""}
      ${pending ? `<p>${sbsI18n("swade-better-money.UI.permonth_6140225a53", {p0: (escape(pending.name)), p1: (escape(moneyText(Math.round(analyzeFormula(pending.formula).min * 1e6), currency)))})}</p>
        <p class="hint">${escape(pending.description)}</p>` : ""}
    </fieldset>
    <fieldset><legend>${sbsI18n("swade-better-money.UI.MonthlyCharges_4b674507b6")}</legend>
      ${actor.isOwner ? `<button type="button" data-upkeep="add">${sbsI18n("swade-better-money.UI.AddObligation_2acc43743d")}</button>` : ""}
      <ul class="money-list">${rows.map(row => `<li>
        <div class="money-grow"><strong>${escape(row.name)}</strong>: ${escape(currency?.symbol ?? "")}${escape(row.monthly)}
          <small>${sbsI18n("swade-better-money.UI.monthsdue_fc78add8e4", {p0: (row.count), p1: (escape(currency?.symbol ?? "")), p2: (escape(row.due))})}</small>
        </div>${actor.isOwner && row.kind === "obligation" ? `
          <button type="button" data-upkeep="edit" data-id="${escape(row.id)}" aria-label="${sbsI18nAttribute("swade-better-money.UI.Edit_58bd1ac6da", {p0: (escape(row.name))})}"><i class="fa-solid fa-pen"></i></button>
          <button type="button" data-upkeep="remove" data-id="${escape(row.id)}" aria-label="${sbsI18nAttribute("swade-better-money.UI.Remove_55fbe40120", {p0: (escape(row.name))})}"><i class="fa-solid fa-trash"></i></button>` : ""}
      </li>`).join("") || `<li class='hint'>${sbsI18n("swade-better-money.UI.Nomonthlycharges_30f9dc7f49")}</li>`}</ul>
      ${actor.isOwner ? `<div class="money-buttons">
        <button type="button" data-upkeep="pay">${sbsI18n("swade-better-money.UI.Payexpenses_a19b971655")}</button>
        ${game.user.isGM ? `<button type="button" data-upkeep="manage">${sbsI18n("swade-better-money.UI.Manageexpenses_22afd7dd25")}</button>` : ""}
      </div>` : ""}
    </fieldset>`;
  about.append(panel);
  const run = async callback => {
    try {await callback(); if (app.rendered) await app.render();}
    catch (error) {report(error);}
  };
  panel.querySelector("[data-upkeep-tier]")?.addEventListener("change", event => {
    if (event.target.value) void run(() => withWalletLock(() => configureLifestyle(actor, event.target.value)));
  });
  panel.addEventListener("click", event => {
    const button = event.target.closest("[data-upkeep]");
    if (!button || !actor.isOwner) return;
    switch (button.dataset.upkeep) {
      case "sync": void run(() => synchroniseUpkeep(actor)); break;
      case "pay": void run(() => payExpenses(actor)); break;
      case "manage": void run(() => manageExpenses(actor)); break;
      case "remove": void run(() => withWalletLock(() => removeObligation(actor, button.dataset.id))); break;
      case "add":
      case "edit": void run(async () => {
        const entry = upkeepState(actor).obligations.find(row => row.id === button.dataset.id);
        const data = await formDialog(entry ? sbsI18n("swade-better-money.UI.EditMonthlyObligation_43f76ea2ee") : sbsI18n("swade-better-money.UI.AddMonthlyObligation_20ad309600"), `
          <label class="money-field">${sbsI18n("swade-better-money.UI.Preset_7252e7ce00")} <select name="presetId">
            <option value="">${sbsI18n("swade-better-money.UI.Customobligation_9f6648904a")}</option>${selectOptions(obligations, entry?.presetId)}
          </select></label>
          <p data-obligation-preset-cost hidden></p>
          <div class="money-obligation-custom">
          <label class="money-field">${sbsI18n("swade-better-money.UI.Name_dcd1d5223f")} <input name="name" value="${escape(entry?.name)}" placeholder="${sbsI18nAttribute("swade-better-money.UI.Optionalforapreset_e961bb2762")}"></label>
          <label class="money-field">${sbsI18n("swade-better-money.UI.Custommonthlycost_c0a445edc8")} <input name="cost" type="number" min="0" step="0.000001" value="${entry?.cost ?? 0}"></label>
          ${textarea("Description", "description", entry?.description)}</div>`, entry ? sbsI18n("swade-better-money.UI.SaveObligation_41b1e748e4") : sbsI18n("swade-better-money.UI.AddObligation_2acc43743d"), (_event, dialog) => {
            const form = dialog.element.querySelector("form");
            const custom = form.querySelector(".money-obligation-custom");
            const cost = form.querySelector("[data-obligation-preset-cost]");
            const update = () => {
              const preset = obligations.find(row => row.id === form.elements.presetId.value);
              custom.hidden = Boolean(preset);
              custom.querySelectorAll("input, textarea").forEach(input => { input.disabled = Boolean(preset); });
              cost.hidden = !preset;
              cost.textContent = preset ? (currency?.symbol ?? "") + new Intl.NumberFormat(undefined, {maximumFractionDigits: 6})
                .format(analyzeFormula(preset.formula).min) : "";
            };
            form.elements.presetId.addEventListener("change", update);
            update();
          });
        if (data && data !== "cancel") await withWalletLock(() => saveObligation(actor, data, entry?.id));
      }); break;
    }
  });
}
