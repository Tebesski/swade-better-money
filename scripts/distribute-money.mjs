import {getCatalog, MODULE_ID} from "./catalog.mjs";
import {formatAmount, safeUnits, toUnits} from "./economy.mjs";
import {immersiveRules, OUTCOMES} from "./immersive-rules.mjs";
import {dialogClasses, escape, selectOptions} from "./immersive-actions.mjs";
import {creditRandomMoney} from "./wallet.mjs";

let open = false;

function rewardFormulaPresets() {
  const rules = immersiveRules();
  return [
    ...rules.gigs.map(entry => ({id: "gig-" + entry.id, name: `${entry.name}: ${entry.formula}`, formula: entry.formula})),
    ...rules.hustles.flatMap(entry => ["failure", "success", "raise"].map(outcome => ({
      id: `hustle-${entry.id}-${outcome}`, name: `${entry.name} (${OUTCOMES[outcome]}): ${entry.outcomes[outcome].formula}`,
      formula: entry.outcomes[outcome].formula
    })))
  ];
}

export async function rollMoney() {
  if (!game.user.isGM) return;
  const presets = rewardFormulaPresets();
  let result;
  return foundry.applications.api.DialogV2.wait({
    classes: dialogClasses, window: {title: "Roll Money", resizable: true}, position: {width: 575},
    content: `<label class="money-field">Reward preset<select name="preset"><option value="">Manual amount or formula</option>${selectOptions(presets)}</select></label>
      <label class="money-field">Formula<input name="formula" value="1000" placeholder="(2d4x+100)*10" required></label>
      <button type="button" data-roll-money><i class="fa-solid fa-dice" aria-hidden="true"></i> Roll</button>
      <div class="bm-money-roll-result" hidden><output aria-live="polite"></output>
        <a role="button" tabindex="0" data-post-money-roll aria-label="Send result to chat" title="Send result to chat"><i class="fa-solid fa-comment" aria-hidden="true"></i></a>
      </div><p data-roll-money-error role="alert"></p>`,
    render: (_event, dialog) => {
      const form = dialog.element.querySelector("form");
      const rollButton = form.querySelector("[data-roll-money]");
      const resultRow = form.querySelector(".bm-money-roll-result");
      const share = form.querySelector("[data-post-money-roll]");
      const error = form.querySelector("[data-roll-money-error]");
      let busy = false;
      const work = async callback => {
        if (busy) return;
        busy = rollButton.disabled = true;
        share.setAttribute("aria-disabled", "true");
        error.textContent = "";
        try { await callback(); }
        catch (failure) { error.textContent = failure.message; }
        finally {
          busy = rollButton.disabled = false;
          share.setAttribute("aria-disabled", "false");
        }
      };
      form.elements.preset.addEventListener("change", () => {
        const preset = presets.find(entry => entry.id === form.elements.preset.value);
        if (preset) form.elements.formula.value = preset.formula;
      });
      rollButton.addEventListener("click", () => work(async () => {
        const formula = form.elements.formula.value.trim().replaceAll("×", "*");
        if (!Roll.validate(formula)) throw new Error("Enter a valid Foundry dice formula or amount.");
        const roll = await new Roll(formula).evaluate();
        if (!Number.isFinite(roll.total) || roll.total < 0) throw new Error("The total must be a finite, non-negative amount.");
        result = roll;
        resultRow.querySelector("output").textContent = `${roll.formula} = ${roll.total}`;
        resultRow.hidden = false;
      }));
      share.addEventListener("click", event => {
        event.preventDefault();
        if (result) void work(() => result.toMessage({flavor: "Roll Money"}));
      });
      share.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (!event.repeat) share.click();
      });
    },
    buttons: [{action: "close", label: "Close", default: true}]
  });
}

export async function distributeMoney() {
  if (!game.user.isGM) return ui.notifications.warn("Only GMs can generate money for selected tokens.");
  if (open) return;
  const actors = [...new Map((canvas?.tokens?.controlled ?? []).filter(token => token.actor)
    .map(token => [token.actor.uuid, token.actor])).values()];
  if (!actors.length) return ui.notifications.warn("Select the recipient tokens first.");
  const catalog = getCatalog();
  if (!catalog.currencies.length) return ui.notifications.warn("Create a currency and its denominations first.");
  const rules = immersiveRules();
  const presets = rewardFormulaPresets();
  open = true;
  try {
    await foundry.applications.api.DialogV2.wait({
      classes: dialogClasses, window: {title: "Distribute Money", resizable: true}, position: {width: 600},
      content: `<p>Recipients: ${actors.map(actor => escape(actor.name)).join(", ")}</p>
        <label class="money-field">Currency<select name="currency">${selectOptions(catalog.currencies, rules.currencyId || catalog.primary)}</select></label>
        <label class="money-field">Reward preset<select name="preset"><option value="">Manual amount or formula</option>${selectOptions(presets)}</select></label>
        <label class="money-field">Shared total · amount or formula<input name="formula" type="text" value="1000" placeholder="(2d4x+100)*10" required></label>
        <p role="alert" data-distribution-error></p>`,
      render: (_event, dialog) => {
        const form = dialog.element.querySelector("form");
        form.elements.preset.addEventListener("change", () => {
          const preset = presets.find(entry => entry.id === form.elements.preset.value);
          if (preset) form.elements.formula.value = preset.formula;
        });
      },
      buttons: [{action: "generate", label: "Generate and distribute", default: true, callback: async (_event, button) => {
        const form = button.form;
        const submit = form.querySelector('[data-action="generate"]');
        const error = form.querySelector("[data-distribution-error]");
        submit.disabled = true;
        let committed = false;
        try {
          if (actors.some(actor => !actor.isOwner)) throw new Error("You must own all recipient actors.");
          const currency = getCatalog().currencies.find(entry => entry.id === form.elements.currency.value);
          if (!currency) throw new Error("Choose an available currency.");
          const formula = form.elements.formula.value.trim().replaceAll("×", "*");
          if (!Roll.validate(formula)) throw new Error("Enter a valid Foundry dice formula or amount.");
          const roll = await new Roll(formula).evaluate();
          const total = roll.total;
          if (!Number.isFinite(total) || total < 0) throw new Error("The total must be a finite, non-negative amount.");
          const amount = toUnits(total.toFixed(6));
          const payouts = await creditRandomMoney(actors, currency.id, amount);
          committed = true;
          const money = units => escape(currency.symbol ?? "") + formatAmount(units);
          try {
            await roll.toMessage({flavor: "Distributed money", content: `<p>Shared total <strong>${money(amount)}</strong></p><ul>${actors.map((actor, index) => {
              const subtotal = payouts[index].reduce((sum, piece) => safeUnits(sum + piece.value * piece.count), 0);
              return `<li>${escape(actor.name)} · ${money(subtotal)}${payouts[index].length ? `<ul>${payouts[index].map(piece => `<li>${piece.count} × ${escape(piece.name)}</li>`).join("")}</ul>` : ""}</li>`;
            }).join("")}</ul>`});
          } catch (chatError) {
            ui.notifications.warn("Money was distributed, but the chat summary could not be posted.");
            console.error(chatError);
          }
          return amount;
        } catch (failure) {
          error.textContent = failure.message;
          form.querySelectorAll("button[data-action]").forEach(control => { control.disabled = false; });
          // Keep the dialog open so a corrected formula or currency can be used.
          throw failure;
        } finally {
          if (committed) submit.disabled = true;
        }
      }}, {action: "cancel", label: "Cancel"}]
    });
  } finally { open = false; }
}

export async function installDistributionMacro() {
  if (game.users.activeGM?.id !== game.user.id) return;
  const command = `await game.modules.get("${MODULE_ID}").api.distributeMoney();`;
  const existing = game.macros.find(macro => macro.getFlag(MODULE_ID, "distributeMoneyMacro"));
  if (existing) {
    if (existing.command !== command) await existing.update({command});
    return;
  }
  await Macro.implementation.create({
    name: "Better Money · Distribute Money", type: "script", img: "icons/svg/coins.svg", command,
    ownership: {default: 0}, flags: {[MODULE_ID]: {distributeMoneyMacro: true}}
  });
}
