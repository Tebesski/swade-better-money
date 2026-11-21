import {t as sbsI18n, a as sbsI18nAttribute} from "./i18n.mjs";
import {getCatalog, MODULE_ID, summarizeWallet} from "./catalog.mjs";
import {formatAmount, safeUnits, SCALE, toUnits} from "./economy.mjs";
import {analyzeFormula, formulaUnits, rollMoneyFormula} from "./economy-formulas.mjs";
import {hustleLabel, immersiveEnabled, immersiveRules, OUTCOMES, ruleCurrency} from "./immersive-rules.mjs";
import {gameClockTime, gamePeriod, invoices} from "./upkeep.mjs";
import {
  actorOperation, commitOperations, creditIncome, executeTransaction, previewTransaction, withWalletLock
} from "./wallet.mjs";

export const dialogClasses = ["swade", "better-money", "immersive-dialog", "sbs-standard-swade-sheet"];
export const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
const hustleFlag = "hustleRecord";
const hustlePath = `flags.${MODULE_ID}.${hustleFlag}`;
const openHustles = new Set();

function requireCurrency() {
  const currency = ruleCurrency();
  if (!currency) throw new Error(sbsI18n("swade-better-money.UI.Chooseacurrencyorinstallthe_05f26e1fc8"));
  return currency;
}

export function moneyText(units, currency) {
  return `${currency?.symbol ?? ""}${formatAmount(units)} ${currency?.name ?? ""}`.trim();
}

export function selectOptions(entries, selected = "") {
  return entries.map(entry =>
    `<option value="${escape(entry.id)}"${entry.id === selected ? " selected" : ""}>${escape(entry.name)}</option>`).join("");
}

export function formDialog(title, content, label, render) {
  return foundry.applications.api.DialogV2.wait({
    classes: dialogClasses, position: {width: 575}, window: {title, resizable: true}, content, render,
    buttons: [{action: "save", label, default: true, callback: (_event, button) =>
      Object.fromEntries(new FormData(button.form))}, {action: "cancel", label: sbsI18n("swade-better-money.UI.Cancel_19766ed6cc"), type: "button"}]
  });
}

async function choiceDialog(title, content, buttons) {
  return foundry.applications.api.DialogV2.wait({
    classes: dialogClasses, position: {width: 545}, window: {title, resizable: true}, content,
    buttons: [...buttons, {action: "cancel", label: sbsI18n("swade-better-money.UI.Close_7d9eb7acb1"), type: "button"}]
  });
}

function listPieces(pieces) {
  return `<ul>${pieces.map(piece => `<li>${piece.count} × ${escape(piece.name)}</li>`).join("")}</ul>`;
}

async function spendBasket(purchases, fixed) {
  const results = await Promise.all(purchases.map(entry => rollMoneyFormula(entry.formula)));
  return {
    units: safeUnits(results.reduce((total, result) => total + result.units, fixed)),
    rolls: results.flatMap(result => result.roll ? [result.roll] : []),
    details: results.map((result, index) => `${purchases[index].name} · ${formatAmount(result.units)}`)
  };
}

export async function openSpending(actor, currencyId) {
  const currency = getCatalog().currencies.find(entry => entry.id === currencyId);
  if (!currency) throw new Error(sbsI18n("swade-better-money.UI.Chooseacurrencyfirst_77b051b3f5"));
  const useRules = currency.id === ruleCurrency()?.id;
  const balance = summarizeWallet(actor).find(entry => entry.currency.id === currencyId)?.units ?? 0;
  const purchases = useRules ? immersiveRules().purchases.map(entry => ({...entry, formulaInfo: analyzeFormula(entry.formula)})) : [];
  const due = useRules ? invoices(actor).filter(line => line.count) : [];
  const data = await formDialog(`Plan Spending · ${actor.name}`, `
    <div class="money-fields">
      <label class="money-field">${sbsI18n("swade-better-money.UI.Manualamount_5795c552fc", {p0: (escape(currency.name))})}<input type="number" min="0" step="0.000001" name="manual" value="0"></label>
    </div>
    ${useRules ? `<fieldset><legend>${sbsI18n("swade-better-money.UI.PurchaseTiers_181c4affb1")}</legend>${purchases.map(entry => `
      <label class="immersion-line">
        <span><strong>${escape(entry.name)}</strong> · ${escape(entry.formula)}
          <small>${escape(entry.description)}</small></span>
        <input name="buy-${escape(entry.id)}" aria-label="${sbsI18nAttribute("swade-better-money.UI.quantity_371ce37777", {p0: (escape(entry.name))})}" type="number" min="0" max="100" step="1" value="0"
          data-mean="${entry.formulaInfo.mean}" data-kind="tier" data-roll="${entry.formulaInfo.min !== entry.formulaInfo.max}">
      </label>`).join("")}</fieldset>` :
    `<p class='hint'>${sbsI18n("swade-better-money.UI.UsethecurrencyassignedtoImmersive_d322f61452")}</p>`}
    ${due.length ? `<fieldset><legend>${sbsI18n("swade-better-money.UI.UpkeepandMonthlyObligations_1eed297bf2")}</legend>${due.map(line => `
      <label class="immersion-line">
        <span><strong>${escape(line.name)}</strong> ${sbsI18n("swade-better-money.UI.months_adf6b0348d", {p0: (line.count), p1: (escape(moneyText(line.units, currency)))})}
          <small>${escape(line.description)}</small></span>
        <input type="checkbox" name="due-${escape(line.id)}" data-mean="${line.units / SCALE}" data-kind="bill">
      </label>`).join("")}</fieldset>` : ""}
    <div aria-live="polite">
      <p><strong>${sbsI18n("swade-better-money.UI.Total_c9b3c38247")}</strong> <output data-spend-total></output></p>
      <p><strong>${sbsI18n("swade-better-money.UI.Moneyleft_e496bc42b6")}</strong> <output data-spend-left></output></p>
    </div>`, sbsI18n("swade-better-money.UI.RollandReview_57a8b07027"), (_event, dialog) => {
    const form = dialog.element.querySelector("form");
    if (!form) return;
    const update = () => {
      let sum = Math.max(Number(form.elements.manual.value) || 0, 0) * SCALE;
      let rolling = false;
      for (const input of form.querySelectorAll("[data-mean]")) {
        const count = input.dataset.kind === "tier" ? Math.max(Number(input.value), 0) : Number(input.checked);
        const rolls = input.dataset.roll === "true";
        const units = Number(input.dataset.mean) * SCALE;
        sum += count * (rolls ? units : Math.round(units));
        rolling ||= count > 0 && rolls;
      }
      const total = Math.round(sum);
      const left = balance - total;
      const estimate = rolling ? "~" : "";
      const valid = Number.isSafeInteger(total);
      form.querySelector("[data-spend-total]").textContent = valid ? estimate + moneyText(total, currency) : sbsI18n("swade-better-money.UI.Amounttoolarge_d77353b3d0");
      form.querySelector("[data-spend-left]").textContent = valid
        ? estimate + (left < 0 ? "−" : "") + moneyText(Math.abs(left), currency) : "—";
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    update();
  });
  if (!data || data === "cancel") return false;

  const fixed = toUnits(data.manual || "0");
  const bills = due.filter(line => Object.hasOwn(data, `due-${line.id}`)).map(line => line.id);
  const countOf = entry => Number(data[`buy-${entry.id}`] || 0);
  const counts = purchases.map(countOf);
  if (counts.some(count => !Number.isInteger(count) || count < 0) || counts.reduce((sum, count) => sum + count, 0) > 100) {
    throw new Error(sbsI18n("swade-better-money.UI.Enterwholequantitiesforupto_ed61253a68"));
  }
  const basket = purchases.flatMap((entry, index) => Array(counts[index]).fill(entry));
  if (!basket.length && !fixed && !bills.length) throw new Error(sbsI18n("swade-better-money.UI.Enteranamountselectapurchase_83899efd43"));
  let best = await spendBasket(basket, fixed);
  let last = null;
  while (immersiveEnabled()) {
    const request = {action: "spend", currencyId, amount: String(best.units / SCALE), bills, allowZero: basket.length > 0};
    let plan, problem;
    try {
      plan = await previewTransaction(actor, request);
    } catch (error) {
      problem = error.message;
    }
    const rerollable = best.rolls.length && actor.bennies > 0;
    const selection = await choiceDialog(sbsI18n("swade-better-money.UI.ReviewSpending_d1857dc8fc"), `
      <p><strong>${sbsI18n("swade-better-money.UI.Total_8e9a71da61", {p0: (escape(moneyText(plan?.amount ?? safeUnits(best.units + due.filter(line => bills.includes(line.id))
        .reduce((sum, line) => sum + line.units, 0)), currency)))})}</strong></p>
      ${last ? `<p>${sbsI18n("swade-better-money.UI.RerollsubtotalThelowersubtotalis_fc7b5f92a4", {p0: (escape(moneyText(last.units, currency)))})}</p>` : ""}
      ${best.details.length ? `<ul>${best.details.map(detail => `<li>${escape(detail)}</li>`).join("")}</ul>` : ""}
      ${plan?.debit.length ? `<strong>${sbsI18n("swade-better-money.UI.Takenfromwallet_d553653a9c")}</strong>${listPieces(plan.debit)}` : ""}
      ${plan?.change.length ? `<strong>${sbsI18n("swade-better-money.UI.Changereturned_a78d5715dd")}</strong>${listPieces(plan.change)}` : ""}
      ${problem ? `<p class="hint">${escape(problem)}</p>` : ""}`, [
      ...(plan ? [{action: "pay", label: plan.amount ? sbsI18n("swade-better-money.UI.KeepandPay_43d1e3d4de") : sbsI18n("swade-better-money.UI.MarkPaid_d9f640dcc0"), default: true}] : []),
      ...(rerollable ? [{action: "reroll", label: sbsI18n("swade-better-money.UI.SpendBennietoReroll_67b0d80674")}] : [])
    ]);
    if (selection === "pay" && plan) {
      await executeTransaction(actor, request, plan.signature);
      if (best.rolls.length) await postMoneyRoll(actor, "Purchases", moneyText(plan.amount, currency), best.rolls);
      ui.notifications.info(sbsI18n("swade-better-money.UI.Spendingrecorded_5dcbc4f296"));
      return true;
    }
    if (selection !== "reroll" || !rerollable) return false;
    if (!await withWalletLock(() => actor.spendBenny())) continue;
    last = await spendBasket(basket, fixed);
    if (last.units < best.units) best = last;
  }
  return false;
}

async function postMoneyRoll(actor, title, description, rolls = []) {
  const message = {
    speaker: ChatMessage.getSpeaker({actor}),
    flavor: escape(title),
    content: `<p>${escape(description)}</p>`,
    rolls
  };
  try {
    await ChatMessage.implementation.create(message);
  } catch (error) {
    console.error("Better Money could not post the economy roll to chat.", error);
    ui.notifications.warn(sbsI18n("swade-better-money.UI.Theeconomyrollwasrecordedbut_059625dffc"));
  }
}

export function traitOutcome(roll) {
  if (roll.isCritfail || roll.successes < 0) return "critical";
  if (Number.isFinite(roll.successes)) return roll.successes >= 2 ? "raise" : roll.successes === 1 ? "success" : "failure";
  return roll.total >= 8 ? "raise" : roll.total >= 4 ? "success" : "failure";
}



function usedHustleWeek(actor) {
  const previous = actor.getFlag(MODULE_ID, hustleFlag);
  return previous && gamePeriod(previous.when).week >= gamePeriod().week;
}

async function completeHustle(actor, original, gmAward = false) {
  const currency = getCatalog().currencies.find(entry => entry.id === original.currencyId);
  if (!currency) throw new Error(sbsI18n("swade-better-money.UI.ThecurrencyforthispendingHustle_e91c9757d4"));
  let record = original;
  let last = null;
  while (immersiveEnabled()) {
    const selection = await rewardChoice(actor, record, currency, last, gmAward);
    if (!selection || selection === "cancel") return;
    if (selection === "keep") {
      await creditIncome(actor, record.currencyId, record.units, () => {
        const current = actor.getFlag(MODULE_ID, hustleFlag);
        if (current?.id !== record.id || current.claimed || current.units !== record.units) {
          throw new Error(sbsI18n("swade-better-money.UI.Thisrewardhaschangedorhas_464ab49366"));
        }
        return {[hustlePath]: {...record, claimed: true}};
      });
      await postMoneyRoll(actor, record.title, outcomeText(record, currency), restoreRoll(record.roll));
      return record;
    }
    if (selection === "reroll" || selection === "gmReroll") {
      const rolled = await withWalletLock(async () => {
        const current = actor.getFlag(MODULE_ID, hustleFlag);
        if (current?.id !== record.id || current.claimed) throw new Error(sbsI18n("swade-better-money.UI.Thisrewardhasalreadybeenclaimed_d5196f22bc"));
        if (selection === "reroll" && !await actor.spendBenny()) return null;
        const next = await rollMoneyFormula(record.formula);
        if (next.units > current.units) {
          const saved = {...current, units: next.units, roll: next.roll?.toJSON() ?? null};
          await actor.setFlag(MODULE_ID, hustleFlag, saved);
          record = saved;
        } else record = current;
        return next;
      });
      last = rolled?.units ?? null;
    }
  }
}

function restoreRoll(data) {
  return data ? [Roll.fromData(data)] : [];
}

function outcomeText(record, currency) {
  return [record.outcome && OUTCOMES[record.outcome], moneyText(record.units, currency), record.note].filter(Boolean).join(" · ");
}

function rewardChoice(actor, record, currency, last, gmAward = false) {
  const rollable = analyzeFormula(record.formula);
  return choiceDialog(`${record.title} · ${actor.name}`, `
    <p><strong>${escape(outcomeText(record, currency))}</strong></p>
    ${record.description ? `<p>${escape(record.description)}</p>` : ""}
    ${last != null ? `<p>${sbsI18n("swade-better-money.UI.RerollThehigherrewardiskept_42b9e92091", {p0: (escape(moneyText(last, currency)))})}</p>` : ""}`, [
    {action: "keep", default: true, label: record.units ? sbsI18n("swade-better-money.UI.KeepandCollect_7092cae223") : sbsI18n("swade-better-money.UI.Finish_a6c7a84baa")},
    ...(rollable.min === rollable.max ? [] : gmAward ? [{action: "gmReroll", label: sbsI18n("swade-better-money.UI.Reroll_18363dbee3")}]
      : actor.bennies > 0 ? [{action: "reroll", label: sbsI18n("swade-better-money.UI.SpendBennietoReroll_67b0d80674")}] : [])
  ]);
}

async function reserveHustle(actor, tier, outcome, currency, gmAward = false) {
  const result = tier.outcomes[outcome];
  if (!result) throw new Error(sbsI18n("swade-better-money.UI.Thehustleoutcomeismissingfrom_6b1e5cf64a"));
  const record = await withWalletLock(async () => {
    const current = actor.getFlag(MODULE_ID, hustleFlag);
    if (current && !current.claimed) throw new Error(sbsI18n("swade-better-money.UI.Claimthependingrewardbeforestarting_bff597047e"));
    if (usedHustleWeek(actor)) throw new Error(sbsI18n("swade-better-money.UI.Thisactoralreadyhustledthisin_038a8bbb88"));
    const {units, roll} = await rollMoneyFormula(result.formula);
    const record = {
      id: foundry.utils.randomID(), when: gameClockTime(), currencyId: currency.id, claimed: false,
      title: `${hustleLabel()} · ${tier.name}`, outcome, units, roll: roll?.toJSON() ?? null,
      description: tier.description, formula: result.formula, note: result.note
    };
    await commitOperations([actorOperation(actor, {[hustlePath]: record})]);
    return record;
  });
  await postMoneyRoll(actor, record.title, [OUTCOMES[outcome], record.note].filter(Boolean).join(" · "));
  return completeHustle(actor, record, gmAward);
}

export async function runHustle(actor, skill) {
  actor ??= canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!immersiveEnabled() || !actor?.isOwner || !["character", "npc"].includes(actor.type)) {
    throw new Error(sbsI18n("swade-better-money.UI.EnableImmersiveEconomyandselecta_8d665b59c5"));
  }
  if (openHustles.has(actor.uuid)) return;
  openHustles.add(actor.uuid);
  try {
    const previous = actor.getFlag(MODULE_ID, hustleFlag);
    if (previous && !previous.claimed) return await completeHustle(actor, previous);
    if (usedHustleWeek(actor)) throw new Error(sbsI18n("swade-better-money.UI.Thisactoralreadyhustledthisin_038a8bbb88"));
    const currency = requireCurrency();
    const {hustles} = immersiveRules();
    if (!hustles.length) throw new Error(sbsI18n("swade-better-money.UI.AddahustletierinImmersive_4e17640aef"));
    const skills = actor.items.filter(item => item.type === "skill" && !item.system.hidden);
    const skillId = skill?.id;
    if (!skillId && !skills.length) throw new Error(sbsI18n("swade-better-money.UI.Thisactorhasnoskillto_82f4d77500"));
    const needsDialog = !skillId || hustles.length > 1;
    const data = needsDialog ? await formDialog(`${hustleLabel()} · ${actor.name}`, `
      <label class="money-field">${sbsI18n("swade-better-money.UI.Hustletier_70c23c5378")} <select name="tier">${selectOptions(hustles)}</select></label>
      ${!skillId ? `<label class="money-field">${sbsI18n("swade-better-money.UI.Relevantskill_bc671b0a77")} <select name="skill">${selectOptions(skills)}</select></label>` : ""}
      <p class="hint">${sbsI18n("swade-better-money.UI.Acharactercanhustleonceper_a468187aa3")}</p>`, sbsI18n("swade-better-money.UI.RollSkill_7cfdcdd790")) : {tier: hustles[0].id};
    if (!data || data === "cancel") return;
    const tier = hustles.find(entry => entry.id === data.tier);
    const roll = await actor.rollSkill(skillId || data.skill, {title: hustleLabel(), flavour: hustleLabel()});
    if (!roll || !immersiveEnabled()) return;
    return await reserveHustle(actor, tier, traitOutcome(roll), currency);
  } finally {
    openHustles.delete(actor.uuid);
  }
}

async function awardGig(actor, tier, currency) {
  let result = await rollMoneyFormula(tier.formula);
  let last = null;
  while (immersiveEnabled()) {
    const record = {...tier, title: tier.name, units: result.units};
    const selection = await rewardChoice(actor, record, currency, last, true);
    if (selection === "keep") {
      await creditIncome(actor, currency.id, result.units);
      await postMoneyRoll(actor, tier.name, moneyText(result.units, currency), result.roll ? [result.roll] : []);
      return;
    }
    if (selection !== "gmReroll") return;
    const retry = await rollMoneyFormula(tier.formula);
    last = retry.units;
    if (retry.units > result.units) result = retry;
  }
}

export async function awardSelected() {
  if (!game.user.isGM || !immersiveEnabled()) throw new Error(sbsI18n("swade-better-money.UI.TheGMcanawardrewardswhen_3c731db051"));
  const actors = [...new Map((canvas?.tokens?.controlled ?? []).filter(token => ["character", "npc"].includes(token.actor?.type))
    .map(token => [token.actor.uuid, token.actor])).values()];
  if (!actors.length) throw new Error(sbsI18n("swade-better-money.UI.Selectoneormorecharacteror_037566ddd9"));
  const currency = requireCurrency();
  const {gigs, hustles} = immersiveRules();
  const table = [...gigs.map(entry => ({...entry, id: `gig:${entry.id}`})),
    ...hustles.map(entry => ({...entry, id: `hustle:${entry.id}`}))];
  if (!table.length) throw new Error(sbsI18n("swade-better-money.UI.Addagigorhustlein_5f22c1e542"));
  const data = await formDialog(sbsI18n("swade-better-money.UI.AwardGigsorHustles_da1bff6ae8"), `
    <p>${actors.map(actor => escape(actor.name)).join(", ")}</p>
    <label class="money-field">${sbsI18n("swade-better-money.UI.Rewardtier_e9bfacf6d7")} <select name="reward">${selectOptions(table)}</select></label>
    <label class="money-field">${sbsI18n("swade-better-money.UI.Hustleoutcome_65922b8922")} <select name="outcome">
      ${selectOptions(Object.entries(OUTCOMES).map(([id, name]) => ({id, name})), "success")}
    </select></label>`, sbsI18n("swade-better-money.UI.RollforEachActor_8b3695a51b"));
  if (!data || data === "cancel") return;
  const tier = table.find(entry => entry.id === data.reward);
  for (const actor of actors) {
    try {
      if (tier.outcomes) await reserveHustle(actor, tier, data.outcome, currency, true);
      else await awardGig(actor, tier, currency);
    } catch (error) {
      ui.notifications.error(`${actor.name}: ${error.message}`);
    }
  }
}

