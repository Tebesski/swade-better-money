import assert from "node:assert/strict";
import test from "node:test";
import {BORDER_EFFECTS, borderArt, hasAppearance, NAME_COLOURS, normalizeAppearance, SHADOW_EFFECTS} from "../scripts/tier-presets.mjs";

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

test("all Precious border and shadow effects are supported", () => {
  assert.deepEqual(Object.keys(BORDER_EFFECTS).filter(borderArt).map(borderArt),
    ["bigElectro", "neonGlass", "void", "toxic", "purpleElectro", "pulse"]);
  for (const shadow of ["sweetener", "epic", "hologram", "rainbow", "fire", "metallic"]) {
    assert.ok(Object.hasOwn(SHADOW_EFFECTS, shadow));
    assert.equal(normalizeAppearance({shadow}).shadow, shadow);
  }
});
