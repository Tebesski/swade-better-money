import assert from "node:assert/strict";
import test from "node:test";
import {BORDER_EFFECTS, hasAppearance, NAME_COLOURS, normalizeAppearance, SHADOW_EFFECTS} from "../scripts/tier-presets.mjs";

test("tier appearances start neutral and preserve independent name, border, and shadow colours", () => {
  assert.equal(hasAppearance(normalizeAppearance()), false);
  const style = normalizeAppearance({
    useNameColour: true, nameColour: NAME_COLOURS.Rare, border: "glow", borderColour: "#E5354A",
    shadow: "sweetener", shadowColour: "#DDDDDD"
  });
  assert.equal(style.nameColour, "#002664");
  assert.equal(style.borderColour, "#e5354a");
  assert.equal(style.shadowColour, "#dddddd");
  assert.equal(hasAppearance(style), true);
});

test("CSS border and shadow effects remain supported", () => {
  assert.deepEqual(Object.keys(BORDER_EFFECTS),
    ["none", "solid", "glow", "shimmer", "pulse", "hologram", "rainbow"]);
  for (const border of Object.keys(BORDER_EFFECTS)) {
    assert.equal(normalizeAppearance({border}).border, border);
  }
  for (const shadow of ["sweetener", "epic", "hologram", "rainbow", "fire", "metallic"]) {
    assert.ok(Object.hasOwn(SHADOW_EFFECTS, shadow));
    assert.equal(normalizeAppearance({shadow}).shadow, shadow);
  }
});

test("removed image presets safely fall back without changing other appearance options", () => {
  for (const border of ["bigElectro", "neonGlass", "void", "toxic", "purpleElectro", "pulseBorder"]) {
    assert.equal(Object.hasOwn(BORDER_EFFECTS, border), false);
    const saved = {border, borderColour: "#123456", useNameColour: true, nameColour: "#abcdef",
      shadow: "sweetener", shadowColour: "#654321", inset: true};
    const style = normalizeAppearance(saved);
    assert.deepEqual(style, normalizeAppearance({...saved, border: "solid"}));
    assert.equal(hasAppearance(style), true);
    assert.equal(saved.border, border);
  }
  assert.equal(normalizeAppearance({border: "unknown"}).border, "none");
});
