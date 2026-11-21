import {t as sbsI18n} from "./i18n.mjs";
export const NAME_COLOURS = {
  Common: "#323232", Uncommon: "#98513d", Rare: "#002664", Unique: "#54166e"
};

export const BORDER_EFFECTS = {
  get none() { return sbsI18n("swade-better-money.UI.None_dc937b5989"); },
  get solid() { return sbsI18n("swade-better-money.UI.Solidoutline_2915504e61"); },
  get glow() { return sbsI18n("swade-better-money.UI.Staticglow_ed494eba19"); },
  get shimmer() { return sbsI18n("swade-better-money.UI.Shimmer_656b4440cd"); },
  get pulse() { return sbsI18n("swade-better-money.UI.Pulsingglow_9a08cfe54c"); },
  get hologram() { return sbsI18n("swade-better-money.UI.Hologram_ddff15a2da"); },
  get rainbow() { return sbsI18n("swade-better-money.UI.Rainbow_b1f7b2eed6"); },
  get bigElectro() { return sbsI18n("swade-better-money.UI.BigElectroBorder_ba1d5c9a2f"); },
  get neonGlass() { return sbsI18n("swade-better-money.UI.NeonGlassBorder_d47d81843e"); },
  get void() { return sbsI18n("swade-better-money.UI.VoidBorder_c7ad22857b"); },
  get toxic() { return sbsI18n("swade-better-money.UI.ToxicBorder_2da55081f8"); },
  get purpleElectro() { return sbsI18n("swade-better-money.UI.PurpleElectroBorder_c27bc2d2a0"); },
  get pulseBorder() { return sbsI18n("swade-better-money.UI.PulseBorder_714cfd5d46"); }
};

const BORDER_ART = {
  bigElectro: "bigElectro", neonGlass: "neonGlass", void: "void", toxic: "toxic", purpleElectro: "purpleElectro", pulseBorder: "pulse"
};

export const SHADOW_EFFECTS = {
  get none() { return sbsI18n("swade-better-money.UI.None_dc937b5989"); }, get sweetener() { return sbsI18n("swade-better-money.UI.Sweetener_99eb70285a"); }, get epic() { return sbsI18n("swade-better-money.UI.Epic_a93d389804"); }, get hologram() { return sbsI18n("swade-better-money.UI.Hologram_ddff15a2da"); },
  get rainbow() { return sbsI18n("swade-better-money.UI.Rainbow_b1f7b2eed6"); }, get fire() { return sbsI18n("swade-better-money.UI.Fire_c141faa80e"); }, get metallic() { return sbsI18n("swade-better-money.UI.Luxury_e07064d923"); }
};

function colour(value, fallback) {
  return /^#[\da-f]{6}$/i.test(value ?? "") ? value.toLowerCase() : fallback;
}

export function normalizeAppearance(options = {}) {
  return {
    useNameColour: options.useNameColour === true,
    nameColour: colour(options.nameColour, "#98513d"),
    border: Object.hasOwn(BORDER_EFFECTS, options.border) ? options.border : "none",
    borderColour: colour(options.borderColour, "#98513d"),
    inset: options.inset === true,
    shadow: Object.hasOwn(SHADOW_EFFECTS, options.shadow) ? options.shadow : "none",
    shadowColour: colour(options.shadowColour, "#000000"),
    glitch1: colour(options.glitch1, "#00ffff"),
    glitch2: colour(options.glitch2, "#ff00ff")
  };
}

export function borderArt(effect) {
  return Object.hasOwn(BORDER_ART, effect) ? BORDER_ART[effect] : null;
}

export function hasAppearance(style) {
  return style.useNameColour || style.border !== "none" || style.inset || style.shadow !== "none";
}
