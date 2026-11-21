import {t as sbsI18n} from "./i18n.mjs";
import {MODULE_ID} from "./catalog.mjs";
import {formatAmount} from "./economy.mjs";
import {invoices} from "./upkeep.mjs";
import {ruleCurrency} from "./immersive-rules.mjs";
import {dialogClasses, escape} from "./immersive-actions.mjs";

const CALENDAR = "foundryvtt-simple-calendar-reborn";

export async function synchroniseUpkeep(actor) {
  if (!game.user.isGM) return;
  const api = game.modules.get(CALENDAR)?.active && globalThis.SimpleCalendar?.api;
  if (!api) throw new Error(sbsI18n("swade-better-money.UI.EnableSimpleCalendarReborntosynchronise_aea0df312a"));
  const previous = game.journal.get(actor.getFlag(MODULE_ID, "upkeepCalendarNote"));
  const selectorId = "bm-upkeep-date-" + foundry.utils.randomID();
  let date = api.currentDateTime();
  const selector = api.DateSelector.Get(selectorId, {
    selectedStartDate: date, showTimeSelector: false, allowDateRangeSelection: false, editYear: true,
    onDateSelect: selection => { date = {...date, ...selection.startDate}; }
  });
  let choice;
  try {
  choice = await foundry.applications.api.DialogV2.wait({
    classes: [...dialogClasses, "bm-upkeep-calendar"], position: {width: 600},
    window: {title: sbsI18n("swade-better-money.UI.Synchronisewiththecalendar_3c5a649d8f"), resizable: true},
    content: `<p>${sbsI18n("swade-better-money.UI.Chooseadateforthemonthly_06d699114d")}</p><div class="simple-calendar">${selector.build(false)}</div>`,
    render: () => api.DateSelector.Activate(selectorId),
    buttons: [
      {action: "sync", label: previous ? sbsI18n("swade-better-money.UI.ReSynchronise_1000a448c0") : sbsI18n("swade-better-money.UI.Synchronise_7c59dd01d1")},
      {action: "current", label: sbsI18n("swade-better-money.UI.Usecurrentdate_527ffe10db")},
      ...(previous ? [{action: "remove", label: sbsI18n("swade-better-money.UI.DeSynchronise_e6df3dadae")}] : []),
      {action: "cancel", label: sbsI18n("swade-better-money.UI.Cancel_19766ed6cc")}
    ]
  });
  } finally { api.DateSelector.Remove(selectorId); }
  if (!["sync", "current", "remove"].includes(choice)) return;
  if (choice === "current") date = api.currentDateTime();
  if (previous) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({classes: dialogClasses,
      window: {title: choice === "remove" ? sbsI18n("swade-better-money.UI.DeSynchronise_e6df3dadae") : sbsI18n("swade-better-money.UI.ReSynchronise_1000a448c0")},
      content: choice === "remove" ? `<p>${sbsI18n("swade-better-money.UI.Deletethemonthlyupkeepcalendarreminder_b8b073fdab")}</p>` : `<p>${sbsI18n("swade-better-money.UI.Replacethemonthlyupkeepreminderwith_7eb01f32c8")}</p>`});
    if (!confirmed) return;
  }
  if (choice === "remove") {
    await previous.delete();
    await actor.unsetFlag(MODULE_ID, "upkeepCalendarNote");
    return;
  }
  const config = api.getCurrentCalendar();
  const categories = config.noteCategories ?? [];
  let category = categories.find(entry => entry.name.toLowerCase() === "lifestyle");
  if (!category) {
    category = {id: foundry.utils.randomID(), name: sbsI18n("swade-better-money.UI.Lifestyle_2e6c28eb66"), color: "#4f9f77", textColor: "#ffffff"};
    if (!await api.configureCalendar({noteCategories: [...categories, category]}, config.id)) throw new Error(sbsI18n("swade-better-money.UI.CouldnotcreatetheLifestylecategory_1dcca92ec1"));
  }
  const viewers = game.users.filter(user => user.isGM || actor.testUserPermission(user, "OWNER", {exact: true})).map(user => user.id);
  const currency = ruleCurrency();
  let macro = game.macros.find(entry => entry.getFlag(MODULE_ID, "refreshMonthlyDue") === actor.uuid);
  if (!macro) macro = await Macro.create({name: "Refresh monthly due: " + actor.name, type: "script", img: "icons/svg/coins.svg",
    command: `await game.modules.get("${MODULE_ID}").api.refreshMonthlyDue(${JSON.stringify(actor.uuid)});`,
    ownership: {default: 0}, flags: {[MODULE_ID]: {refreshMonthlyDue: actor.uuid}}});
  const text = `<p>${sbsI18n("swade-better-money.UI.MonthlyUpkeep_b0e8def75c")}</p><ul>${invoices(actor).map(row => `<li>${escape(row.name)} — ${escape(currency?.symbol ?? "")}${formatAmount(Math.round(row.cost * 1_000_000))}</li>`).join("")}</ul>
    <p>${sbsI18n("swade-better-money.UI.UUID_3163f43e64", {p0: (macro.uuid)})}</p>`;
  const note = await api.addNote("Monthly Upkeep: " + actor.name, text, date, date, true, api.NoteRepeat?.Monthly ?? 2,
    [category.id], config.id, null, viewers, viewers);
  if (!note) throw new Error(sbsI18n("swade-better-money.UI.Thecalendarcouldnotcreatethe_e71b79e0c6"));
  try {
    await note.update({ownership: {default: 0, ...Object.fromEntries(viewers.map(id => [id, game.users.get(id).isGM ? 3 : 2]))}});
    await actor.setFlag(MODULE_ID, "upkeepCalendarNote", note.id);
  } catch (error) {
    await note.delete();
    throw error;
  }
  if (previous) await previous.delete();
}
