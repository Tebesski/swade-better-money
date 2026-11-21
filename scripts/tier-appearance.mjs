import {t as sbsI18n} from "./i18n.mjs";
import {getDenominations, MODULE_ID, MONEY_TYPE} from "./catalog.mjs";
import {immersiveRules, purchaseTierId} from "./immersive-rules.mjs";
import {BORDER_EFFECTS, borderArt, hasAppearance, NAME_COLOURS, normalizeAppearance, SHADOW_EFFECTS} from "./tier-presets.mjs";

const KEY = "tierAppearance";
const {ApplicationV2, DialogV2, HandlebarsApplicationMixin} = foundry.applications.api;
const settings = () => game.settings.get(MODULE_ID, KEY);

function applyAppearance(style, {icon, name}) {
  if (name) {
    name.classList.toggle("bm-tier-coloured-name", style.useNameColour);
    name.dataset.bmShadow = style.shadow;
    name.style.setProperty("--bm-tier-name-colour", style.nameColour);
    name.style.setProperty("--bm-tier-shadow-colour", style.shadowColour);
    name.style.setProperty("--bm-tier-glitch-1", style.glitch1);
    name.style.setProperty("--bm-tier-glitch-2", style.glitch2);
  }
  if (!icon) return;
  let frame = icon.querySelector(":scope > .bm-tier-frame");
  const showFrame = style.border !== "none" || style.inset;
  icon.classList.toggle("bm-tier-icon", showFrame);
  if (!showFrame) {
    frame?.remove();
    return;
  }
  if (!frame) {
    frame = icon.ownerDocument.createElement("span");
    frame.className = "bm-tier-frame";
    frame.setAttribute("aria-hidden", "true");
    icon.append(frame);
  }
  frame.dataset.bmBorder = style.border;
  frame.classList.toggle("bm-tier-inset", style.inset);
  frame.style.setProperty("--bm-tier-border-colour", style.borderColour);
  frame.style.setProperty("--bm-tier-shadow-colour", style.shadowColour);
  const portrait = icon.querySelector(":scope.item-img-container > img.profile-img");
  if (portrait) queueMicrotask(() => {
    // Read the portrait after the other sheet render hooks have applied their theme.
    const portraitStyle = portrait.ownerDocument.defaultView.getComputedStyle(portrait);
    frame.style.insetBlockStart = portraitStyle.marginBlockStart;
    frame.style.insetBlockEnd = `calc(-1 * ${portraitStyle.marginBlockStart})`;
    frame.style.borderRadius = portraitStyle.borderRadius;
  });
  const art = borderArt(style.border);
  if (art) frame.style.setProperty("--bm-tier-border-art", `url("/modules/${MODULE_ID}/assets/tier-borders/${art}.webp")`);
  else frame.style.removeProperty("--bm-tier-border-art");
}

export function styleItemTier(item, parts) {
  if (item?.documentName !== "Item" || !(parts.icon || parts.name)) return;
  const config = settings();
  const money = item.type === MONEY_TYPE;
  const group = money ? config.money : config.purchase;
  if (!group || !Object.keys(group).length) return;
  const id = money ? item.system.tier : purchaseTierId(item);
  if (Object.hasOwn(group, id)) applyAppearance(normalizeAppearance(group[id]), parts);
}

export function renderSheetTier(app, root) {
  const document = app.document;
  if (document?.documentName === "Item") {
    styleItemTier(document, {
      name: root.querySelector(".item-name-container input, .denomination-sheet input[name='name']"),
      icon: root.querySelector(".item-img-container, .money-denomination-art")
    });
  } else if (document?.documentName === "Actor" && root.matches(".swade.sheet")) {
    for (const row of root.querySelectorAll("[data-item-id]")) {
      styleItemTier(document.items.get(row.dataset.itemId), {
        icon: row.querySelector(".item-img, .item-image"),
        name: row.querySelector(".item-name, a.name")
      });
    }
  }
}

function refreshDisplays() {
  if (!game.ready) return;
  for (const app of foundry.applications.instances.values()) {
    if (app.rendered && ["Actor", "Item"].includes(app.document?.documentName)) void app.render();
  }
  game.modules.get("swade-hud")?.api?.schedule?.();
}

function optionList(entries, selected) {
  return Object.entries(entries).map(([key, label]) => ({key, label, selected: key === selected}));
}

function writeColour(field, colour) {
  for (const input of field.querySelectorAll("input")) input.value = colour;
}

function listenForAppearanceChanges(root, onEdit) {
  const edit = event => {
    const input = event.target;
    const colourField = input.closest("[data-colour-field]");
    if (colourField) {
      const swatch = colourField.querySelector("input[type=color]");
      const colour = input.value.trim().match(/^#?([0-9a-f]{6})$/i)?.[1];
      if (!colour) {
        if (event.type === "change") input.value = swatch.value;
        return;
      }
      swatch.value = `#${colour.toLowerCase()}`;
      if (input === swatch || event.type === "change") writeColour(colourField, swatch.value);
      onEdit(input, colourField.dataset.colourField, swatch.value);
      return;
    }
    if (input.dataset.appearance) {
      onEdit(input, input.dataset.appearance, input.type === "checkbox" ? input.checked : input.value);
    }
  };
  root.addEventListener("input", edit);
  root.addEventListener("change", edit);
}

function renderCardPreview(card, style) {
  applyAppearance(style, {
    icon: card.querySelector(".bm-tier-preview-art"),
    name: card.querySelector(".bm-tier-preview-name")
  });
  const shadowButton = card.querySelector("[data-action='editShadow']");
  const shadow = SHADOW_EFFECTS[style.shadow];
  shadowButton.classList.toggle("active", style.shadow !== "none");
  shadowButton.title = sbsI18n("swade-better-money.UI.Textshadow_ed91e2d183", {p0: (shadow)});
}

async function editShadow(label, style) {
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/tier-shadow.hbs`, {
      label, shadows: optionList(SHADOW_EFFECTS, style.shadow),
      colours: [
        {key: "shadowColour", label: sbsI18n("swade-better-money.UI.Shadowcolour_667547515c")},
        {key: "glitch1", label: sbsI18n("swade-better-money.UI.Glitchcolour1_8ec803a4c7"), glitch: true},
        {key: "glitch2", label: sbsI18n("swade-better-money.UI.Glitchcolour2_a15e00fdf4"), glitch: true}
      ].map(colour => ({...colour, value: style[colour.key]}))
    }
  );
  let draft = {...style};
  return DialogV2.wait({
    modal: true,
    classes: ["swade", "better-money", "sbs-standard-swade-sheet", "bm-tier-shadow-dialog"],
    position: {width: 400},
    window: {title: sbsI18n("swade-better-money.UI.ShadowSettings_343c333d66", {p0: (label)})},
    content,
    render: (_event, dialog) => {
      const controls = dialog.element.querySelector(".bm-tier-shadow-settings");
      const preview = controls.querySelector(".bm-tier-shadow-preview");
      const update = () => {
        applyAppearance(draft, {name: preview});
        if (controls.dataset.effect !== draft.shadow) {
          controls.dataset.effect = draft.shadow;
          dialog.setPosition({height: "auto"});
        }
      };
      listenForAppearanceChanges(controls, (_input, key, value) => {
        if (draft[key] === value) return;
        draft[key] = value;
        update();
      });
      update();
    },
    buttons: [{
      action: "apply",
      label: sbsI18n("swade-better-money.UI.ApplyShadow_328203bb7c"),
      icon: "fa-solid fa-check",
      callback: () => ({shadow: draft.shadow, shadowColour: draft.shadowColour, glitch1: draft.glitch1, glitch2: draft.glitch2})
    }]
  });
}

class TierAppearanceWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "better-money-tier-appearance",
    classes: ["swade", "better-money", "sbs-standard-swade-sheet", "bm-tier-window"],
    window: {get title() { return sbsI18n("swade-better-money.UI.TierAppearance_c3467ea379"); }, icon: "fa-solid fa-gem", resizable: true},
    position: {width: 790, height: 655},
    actions: {
      async showCategory(_event, button) {
        if (this.saving || this.category === button.dataset.category) return;
        const form = this.element.querySelector(".bm-tier-editor");
        form.inert = true;
        this.category = button.dataset.category;
        try {
          await this.render();
          this.element.querySelector(".bm-tier-list").scrollTop = 0;
        } finally {
          form.inert = false;
        }
      },
      resetAppearance(_event, button) {
        const id = button.closest("[data-tier]").dataset.tier;
        this.setDraft(id, normalizeAppearance());
        return this.render();
      },
      async editShadow(_event, button) {
        const card = button.closest("[data-tier]");
        const {tier, label} = card.dataset;
        const category = this.category;
        const changes = await editShadow(label, this.styleFor(tier));
        if (!changes || !this.rendered) return;
        const style = normalizeAppearance({...this.styleFor(tier, category), ...changes});
        this.setDraft(tier, style, category);
        const visibleCard = [...this.element.querySelectorAll("[data-tier]")].find(row => row.dataset.tier === tier);
        if (this.category === category && visibleCard) renderCardPreview(visibleCard, style);
      }
    }
  };

  static PARTS = {body: {template: `modules/${MODULE_ID}/templates/tier-appearance.hbs`, scrollable: [".bm-tier-list"]}};
  category = "purchase";
  drafts = {purchase: new Map(), money: new Map()};
  saving = false;

  async tiers() {
    if (this.category === "purchase") return immersiveRules().purchases.map(({id, name}) => ({id, label: name}));
    const values = new Set([1, ...(await getDenominations()).map(entry => entry.tier), ...Object.keys(settings().money ?? {}).map(Number)]);
    for (const items of [game.items, ...game.actors.map(actor => actor.items)]) {
      for (const item of items) if (item.type === MONEY_TYPE) values.add(item.system.tier);
    }
    return [...values].sort((a, b) => a - b).map(value => ({id: String(value), label: sbsI18n("swade-better-money.UI.Tier_9716cbb307", {p0: (value)})}));
  }

  styleFor(id, category = this.category) {
    return this.drafts[category].get(id) ?? normalizeAppearance(settings()[category]?.[id]);
  }

  get hasChanges() {
    return this.drafts.purchase.size > 0 || this.drafts.money.size > 0;
  }

  setDraft(id, style, category = this.category) {
    const stored = normalizeAppearance(settings()[category]?.[id]);
    const drafts = this.drafts[category];
    if (foundry.utils.equals(style, stored)) drafts.delete(id);
    else drafts.set(id, style);
    this.element.querySelector("button[type=submit]").disabled = !this.hasChanges;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const tiers = await this.tiers();
    return {
      ...context, hasChanges: this.hasChanges,
      categories: optionList({purchase: sbsI18n("swade-better-money.UI.Itemtiers_48f3cf8bdb"), money: sbsI18n("swade-better-money.UI.Denominationtiers_9b9d363855")}, this.category),
      tiers: tiers.map(tier => {
        const style = this.styleFor(tier.id);
        return {
          ...tier, style,
          colours: Object.entries(NAME_COLOURS).map(([label, key]) => ({
            label, key, selected: style.useNameColour && key === style.nameColour
          })),
          borders: optionList({...BORDER_EFFECTS, none: sbsI18n("swade-better-money.UI.Noborder_5dedd0a882")}, style.border)
        };
      })
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const form = this.element.querySelector(".bm-tier-editor");
    for (const card of form.querySelectorAll("[data-tier]")) renderCardPreview(card, this.styleFor(card.dataset.tier));
    listenForAppearanceChanges(form, (input, key, value) => {
      const card = input.closest("[data-tier]");
      if (!card) return;
      const id = card.dataset.tier;
      let changes = {[key]: value};
      if (key === "preset") {
        if (!value) return;
        writeColour(card.querySelector("[data-colour-field='nameColour']"), value);
        changes = {nameColour: value};
      }
      if (key === "preset" || key === "nameColour") {
        card.querySelector("[data-appearance='useNameColour']").checked = true;
        changes.useNameColour = true;
      }
      const style = normalizeAppearance({...this.styleFor(id), ...changes});
      if ("useNameColour" in changes) {
        const preset = Object.values(NAME_COLOURS).find(colour => colour === style.nameColour);
        card.querySelector("[data-appearance='preset']").value = style.useNameColour ? (preset ?? "") : "";
      }
      this.setDraft(id, style);
      renderCardPreview(card, style);
    });
    form.onsubmit = event => {
      event.preventDefault();
      void this.saveAppearance();
    };
  }

  async saveAppearance() {
    if (!game.user.isGM || this.saving || !this.hasChanges) return;
    this.saving = true;
    const form = this.element.querySelector(".bm-tier-editor");
    form.inert = true;
    try {
      const current = foundry.utils.deepClone(settings());
      for (const [group, drafts] of Object.entries(this.drafts)) {
        for (const [id, style] of drafts) {
          if (hasAppearance(style)) (current[group] ??= {})[id] = style;
          else if (current[group]) delete current[group][id];
        }
      }
      await game.settings.set(MODULE_ID, KEY, current);
      for (const drafts of Object.values(this.drafts)) drafts.clear();
      await this.render();
    } catch (error) {
      ui.notifications.error(error.message);
    } finally {
      form.inert = false;
      this.saving = false;
    }
  }
}

export function registerTierAppearance() {
  game.settings.register(MODULE_ID, KEY, {
    scope: "world", config: false, type: Object, default: {purchase: {}, money: {}}, onChange: refreshDisplays
  });
  game.settings.registerMenu(MODULE_ID, "tierAppearanceMenu", {
    name: sbsI18n("swade-better-money.UI.TierAppearance_c3467ea379"), label: sbsI18n("swade-better-money.UI.ConfigureTierAppearance_d4fb6127b8"),
    icon: "fa-solid fa-gem", type: TierAppearanceWindow, restricted: true
  });
}
