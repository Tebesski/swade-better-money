import {t as sbsI18n} from "./i18n.mjs";
import {MODULE_ID} from "./catalog.mjs";
import {formatAmount, safeUnits, toUnits} from "./economy.mjs";
import {analyzeFormula, formulaUnits} from "./economy-formulas.mjs";
import {immersiveEnabled, immersiveRules, ruleCurrency} from "./immersive-rules.mjs";

export const UPKEEP_FLAG = "upkeep";
export const upkeepPath = `flags.${MODULE_ID}.${UPKEEP_FLAG}`;

function simpleCalendar() {
  const api = game.modules.get("foundryvtt-simple-calendar-reborn")?.active && globalThis.SimpleCalendar?.api;
  if (!api) return null;
  // The optional module may still be initializing its active calendar.
  try {
    const config = api.getCurrentCalendar();
    return config?.months?.length ? {api, config} : null;
  } catch {
    return null;
  }
}

export function gameClockTime(simple = simpleCalendar()) {
  if (simple?.config.general?.gameWorldTimeIntegration === "none") return simple.api.timestamp();
  return game.time.worldTime;
}

export function gamePeriod(time) {
  const simple = simpleCalendar();
  time ??= gameClockTime(simple);
  const calendar = game.time.calendar;
  const secondsPerDay = calendar.days.secondsPerMinute * calendar.days.minutesPerHour * calendar.days.hoursPerDay;
  const week = Math.floor((Math.floor(time / secondsPerDay) + calendar.years.firstWeekday) / calendar.days.values.length);
  if (simple) {
    const {config, api} = simple;
    const date = api.timestampToDate(time);
    if (Number.isInteger(date?.year) && Number.isInteger(date?.month)) {
      const {hoursInDay, minutesInHour, secondsInMinute} = config.time;
      const dayLength = hoursInDay * minutesInHour * secondsInMinute || secondsPerDay;
      return {
        month: date.year * config.months.length + date.month,
        week: Math.floor(time / dayLength) - (date.dayOfTheWeek >= 0 ? date.dayOfTheWeek : 0),
        label: `${config.months[date.month]?.name ?? date.month + 1} ${date.year}`
      };
    }
  }
  const {year, month} = calendar.timeToComponents(time);
  const name = calendar.months.values[month]?.name;
  return {
    month: year * calendar.months.values.length + month, week,
    label: `${name ? game.i18n.localize(name) : month + 1} ${year}`
  };
}

export function upkeepState(actor) {
  return foundry.utils.deepClone(actor.getFlag(MODULE_ID, UPKEEP_FLAG) ?? {obligations: []});
}

function monthsDue(line, period) {
  const from = gamePeriod(line.since).month;
  const through = line.paid == null ? from - 1 : gamePeriod(line.paid).month;
  return Math.max(0, period.month - Math.max(from - 1, through));
}

export function invoices(actor, state = upkeepState(actor)) {
  const period = gamePeriod();
  const rules = immersiveRules();
  const lifestyle = rules.lifestyles.find(entry => entry.id === state.lifestyle?.id);
  const rows = state.obligations.map(line => {
    const preset = rules.obligations.find(entry => entry.id === line.presetId);
    return {
      ...line, kind: "obligation", name: line.name || preset?.name,
      description: line.description || preset?.description, cost: line.monthlyCost ?? (preset ? analyzeFormula(preset.formula).min : line.cost)
    };
  });
  if (lifestyle) rows.unshift({
    ...state.lifestyle, id: "lifestyle", kind: "lifestyle", name: lifestyle.name,
    description: lifestyle.description, cost: state.lifestyle.monthlyCost ?? analyzeFormula(lifestyle.formula).min
  });
  return rows.map(line => {
    const count = line.dueMonths ?? monthsDue(line, period);
    const units = line.dueUnits ?? Math.max(0, safeUnits(formulaUnits(line.cost) * count) - (line.partialUnits ?? 0));
    return {...line, count, units, due: formatAmount(units), monthly: formatAmount(formulaUnits(line.cost))};
  });
}

export function prepareBilling(actor, ids, currencyId) {
  if (!ids?.length) return null;
  if (!immersiveEnabled() || !Array.isArray(ids) || currencyId !== ruleCurrency()?.id) {
    throw new Error(sbsI18n("swade-better-money.UI.Upkeepandobligationsusethecurrency_2144f6f8f1"));
  }
  const state = upkeepState(actor);
  const lines = invoices(actor, state).filter(line => line.count > 0 && ids.includes(line.id));
  if (new Set(ids).size !== lines.length) throw new Error(sbsI18n("swade-better-money.UI.ThebillschangedReviewthecurrent_7a4c2dfbec"));
  const date = gameClockTime();
  for (const line of lines) {
    if (line.kind === "lifestyle") {
      state.lifestyle.paid = date;
      state.activeLifestyle = {id: state.lifestyle.id, paid: date};
    } else state.obligations.find(entry => entry.id === line.id).paid = date;
    const entry = line.kind === "lifestyle" ? state.lifestyle : state.obligations.find(entry => entry.id === line.id);
    delete entry.partialUnits;
    entry.dueUnits = 0;
    entry.dueMonths = 0;
  }
  return {state, units: safeUnits(lines.reduce((sum, line) => sum + line.units, 0)),
    signature: [gamePeriod().month, JSON.stringify(actor.getFlag(MODULE_ID, UPKEEP_FLAG) ?? {}), lines.map(line => [line.id, line.count, line.units])]};
}

export function prepareExpenses(actor, selections) {
  if (!Array.isArray(selections) || !selections.length) throw new Error(sbsI18n("swade-better-money.UI.Selectatleastoneexpense_22ce43eaab"));
  const state = upkeepState(actor);
  const rows = invoices(actor, state);
  const seen = new Set();
  let units = 0;
  for (const selection of selections) {
    const row = rows.find(line => line.id === selection.id);
    if (!row || seen.has(row.id)) throw new Error(sbsI18n("swade-better-money.UI.TheexpenseschangedReviewthemagain_ea931c2965"));
    seen.add(row.id);
    const amount = selection.all ? row.units : toUnits(selection.amount);
    if (!amount || amount > row.units) throw new Error(sbsI18n("swade-better-money.UI.Enterapaymentwithintheamount_5855faba03"));
    const entry = row.kind === "lifestyle" ? state.lifestyle : state.obligations.find(line => line.id === row.id);
    if (amount === row.units) {
      entry.paid = gameClockTime();
      delete entry.partialUnits;
      if (row.kind === "lifestyle") state.activeLifestyle = {id: entry.id, paid: entry.paid};
    } else entry.partialUnits = safeUnits((entry.partialUnits ?? 0) + amount);
    entry.dueUnits = row.units - amount;
    entry.dueMonths = row.cost > 0 ? Math.ceil(entry.dueUnits / formulaUnits(row.cost)) : 0;
    units = safeUnits(units + amount);
  }
  return {state, units, signature: [gamePeriod().month,
    JSON.stringify(actor.getFlag(MODULE_ID, UPKEEP_FLAG) ?? {}), selections, units]};
}

export async function setExpenseDues(actor, changes, addMonth = false) {
  if (!game.user.isGM) throw new Error(sbsI18n("swade-better-money.UI.OnlyGMscanmanageexpensedues_dadf051ecf"));
  const state = upkeepState(actor);
  for (const row of invoices(actor, state)) {
    const change = changes?.find(entry => entry.id === row.id);
    if (!addMonth && !change) continue;
    const entry = row.kind === "lifestyle" ? state.lifestyle : state.obligations.find(line => line.id === row.id);
    const monthly = formulaUnits(row.cost);
    if (addMonth) {
      entry.dueUnits = safeUnits(row.units + Math.max(0, monthly - (entry.nextDiscountUnits ?? 0)));
      entry.dueMonths = row.count + 1;
      delete entry.nextDiscountUnits;
    } else {
      const months = Number(change.value);
      if (change.mode === "months" && (!Number.isSafeInteger(months) || months < 0)) throw new Error(sbsI18n("swade-better-money.UI.Enteranonnegativewholenumber_d6600aadad"));
      if (change.mode === "money" && String(change.value).trim().startsWith("-")) {
        entry.nextDiscountUnits = toUnits(String(change.value).trim().slice(1));
        entry.dueUnits = row.units;
        entry.dueMonths = row.count;
      } else {
        entry.dueUnits = change.mode === "months" ? safeUnits(monthly * months) : toUnits(change.value);
        entry.dueMonths = change.mode === "months" ? months : monthly ? Math.ceil(entry.dueUnits / monthly) : 0;
        delete entry.nextDiscountUnits;
      }
    }
    delete entry.partialUnits;
  }
  await actor.setFlag(MODULE_ID, UPKEEP_FLAG, state);
}

export async function configureLifestyle(actor, tierId) {
  const state = upkeepState(actor);
  if (!immersiveRules().lifestyles.some(entry => entry.id === tierId)) throw new Error(sbsI18n("swade-better-money.UI.Chooseanupkeeptier_fe628bb00a"));
  if (state.lifestyle?.id === tierId) return;
  state.lifestyle = {...state.lifestyle, id: tierId, since: state.lifestyle?.since ?? gameClockTime()};
  delete state.lifestyle.monthlyCost;
  await actor.setFlag(MODULE_ID, UPKEEP_FLAG, state);
}

export async function setExpenseMonthlyCost(actor, id, amount) {
  if (!actor.isOwner) throw new Error("You must own this character to edit its expenses.");
  const state = upkeepState(actor);
  const row = invoices(actor, state).find(line => line.id === id);
  if (!row) throw new Error("This expense is no longer available.");
  const entry = row.kind === "lifestyle" ? state.lifestyle : state.obligations.find(line => line.id === id);
  // Monthly rate changes apply to future charges. Preserve the current outstanding balance.
  entry.dueUnits = row.units;
  entry.dueMonths = row.count;
  delete entry.partialUnits;
  if (amount === "") delete entry.monthlyCost;
  else entry.monthlyCost = toUnits(amount) / 1_000_000;
  await actor.setFlag(MODULE_ID, UPKEEP_FLAG, state);
}

export async function saveObligation(actor, form, id) {
  const state = upkeepState(actor);
  const preset = immersiveRules().obligations.find(entry => entry.id === form.presetId);
  const name = String(form.name ?? "").trim();
  if (!preset && !name) throw new Error(sbsI18n("swade-better-money.UI.Enteranamefortheobligation_553583909a"));
  const cost = preset ? analyzeFormula(preset.formula).min : toUnits(form.cost) / 1_000_000;
  const previous = state.obligations.find(line => line.id === id);
  const entry = {
    ...previous, id: previous?.id ?? foundry.utils.randomID(), presetId: preset?.id ?? "", name: name || preset.name,
    description: String(form.description ?? "").trim() || preset?.description || "",
    cost, since: previous?.since ?? gameClockTime()
  };
  if (previous && previous.presetId !== entry.presetId) {
    delete entry.monthlyCost;
    delete previous.monthlyCost;
  }
  if (previous) Object.assign(previous, entry);
  else state.obligations.push(entry);
  await actor.setFlag(MODULE_ID, UPKEEP_FLAG, state);
}

export async function removeObligation(actor, id) {
  const state = upkeepState(actor);
  state.obligations = state.obligations.filter(line => line.id !== id);
  await actor.setFlag(MODULE_ID, UPKEEP_FLAG, state);
}

