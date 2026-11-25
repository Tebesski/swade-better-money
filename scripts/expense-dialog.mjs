import {t as sbsI18n, a as sbsI18nAttribute} from "./i18n.mjs";
import {getHoldings} from "./catalog.mjs";
import {formatAmount, safeUnits, toUnits} from "./economy.mjs";
import {invoices, setExpenseDues, setExpenseMonthlyCost} from "./upkeep.mjs";
import {ruleCurrency} from "./immersive-rules.mjs";
import {dialogClasses, escape, formDialog, selectOptions} from "./immersive-actions.mjs";
import {executeTransaction, expenseWallets, previewTransaction, withWalletLock} from "./wallet.mjs";

export async function editMonthlyCost(actor, id) {
  if (!actor.isOwner) return;
  const row = invoices(actor).find(line => line.id === id);
  if (!row) throw new Error("This expense is no longer available.");
  const currency = ruleCurrency();
  const data = await formDialog("Monthly cost · " + row.name,
    `<label class="money-field">Monthly cost (${escape(currency?.symbol ?? "")})
      <input name="amount" type="number" min="0" step="0.000001" value="${row.cost}"></label>
      <p>This price applies to ${escape(actor.name)}. Leave it blank to use the preset or original obligation price. Existing dues can be edited separately in Manage expenses.</p>`, "Save");
  if (!data || data === "cancel") return;
  await withWalletLock(() => setExpenseMonthlyCost(actor, id, data.amount));
}

export async function manageExpenses(actor) {
  if (!game.user.isGM) return;
  const rows = invoices(actor);
  const data = await formDialog(sbsI18n("swade-better-money.UI.Manageexpenses_22afd7dd25"), rows.map((row, index) => `<fieldset><legend>${escape(row.name)}</legend>
    <div class="money-fields"><label class="money-field">${sbsI18n("swade-better-money.UI.Setdueas_0507267618")}<select name="mode-${index}"><option value="money">${sbsI18n("swade-better-money.UI.Money_10ba39cef3", {p0: (escape(ruleCurrency()?.symbol ?? ""))})}</option><option value="months">${sbsI18n("swade-better-money.UI.Months_09ca7551b3")}</option></select></label>
    <label class="money-field">${sbsI18n("swade-better-money.UI.Amount_49e96d7cdf")}<input name="value-${index}" type="number" step="0.000001" value="${row.nextDiscountUnits ? -row.nextDiscountUnits / 1_000_000 : row.units / 1_000_000}" required></label></div>
    <small>Enter a negative money amount to reduce this expense’s next monthly charge once. Its current balance stays the same.</small></fieldset>`).join(""), "Save", (_event, dialog) => {
      const form = dialog.element.querySelector("form");
      rows.forEach((row, index) => form.elements[`mode-${index}`].addEventListener("change", event => {
        const input = form.elements[`value-${index}`];
        input.step = event.target.value === "months" ? "1" : "0.000001";
        if (event.target.value === "months") input.min = "0";
        else input.removeAttribute("min");
        input.value = event.target.value === "months" ? row.count : row.nextDiscountUnits ? -row.nextDiscountUnits / 1_000_000 : row.units / 1_000_000;
      }));
    });
  if (!data || data === "cancel") return;
  await withWalletLock(() => setExpenseDues(actor, rows.map((row, index) => ({id: row.id, mode: data[`mode-${index}`], value: data[`value-${index}`]}))));
}

export async function refreshMonthlyDue(actorUuid) {
  if (!game.user.isGM) return ui.notifications.warn(sbsI18n("swade-better-money.UI.OnlyGMscanrefreshmonthlydues_d5f8e09998"));
  const actors = game.actors.filter(actor => actor.type === "character");
  const data = await formDialog(sbsI18n("swade-better-money.UI.Refreshmonthlydue_e25091a781"), `<label class="money-field">${sbsI18n("swade-better-money.UI.Character_1405a63e8a")}<select name="actor">${selectOptions(actors.map(actor => ({id: actor.uuid, name: actor.name})), actorUuid)}</select></label>
    <p>${sbsI18n("swade-better-money.UI.Addonemonthofeachcurrent_da9b25a8c0")}</p>`, sbsI18n("swade-better-money.UI.Addmonthlydues_2c391646e5"));
  if (!data || data === "cancel") return;
  const actor = await fromUuid(data.actor);
  if (actor?.type !== "character") throw new Error(sbsI18n("swade-better-money.UI.Chooseacharacter_3e723474fa"));
  await withWalletLock(() => setExpenseDues(actor, null, true));
  ui.notifications.info("Monthly dues refreshed for " + actor.name + ".");
}

export async function payExpenses(actor) {
  const currency = ruleCurrency();
  if (!currency) throw new Error(sbsI18n("swade-better-money.UI.Chooseanupkeepcurrencyfirst_427985bfa4"));
  const rows = invoices(actor).filter(row => row.units > 0);
  if (!rows.length) return ui.notifications.info(sbsI18n("swade-better-money.UI.Noexpensesaredue_2bd88297b4"));
  const money = units => escape(currency.symbol ?? "") + formatAmount(units);
  const balance = expenseWallets(actor).flatMap(source => getHoldings(source))
    .filter(piece => piece.currencyId === currency.id).reduce((sum, piece) => safeUnits(sum + piece.value * piece.count), 0);
  await foundry.applications.api.DialogV2.wait({
    classes: dialogClasses, window: {title: sbsI18n("swade-better-money.UI.Payexpenses_a19b971655"), resizable: true}, position: {width: 600},
    content: `<p>${sbsI18n("swade-better-money.UI.Availablemoney_681df7357a", {p0: (money(balance))})}</p>${rows.map((row, index) => `<fieldset data-expense="${index}"><legend>${escape(row.name)} · ${money(row.units)}</legend>
      <div class="money-buttons"><label><input type="checkbox" name="all-${index}"> ${sbsI18n("swade-better-money.UI.Payall_44a679f2f9")}</label>
      <label><input type="checkbox" name="partial-${index}"> ${sbsI18n("swade-better-money.UI.Paypartially_526de4586f")}</label>
      <input aria-label="${sbsI18nAttribute("swade-better-money.UI.Partialpaymentfor_70a6aa2565", {p0: (escape(row.name))})}" name="amount-${index}" type="number" min="0.000001" max="${row.units / 1_000_000}" step="0.000001" hidden></div></fieldset>`).join("")}
      <p>${sbsI18n("swade-better-money.UI.Total_c9b3c38247")} <output data-expense-total>${money(0)}</output></p><p data-expense-error role="alert"></p>`,
    render: (_event, dialog) => {
      const form = dialog.element.querySelector("form");
      const button = form.querySelector('[data-action="pay"]');
      const update = event => {
        const field = event?.target;
        if (field?.name.startsWith("all-") && field.checked) form.elements["partial-" + field.name.slice(4)].checked = false;
        if (field?.name.startsWith("partial-") && field.checked) form.elements["all-" + field.name.slice(8)].checked = false;
        let total = 0, valid = true, selected = false;
        rows.forEach((row, index) => {
          const all = form.elements[`all-${index}`].checked;
          const partial = form.elements[`partial-${index}`].checked;
          const input = form.elements[`amount-${index}`];
          input.hidden = !partial;
          input.disabled = !partial;
          if (!all && !partial) return;
          selected = true;
          try {
            const amount = all ? row.units : toUnits(input.value);
            if (!amount || amount > row.units) valid = false;
            total = safeUnits(total + amount);
          } catch { valid = false; }
        });
        form.querySelector("[data-expense-total]").textContent = (currency.symbol ?? "") + formatAmount(total);
        form.querySelector("[data-expense-error]").textContent = total > balance ? sbsI18n("swade-better-money.UI.Notenoughmoney_19f27030a2") : "";
        button.disabled = !selected || !valid || total > balance;
      };
      form.addEventListener("input", update);
      update();
    },
    buttons: [{action: "pay", label: sbsI18n("swade-better-money.UI.Pay_723afa394d"), callback: async (_event, button) => {
      const form = button.form;
      const expenses = rows.flatMap((row, index) => {
        const all = form.elements[`all-${index}`].checked;
        return all || form.elements[`partial-${index}`].checked
          ? [{id: row.id, all, amount: form.elements[`amount-${index}`].value}] : [];
      });
      const request = {action: "expenses", currencyId: currency.id, expenses};
      const plan = await previewTransaction(actor, request);
      await executeTransaction(actor, request, plan.signature);
    }}, {action: "cancel", label: sbsI18n("swade-better-money.UI.Cancel_19766ed6cc")}]
  });
}
