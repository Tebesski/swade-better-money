import {t as sbsI18n, a as sbsI18nAttribute} from "./i18n.mjs";
import {MODULE_ID} from "./catalog.mjs";
import {formatAmount, positiveAmount, safeUnits, SCALE, toUnits} from "./economy.mjs";
import {rollMoneyFormula} from "./economy-formulas.mjs";
import {dialogClasses, escape, formDialog, selectOptions, traitOutcome} from "./immersive-actions.mjs";
import {immersiveEnabled, immersiveRules, OUTCOMES, ruleCurrency} from "./immersive-rules.mjs";
import {
  BARGAIN_REACTIONS, bargainAward, bargainConfig, bargainPenalty, bargainPenaltyDetails, defaultBargainMaximum, DEFAULT_BARGAIN_TRAITS,
  noticeHint, reactionInterval
} from "./bargaining-rules.mjs";
import {betterEffectsApi} from "./money-flags.mjs";

const {ApplicationV2, DialogV2, HandlebarsApplicationMixin} = foundry.applications.api;
const invitation = "bargainInvitation";
const request = "bargainRequest";
const draftFlag = "bargainDraft";
const ticketFlag = "bargainRollTicket";
const noticeResultFlag = "bargainNoticeResult";
const timeLimit = 30 * 60_000;
const report = error => ui.notifications.error(error.message || String(error));
let hosted;
let playerWindow;
let gmWindow;
const spectatorWindows = new Map();
let managing = false;

function moneyText(units, currency) {
  return `${currency.symbol ?? ""}${formatAmount(units)}`;
}

function showBargainingHelp() {
  return DialogV2.wait({
    classes: dialogClasses, window: {title: sbsI18n("swade-better-money.UI.HowBargainingWorks_1d7ffa287b"), resizable: true}, position: {width: 575},
    content: `<p>${sbsI18n("swade-better-money.UI.Choosehowmuchextrapayto_1c3f275170")}</p>
      <p>${sbsI18n("swade-better-money.UI.Thejobandtheemployers_5292b8daaf")}</p>
      <p>${sbsI18n("swade-better-money.UI.TheGMprivatelyrollstheemployer_0e1434bf2a")}</p>
      <p>${sbsI18n("swade-better-money.UI.EachviewercanrollblindNotice_d0b41ee5ca")}</p>
      <h3>${sbsI18n("swade-better-money.UI.ExampleStandardGig_867b75e76b")}</h3>
      <ol>
        <li>${sbsI18n("swade-better-money.UI.Thebaserewardis_8e37325d98")} <strong>¥1,500</strong>${sbsI18n("swade-better-money.UI.WithaNeutralemployertheinterval_402dfb037b")} <strong>¥500</strong>${sbsI18n("swade-better-money.UI.TheGMrolls2d4400500_0bf4142978")} <strong>¥2,500</strong>.</li>
        <li>${sbsI18n("swade-better-money.UI.Youaskfor_ca0d018987")} <strong>¥800</strong> ${sbsI18n("swade-better-money.UI.extra80050016rounded_5506a91de2")}</li>
        <li>${sbsI18n("swade-better-money.UI.15008002300within_25854b7eab")} <strong>−4 + 2 = −2</strong>.</li>
      </ol>
      <p><strong>${sbsI18n("swade-better-money.UI.Successorraise_fb9914af46")}</strong> ${sbsI18n("swade-better-money.UI.Receivetherequestedtotal_36518b89dc")} <strong>${sbsI18n("swade-better-money.UI.Failure_f130e747d5")}</strong> ${sbsI18n("swade-better-money.UI.Keepthebasereward_8a13eb18d2")} <strong>${sbsI18n("swade-better-money.UI.Criticalfailure_f42d4f5fe0")}</strong> ${sbsI18n("swade-better-money.UI.Loseoneintervalfromthebase_f18e6f9674")}</p>`,
    buttons: [{action: "close", label: sbsI18n("swade-better-money.UI.Close_7d9eb7acb1"), default: true}]
  });
}

function nameKey(name) {
  return String(name ?? "").trim().slugify({strict: true});
}

function findSkills(actor, names) {
  const keys = new Set(names.map(nameKey));
  return actor.items.filter(item => item.type === "skill" && !item.system.hidden
    && [item.name, item.system.swid].some(name => name && keys.has(nameKey(name))));
}

function ownedCharacters(player) {
  const selected = canvas?.tokens?.controlled?.map(token => token.actor) ?? [];
  return [...new Map([...selected, player.character, ...game.actors]
    .filter(actor => actor?.type === "character" && actor.testUserPermission(player, "OWNER"))
    .map(actor => [actor.uuid, {id: actor.uuid, name: actor.name, actor}])).values()];
}

async function setupBargain() {
  const currency = ruleCurrency();
  if (!currency) throw new Error(sbsI18n("swade-better-money.UI.Choosearulescurrencyorinstall_9eaa923008"));
  const rules = immersiveRules();
  const jobs = ["gigs", "hustles"].flatMap(group => rules[group].map(entry => ({
    ...bargainConfig(group, entry), id: group + ":" + entry.id, name: entry.name,
    baseFormula: entry.formula ?? entry.outcomes.success.formula
  })));
  if (!jobs.length) throw new Error(sbsI18n("swade-better-money.UI.Configureagigorhustlebefore_4d464b2431"));
  const players = game.users.filter(user => user.active && !user.isGM && ownedCharacters(user).length);
  if (!players.length) throw new Error(sbsI18n("swade-better-money.UI.Anonlineplayerneedsanowned_6d4a57c45a"));
  const reactions = Object.entries(BARGAIN_REACTIONS).map(([id, reaction]) => ({id, name: reaction.label}));

  const data = await formDialog(sbsI18n("swade-better-money.UI.SetUpBargaining_3697d2e095"), [
    `<div class="money-fields"><label class="money-field">Job type <select name="job">` + selectOptions(jobs) + '</select></label>',
    `<label class="money-field">Employer attitude <select name="reaction">` + selectOptions(reactions, "neutral") + '</select></label></div>',
    `<div class="money-fields"><label class="money-field">Player <select name="player">` + selectOptions(players) + '</select></label>',
    `<label class="money-field">${sbsI18n("swade-better-money.UI.Character_1405a63e8a")} <select name="actor"></select></label></div>`,
    `<div class="money-fields"><label class="money-field">${sbsI18n("swade-better-money.UI.Basereward_ed3afe9f74")} <input name="base" type="number" min="0" step="0.000001" placeholder="${sbsI18nAttribute("swade-better-money.UI.Rolloninvite_14fc7cb3d1")}"></label>`,
    `<label class="money-field">${sbsI18n("swade-better-money.UI.Maximumextrarequest_b739501fd5")} <input name="maximum" type="number" min="0.000001" step="0.000001" placeholder="${sbsI18nAttribute("swade-better-money.UI.Twicethebasereward_9e219c03e0")}"></label></div>`,
    `<button type="button" data-roll-bargain-base><i class="fa-solid fa-dice" aria-hidden="true"></i> ${sbsI18n("swade-better-money.UI.RollBaseReward_93c2417e08")}</button>`,
    `<label class="money-field">${sbsI18n("swade-better-money.UI.Noticemodifier_17c33fd275")} <input name="noticeModifier" type="number" step="1" value="0" required></label>`,
    `<label class="money-field">${sbsI18n("swade-better-money.UI.Opposedrollflags_e2255aa5f0")} <input name="flags" placeholder="${sbsI18nAttribute("swade-better-money.UI.egmercenaryguild_5ba448d10a")}"></label>`
  ].join(""), sbsI18n("swade-better-money.UI.InvitePlayer_1ab283312b"), (_event, dialog) => {
    const form = dialog.element.querySelector("form");
    const {base, maximum, job} = form.elements;
    const rollButton = form.querySelector("[data-roll-bargain-base]");
    const inviteButton = form.querySelector('button[data-action="save"]');
    let manualMaximum = false;
    const selectedJob = () => jobs.find(entry => entry.id === job.value);
    const updateActors = () => {
      const player = game.users.get(form.elements.player.value);
      form.elements.actor.innerHTML = selectOptions(ownedCharacters(player), player.character?.uuid);
    };
    const updateMaximum = () => {
      if (manualMaximum) return;
      try {
        maximum.value = base.value ? String(defaultBargainMaximum(toUnits(base.value)) / SCALE) : "";
      } catch {
        maximum.value = "";
      }
    };
    form.elements.player.addEventListener("change", updateActors);
    base.addEventListener("input", updateMaximum);
    maximum.addEventListener("input", () => { manualMaximum = Boolean(maximum.value); });
    maximum.addEventListener("change", updateMaximum);
    rollButton.addEventListener("click", async () => {
      rollButton.disabled = inviteButton.disabled = true;
      try {
        const {units} = await rollMoneyFormula(selectedJob().baseFormula);
        base.value = String(units / SCALE);
        updateMaximum();
      } catch (error) {
        report(error);
      } finally {
        rollButton.disabled = inviteButton.disabled = false;
      }
    });
    updateActors();
  });
  if (!data || data === "cancel") return;

  const player = game.users.get(data.player);
  const actor = player?.active && ownedCharacters(player).find(entry => entry.id === data.actor)?.actor;
  const job = jobs.find(entry => entry.id === data.job);
  if (!actor || !job) throw new Error(sbsI18n("swade-better-money.UI.Chooseanonlineplayerandan_3ec4f9c706"));
  const otherHost = game.users.some(user => {
    if (!user.isGM || !user.active || user.id === game.user.id) return false;
    const current = user.getFlag(MODULE_ID, invitation);
    return current?.playerId === player.id && !current.finished && current.expires > Date.now();
  });
  if (otherHost) {
    throw new Error(sbsI18n("swade-better-money.UI.Thatplayeralreadyhasanactive_f26bc61297"));
  }
  const allowed = (rules.bargainTraits ?? DEFAULT_BARGAIN_TRAITS).split(",");
  const skills = findSkills(actor, allowed);
  if (!skills.length) skills.push({id: "unskilled", name: sbsI18n("swade-better-money.UI.UnskilledAttempt_63ecc95eac")});
  const interval = reactionInterval(job.id, positiveAmount(job.interval), data.reaction);
  const noticeModifier = Number(data.noticeModifier);
  if (!Number.isSafeInteger(noticeModifier)) throw new Error(sbsI18n("swade-better-money.UI.Enterawholenumberforthe_375f850061"));
  const flags = betterEffectsApi()?.normalizeFlags?.(data.flags) ?? data.flags.split(",").map(flag => nameKey(flag)).filter(Boolean);
  const base = data.base ? toUnits(data.base) : (await rollMoneyFormula(job.baseFormula)).units;
  const maximum = data.maximum ? positiveAmount(data.maximum) : defaultBargainMaximum(base);
  if (!maximum) throw new Error(sbsI18n("swade-better-money.UI.Setapositivemaximumextrarequest_dbc5145ab3"));
  safeUnits(base + maximum);
  const limit = (await rollMoneyFormula(job.formula)).units;
  const state = {
    id: foundry.utils.randomID(), gmId: game.user.id, playerId: player.id, expires: Date.now() + timeLimit,
    title: job.name, character: actor.name, currency: {symbol: currency.symbol},
    base, maximum, skills: skills.map(({id, name}) => ({id, name})),
    reply: null, result: null, error: null, reopen: null, finished: false, rolling: null, lockedExtra: null, cancelled: false
  };
  hosted = {
    player, actor, job, interval, attitude: BARGAIN_REACTIONS[data.reaction].label,
    limit, noticeModifier, flags, state, seen: new Set(), notices: new Map(), noticeTickets: new Map()
  };
  try {
    await publish(hosted);
  } catch (error) {
    hosted = null;
    throw error;
  }
  await showGM(hosted, true);
  ui.notifications.info("Bargaining invitation sent to " + player.name + ".");
}

function publish(round, fields = {}) {
  // User flags are visible to clients. Keep the limit, interval, and modifiers on the host.
  Object.assign(round.state, fields);
  if (gmWindow?.rendered) void showGM(round)?.catch(report);
  return game.user.setFlag(MODULE_ID, invitation, round.state);
}

async function manageBargain() {
  if (!game.user.isGM || !immersiveEnabled() || managing) return;
  managing = true;
  try {
    if (!hosted || (!hosted.state.finished && hosted.state.expires <= Date.now())) await setupBargain();
    else await showGM(hosted, true);
  } finally {
    managing = false;
  }
}

function showGM(round, force = false) {
  gmWindow ??= new BargainWindow({id: "better-money-bargaining-gm", window: {title: sbsI18n("swade-better-money.UI.BargainingGM_3e2f4b1cff")}});
  gmWindow.spectator = true;
  gmWindow.gmRound = round;
  return gmWindow.show(round.state, force);
}

async function postBargainResult(state, result, actor) {
  await ChatMessage.implementation.create({
    speaker: ChatMessage.getSpeaker({actor}),
    flavor: "Bargaining · " + escape(state.title),
    content: `<p>` + escape(state.character) + " · " + escape(OUTCOMES[result.outcome])
      + `</p><p><strong>${sbsI18n("swade-better-money.UI.Finalreward_83cd3de547")} ` + escape(moneyText(result.units, state.currency)) + "</strong></p>"
  });
}

function postNoticeResult(round, viewerId, result) {
  return ChatMessage.implementation.create({
    whisper: [viewerId], content: `<p>${sbsI18n("swade-better-money.UI.BargainingPrivateNoticehintupdated_9ff6051e59")}</p>`,
    flags: {[MODULE_ID]: {[noticeResultFlag]: {session: round.state.id, ...result}}}
  });
}

async function resolveNotice(round, viewer, query) {
  if (round.seen.has(query.id)) return;
  round.seen.add(query.id);
  const {state, notices, noticeTickets} = round;
  const result = {reply: query.ticket ?? query.id};
  try {
    if (!immersiveEnabled() || state.finished || state.expires <= Date.now()) throw new Error(sbsI18n("swade-better-money.UI.Thisbargaininginvitationisclosed_31cc09a40f"));
    if (query.action === "notice") {
      if (notices.has(viewer.id) || noticeTickets.has(viewer.id)) throw new Error(sbsI18n("swade-better-money.UI.YourNoticecheckisalreadyactive_d5fd66402c"));
      const actor = viewer.id === round.player.id ? round.actor : await fromUuid(query.actorUuid);
      if (actor?.type !== "character" || !actor.testUserPermission(viewer, "OWNER")) throw new Error(sbsI18n("swade-better-money.UI.Chooseacharacteryouownto_3fe3a634a8"));
      const ticket = {
        id: query.id, session: state.id, action: "notice", actorUuid: actor.uuid,
        skill: findSkills(actor, ["notice"])[0]?.id ?? null, modifier: round.noticeModifier, flags: round.flags
      };
      noticeTickets.set(viewer.id, ticket);
      try { await viewer.setFlag(MODULE_ID, ticketFlag, ticket); }
      catch (error) { noticeTickets.delete(viewer.id); throw error; }
      return;
    }
    const ticket = noticeTickets.get(viewer.id);
    if (!ticket || ticket.id !== query.ticket) throw new Error(sbsI18n("swade-better-money.UI.ThisNoticecheckisnolonger_3380b13a5a"));
    noticeTickets.delete(viewer.id);
    if (query.action === "accept") {
      const message = game.messages.get(query.message);
      const roll = message?.rolls?.[0];
      if (!message?.blind || message.author?.id !== viewer.id || ChatMessage.getSpeakerActor(message.speaker)?.uuid !== ticket.actorUuid
        || message.getFlag(MODULE_ID, "bargainRoll") !== ticket.id || roll?.options?.rollType !== "trait"
        || !Number.isFinite(roll.total)) throw new Error(sbsI18n("swade-better-money.UI.ThematchingblindNoticerollcould_0df6d9f935"));
      const outcome = traitOutcome(roll);
      notices.set(viewer.id, outcome);
      result.resolved = true;
      result.hint = noticeHint(state.base, round.limit, round.interval, state.maximum, outcome);
    }
  } catch (error) {
    result.error = error.message;
  }
  await postNoticeResult(round, viewer.id, result);
}

async function resolveRequest(round, query) {
  if (round.busy || round.seen.has(query.id)) return;
  round.busy = true;
  round.seen.add(query.id);
  const {actor, player, state, interval, limit} = round;
  const fields = {reply: query.ticket ?? query.id, error: null};
  try {
    if (!immersiveEnabled() || state.finished || state.expires <= Date.now()) throw new Error(sbsI18n("swade-better-money.UI.Thisbargaininginvitationisclosed_31cc09a40f"));
    if (!actor.testUserPermission(player, "OWNER")) throw new Error(sbsI18n("swade-better-money.UI.Theplayernolongerownsthis_e34abc9c4c"));
    if (query.action === "accept" || query.action === "release") {
      const ticket = round.ticket;
      if (!ticket || ticket.id !== query.ticket) throw new Error(sbsI18n("swade-better-money.UI.Thisrollisnolongeractive_40383eef27"));
      if (query.action === "accept") {
        const message = game.messages.get(query.message);
        const roll = message?.rolls?.[0];
        if (message?.author?.id !== player.id || ChatMessage.getSpeakerActor(message.speaker)?.uuid !== actor.uuid
          || message.getFlag(MODULE_ID, "bargainRoll") !== ticket.id || roll?.options?.rollType !== "trait"
          || !Number.isFinite(roll.total)) throw new Error(sbsI18n("swade-better-money.UI.ThematchingSWADErollcouldnot_2c987ddc91"));
        const outcome = traitOutcome(roll);
        fields.result = {outcome, extra: ticket.extra, total: roll.total, units: bargainAward(state.base, ticket.extra, interval, outcome)};
        fields.finished = true;
        try { await postBargainResult(state, fields.result, actor); } catch (error) { report(error); }
      }
      round.ticket = null;
      fields.rolling = null;
    } else {
      if (round.ticket) throw new Error(sbsI18n("swade-better-money.UI.Finishthecurrentrollfirst_488b4fec46"));
      const action = query.action;
      let skill, extra, modifier;
      if (action === "bargain") {
        extra = positiveAmount(query.extra);
        if (extra > state.maximum || (state.lockedExtra !== null && extra !== state.lockedExtra)) {
          throw new Error(sbsI18n("swade-better-money.UI.Usethelockedofferamount_f3262f5c6d"));
        }
        if (!state.skills.some(entry => entry.id === query.skill)
          || (query.skill !== "unskilled" && actor.items.get(query.skill)?.type !== "skill")) {
          throw new Error(sbsI18n("swade-better-money.UI.Chooseanallowedbargainingskill_4323e785e6"));
        }
        skill = query.skill === "unskilled" ? null : query.skill;
        modifier = bargainPenalty(state.base, extra, interval, limit);
        fields.lockedExtra = extra;
      } else throw new Error(sbsI18n("swade-better-money.UI.Thisrollisnolongeravailable_43b63f949b"));
      const ticket = {id: query.id, session: state.id, action, actorUuid: actor.uuid, skill: skill ?? null, modifier, extra: extra ?? null, flags: round.flags};
      await player.setFlag(MODULE_ID, ticketFlag, ticket);
      round.ticket = ticket;
      fields.reply = null;
      fields.rolling = action;
    }
  } catch (error) {
    fields.error = error.message;
    if (query.ticket === round.ticket?.id) {
      round.ticket = null;
      fields.rolling = null;
    }
  } finally {
    try { await publish(round, fields); } finally { round.busy = false; }
  }
}

async function nativeBargainRoll(ticket) {
  const actor = await fromUuid(ticket.actorUuid);
  if (!actor?.isOwner) throw new Error(sbsI18n("swade-better-money.UI.Thenegotiatingcharacterisunavailable_c525dfd1d3"));
  const blind = ticket.action === "notice";
  const title = blind ? sbsI18n("swade-better-money.UI.BargainingNotice_15b11e397d") : sbsI18n("swade-better-money.UI.BargainingProposition_b61bdd2580");
  const flavor = title + " (" + ticket.id + ")";
  const visibility = blind ? {blind: true, whisper: game.users.filter(user => user.isGM).map(user => user.id)} : {};
  const hook = Hooks.on("preCreateChatMessage", message => {
    if (message.flavor === flavor) message.updateSource({["flags." + MODULE_ID + ".bargainRoll"]: ticket.id, flavor: title, ...visibility});
  });
  const dialogHook = blind ? Hooks.on("renderRollDialog", (app, element) => {
    if (app.title !== title) return;
    const mode = element.querySelector('[name="messageMode"]');
    if (mode) {
      mode.value = "blind";
      mode.disabled = true;
    }
  }) : null;
  let roll;
  try {
    roll = await actor.rollSkill(ticket.skill, {
      title, flavour: flavor, isRerollable: false, ...(blind && {messageMode: "blind"}),
      additionalMods: [{label: ticket.action === "notice" ? sbsI18n("swade-better-money.UI.Noticemodifier_17c33fd275") : sbsI18n("swade-better-money.UI.Propositionmodifier_43858b4c20"), value: ticket.modifier}],
      effectFlags: ["opposed", ...ticket.flags],
      sbeOpposition: {targetNumber: 4, flags: ticket.flags, defenderUuid: actor.token?.uuid ?? actor.uuid}
    });
  } finally {
    Hooks.off("preCreateChatMessage", hook);
    if (dialogHook !== null) Hooks.off("renderRollDialog", dialogHook);
  }
  if (!roll?.messageId) return null;
  let best = roll;
  let bestId = roll.messageId;
  while (actor.bennies > 0 && (blind || !best.isCritfail)) {
    const decision = await DialogV2.wait({
      classes: ["swade", "better-money", "sbs-standard-swade-sheet"], window: {title},
      content: blind ? `<p>${sbsI18n("swade-better-money.UI.YourNoticerollisblindKeep_a613d4c152")}</p>`
        : `<p>` + escape(OUTCOMES[traitOutcome(best)]) + " (" + best.total + ")</p>",
      buttons: [{action: "keep", label: sbsI18n("swade-better-money.UI.KeepRoll_e710e29594")}, {action: "reroll", label: sbsI18n("swade-better-money.UI.SpendBennytoReroll_454e5362fa")}]
    });
    if (decision !== "reroll" || !await actor.spendBenny()) break;
    const source = game.messages.get(roll.messageId);
    const retry = roll.clone();
    retry.rerollMode = "benny";
    retry.applyReroll(actor);
    const next = await retry.reroll();
    const message = await next.toMessage({
      speaker: source.speaker, flavor: source.flavor, flags: source.flags, whisper: source.whisper, blind: source.blind
    }, {messageMode: blind ? "blind" : source.getFlag("swade", "messageMode") ?? game.settings.get("core", "messageMode")});
    if (!best.isCritfail && (next.isCritfail || next.total > best.total)) {
      best = next;
      bestId = message.id;
    }
  }
  return bestId;
}
function hintStyle(hint, maximum) {
  if (!hint) return "";
  const percent = units => Math.max(0, Math.min(100, units / maximum * 100)) + "%";
  if ("extra" in hint) {
    const withinLimit = ["#44986e", "#7e923f", "#a08a39", "#a37638"];
    const aboveLimit = ["#b47942", "#ad5d40", "#a34b43", "#813b3b"];
    const boundaries = [hint.extra];
    if (hint.interval > 0) {
      for (let step = 1; step < withinLimit.length; step++) boundaries.push(step * hint.interval);
    }
    const ends = [...new Set(boundaries)].filter(value => value > 0 && value < maximum).sort((a, b) => a - b);
    ends.push(maximum);
    let start = 0;
    const bands = ends.map(end => {
      const colors = start < hint.extra ? withinLimit : aboveLimit;
      const step = hint.interval > 0 ? Math.floor(start / hint.interval) : 0;
      const color = colors[Math.min(step, colors.length - 1)];
      const band = `${color} ${percent(start)} ${percent(end)}`;
      start = end;
      return band;
    });
    return `linear-gradient(to right, ${bands.join(", ")})`;
  }
  const low = percent(hint.low);
  const high = percent(hint.high);
  return "linear-gradient(to right, #44986e " + low + ", #ba8a36 " + percent((hint.low + hint.high) / 2)
    + ", #a95248 " + high + ")";
}

class BargainWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "better-money-bargaining", classes: ["swade", "better-money", "sbs-standard-swade-sheet", "bm-bargain-window"],
    window: {get title() { return sbsI18n("swade-better-money.UI.Bargaining_18d902a13d"); }, icon: "fa-solid fa-handshake", resizable: true},
    position: {width: 535, height: "auto"},
    actions: {
      bargainingHelp(event) {
        event.preventDefault();
        return showBargainingHelp();
      },
      async rerollLimit() {
        const round = this.gmRound;
        if (!round || round !== hosted || round.busy || round.ticket || round.state.finished || round.state.expires <= Date.now()) return;
        const {state, interval} = round;
        round.busy = true;
        try {
          const {units} = await rollMoneyFormula(round.job.formula);
          round.limit = units;
          if (this.rendered) await showGM(round);
          await Promise.all([...round.notices].map(([viewerId, outcome]) => postNoticeResult(round, viewerId, {
            resolved: true, hint: noticeHint(state.base, units, interval, state.maximum, outcome)
          })));
        } catch (error) {
          report(error);
        } finally {
          round.busy = false;
        }
      },
      notice() { return this.ask("notice"); },
      bargain() { return this.ask("bargain"); },
      async reopenPlayer() {
        if (this.gmRound === hosted) await publish(hosted, {reopen: foundry.utils.randomID()});
      },
      async cancelBargain() {
        const round = this.gmRound;
        if (!round || round !== hosted || round.state.finished || round.busy) return;
        const state = {...round.state, finished: true, cancelled: true, rolling: null};
        round.busy = true;
        try {
          await game.user.setFlag(MODULE_ID, invitation, state);
        } catch (error) {
          report(error);
          return;
        } finally {
          round.busy = false;
        }
        hosted = null;
        await this.show(state, false);
      },
      async newBargain() {
        if (this.gmRound === hosted && hosted.state.finished && !managing) {
          managing = true;
          try { await setupBargain(); } catch (error) { report(error); } finally { managing = false; }
        }
      }
    }
  };

  static PARTS = {body: {template: `modules/${MODULE_ID}/templates/bargaining.hbs`}};
  extra = "0";
  skill = "";
  pending = null;
  timer = null;
  draftTimer = null;
  spectator = false;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = this.snapshot;
    const {hint, resolved: noticeResolved, error: noticeError} = this.noticeResult ?? {};
    const closed = !state.result && state.expires <= Date.now();
    const extra = state.result?.extra ?? state.lockedExtra ?? (this.spectator ? toUnits(this.extra) : 0);
    const gm = this.gmRound;
    const amount = units => moneyText(units, state.currency);
    const details = gm && extra ? bargainPenaltyDetails(state.base, extra, gm.interval, gm.limit) : null;
    return {
      ...context, ...state, closed, spectator: this.spectator, pending: Boolean(this.pending), extra: this.extra,
      readOnlyOffer: this.spectator || Boolean(this.pending),
      extraText: amount(extra),
      requestedText: amount(state.base + extra),
      locked: state.lockedExtra != null,
      gm: gm && {
        canRerollLimit: !closed && !state.finished && !state.rolling,
        negotiator: gm.player.name, attitude: gm.attitude, interval: amount(gm.interval),
        limit: amount(gm.limit), baseFormula: gm.job.baseFormula, limitFormula: gm.job.formula,
        noticeModifier: gm.noticeModifier, flags: gm.flags.join(", "),
        penalty: details && {
          steps: `Round up (${amount(extra)} ÷ ${amount(gm.interval)}) = ${details.steps}`,
          base: `${details.steps} × (−2) = ${details.basePenalty}`,
          limit: `${amount(details.requested)} ${details.withinLimit ? "≤" : ">"} ${amount(gm.limit)}`,
          final: `${details.basePenalty} + ${details.reduction} = ${details.modifier}`
        }
      },
      maxAmount: (state.maximum / SCALE).toFixed(6), sliderStep: state.maximum % SCALE ? "any" : "1",
      skills: state.skills.map(entry => ({...entry, selected: entry.id === this.skill})),
      baseText: amount(state.base),
      noticeResolved, noticeError, canRollNotice: !this.gmRound && !noticeResolved,
      hintText: hint && ("through" in hint
        ? hint.through <= state.base ? "Any extra takes the full penalty. The employer’s limit is " + moneyText(hint.through, state.currency) + "."
          : "Acceptable total " + moneyText(state.base, state.currency) + " to " + moneyText(hint.through, state.currency) + "."
        : null),
      gradient: hintStyle(hint, state.maximum),
      resultText: state.result && OUTCOMES[state.result.outcome] + " (" + state.result.total + ")",
      rewardText: state.result && moneyText(state.result.units, state.currency)
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector(".bm-bargain-help").addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (!event.repeat) event.currentTarget.click();
    });
    if (this.spectator) return;
    const form = this.element.querySelector("form");
    if (!form) return;
    const {slider, extra, skill} = form.elements;
    const total = this.element.querySelector("[data-offer-total]");
    const requested = this.element.querySelector("[data-offer-extra]");
    const button = form.querySelector('[data-action="bargain"]');
    const update = () => {
      const base = this.snapshot.base;
      let units;
      try { units = toUnits(extra.value || "0"); } catch { units = null; }
      const valid = units !== null && units <= this.snapshot.maximum;
      total.textContent = valid ? moneyText(base + units, this.snapshot.currency) : "—";
      requested.textContent = valid ? moneyText(units, this.snapshot.currency) : "—";
      button.disabled = Boolean(this.pending) || !valid || !units;
    };
    slider.addEventListener("input", () => {
      extra.value = String(Number(slider.value));
      this.extra = extra.value;
      update();
      this.shareDraft();
    });
    extra.addEventListener("input", () => {
      this.extra = extra.value;
      slider.value = extra.value;
      update();
      this.shareDraft();
    });
    skill.addEventListener("change", () => {
      this.skill = skill.value;
      this.shareDraft();
    });
    form.addEventListener("submit", event => event.preventDefault());
    update();
  }

  async receiveTicket(ticket) {
    if (this.snapshot?.id !== ticket.session || this.pending !== ticket.id) return;
    clearTimeout(this.timer);
    let message;
    try {
      message = await nativeBargainRoll(ticket);
    } catch (error) {
      report(error);
    }
    if (this.snapshot.id !== ticket.session || this.snapshot.cancelled) return;
    try {
      await game.user.setFlag(MODULE_ID, request, {
        id: foundry.utils.randomID(), session: ticket.session, gmId: this.snapshot.gmId,
        action: message ? "accept" : "release", notice: ticket.action === "notice", ticket: ticket.id, message: message ?? null
      });
    } catch (error) {
      this.pending = null;
      report(error);
      if (this.rendered) await this.render();
    }
  }

  async ask(action) {
    const notice = action === "notice";
    if (this.gmRound || (!notice && this.spectator) || this.pending || this.snapshot.finished) return;
    if (this.snapshot.expires <= Date.now()) return this.render();
    let actorUuid;
    if (notice && this.spectator) {
      actorUuid = ownedCharacters(game.user)[0]?.id;
      if (!actorUuid) return ui.notifications.warn(sbsI18n("swade-better-money.UI.Youneedanownedcharacterto_1fce647a0a"));
    }
    if (!notice) {
      const form = this.element.querySelector("form");
      this.skill = form.elements.skill.value;
      this.extra = form.elements.extra.value;
      this.shareDraft();
    } else this.noticeResult = null;
    const id = foundry.utils.randomID();
    this.pending = id;
    const query = {id, action, notice, actorUuid: actorUuid ?? null, extra: this.extra, skill: this.skill, gmId: this.snapshot.gmId, session: this.snapshot.id, ticket: null};
    await this.render();
    this.timer = setTimeout(() => {
      if (this.pending !== id) return;
      this.pending = null;
      const error = sbsI18n("swade-better-money.UI.TheGMhasnotrespondedYou_8e07c0080e");
      if (notice) this.noticeResult = {error};
      else this.snapshot = {...this.snapshot, error};
      if (this.rendered) void this.render();
    }, 12_000);
    try {
      await game.user.setFlag(MODULE_ID, request, query);
    } catch (error) {
      clearTimeout(this.timer);
      this.pending = null;
      if (notice) this.noticeResult = {error: error.message};
      else this.snapshot = {...this.snapshot, error: error.message};
      if (this.rendered) await this.render();
    }
  }

  shareDraft() {
    if (this.draftTimer) return;
    const session = this.snapshot.id;
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      if (this.snapshot.id !== session || this.snapshot.finished) return;
      let extra;
      try { extra = toUnits(this.extra || "0"); } catch { return; }
      if (extra > this.snapshot.maximum) return;
      const skill = this.skill || this.snapshot.skills[0]?.id;
      void game.user.setFlag(MODULE_ID, draftFlag, {session, extra, skill}).catch(error => console.error(error));
    }, 200);
  }

  readDraft(state) {
    const draft = game.users.get(state.playerId)?.getFlag(MODULE_ID, draftFlag);
    if (draft?.session !== state.id || !Number.isSafeInteger(draft.extra) || draft.extra < 0 || draft.extra > state.maximum) return;
    this.extra = String(draft.extra / SCALE);
    this.skill = state.skills.some(entry => entry.id === draft.skill) ? draft.skill : "";
  }

  show(state, reopen) {
    const isNew = this.snapshot?.id !== state.id;
    if (isNew) {
      this.extra = "0";
      this.skill = "";
      this.noticeResult = !this.gmRound && game.messages.contents.toReversed()
        .map(message => readNoticeResult(message, state)).find(result => result?.resolved);
    }
    if (isNew || state.reply === this.pending || state.finished) {
      clearTimeout(this.timer);
      this.pending = null;
    }
    this.snapshot = state;
    if (state.cancelled) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
      return this.close();
    }
    if (isNew || this.spectator) this.readDraft(state);
    if (state.lockedExtra != null) this.extra = String(state.lockedExtra / SCALE);
    if (reopen || this.rendered) return this.render({force: reopen});
  }
}

function viewerWindow(gmId, session) {
  return [playerWindow, spectatorWindows.get(gmId)].find(app => app?.snapshot?.id === session && app.snapshot.gmId === gmId);
}

function readNoticeResult(message, state) {
  if (message.author?.id !== state.gmId || !message.whisper.includes(game.user.id)) return null;
  const result = message.getFlag(MODULE_ID, noticeResultFlag);
  return result?.session === state.id ? result : null;
}

function present(state) {
  if (!state || game.user.isGM || !immersiveEnabled()) return;
  const spectator = state.playerId !== game.user.id;
  if (!spectator && spectatorWindows.get(state.gmId)?.rendered) void spectatorWindows.get(state.gmId).close();
  let app = spectator ? spectatorWindows.get(state.gmId) : playerWindow;
  const isNew = app?.snapshot?.id !== state.id;
  if (isNew && (state.finished || state.expires <= Date.now())) return;
  const reopen = isNew || (!spectator && state.reopen && state.reopen !== app.snapshot.reopen);
  if (!app && spectator) {
    app = new BargainWindow({id: `better-money-bargaining-spectator-${state.gmId}`, window: {title: sbsI18n("swade-better-money.UI.BargainingSpectating_ff60c930b6")}});
    app.spectator = true;
    spectatorWindows.set(state.gmId, app);
  }
  if (!app) app = playerWindow = new BargainWindow();
  void app.show(state, !!reopen)?.catch(report);
}

async function openGMActivities(activities) {
  const choice = await DialogV2.wait({
    classes: ["swade", "better-money", "sbs-standard-swade-sheet"],
    window: {title: sbsI18n("swade-better-money.UI.BetterMoney_b42f335a36")},
    position: {width: 350},
    buttons: [
      {action: "bargaining", label: sbsI18n("swade-better-money.UI.Bargaining_18d902a13d"), icon: "fa-solid fa-handshake"},
      {action: "reward", label: sbsI18n("swade-better-money.UI.AwardPlayers_e30893e51e"), icon: "fa-solid fa-sack-dollar"}
    ]
  });
  if (choice === "bargaining") await manageBargain();
  if (choice === "reward") await activities.award();
}

export function registerBargaining(activities) {
  Hooks.on("createChatMessage", message => {
    const payload = message.getFlag(MODULE_ID, noticeResultFlag);
    if (!payload) return;
    const app = viewerWindow(message.author?.id, payload.session);
    const result = app && readNoticeResult(message, app.snapshot);
    if (!result || app.snapshot.finished) return;
    if (result.reply && result.reply !== app.pending && !result.resolved) return;
    if (result.reply === app.pending) {
      clearTimeout(app.timer);
      app.pending = null;
    }
    app.noticeResult = result;
    if (app.rendered) void app.render().catch(report);
  });
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user.isGM || !immersiveEnabled() || !controls.tokens) return;
    controls.tokens.tools.betterMoney = {
      name: sbsI18n("swade-better-money.UI.betterMoney_7cf0eb2b87"), order: Number.MAX_SAFE_INTEGER, title: sbsI18n("swade-better-money.UI.BetterMoney_b42f335a36"), icon: "fa-solid fa-coins", button: true,
      onChange: (_event, active) => { if (active) void openGMActivities(activities).catch(report); }
    };
  });
  Hooks.on("updateUser", (user, changes, _options, sender) => {
    const flags = changes.flags?.[MODULE_ID];
    if (!flags) return;
    if (user.id === game.user.id && flags[ticketFlag]) {
      const ticket = user.getFlag(MODULE_ID, ticketFlag);
      if (ticket) void viewerWindow(sender, ticket.session)?.receiveTicket(ticket).catch(report);
    }
    if (user.isGM && sender === user.id && flags[invitation]) {
      const state = user.getFlag(MODULE_ID, invitation);
      if (state?.gmId === user.id) present(state);
    }
    if (sender === user.id && flags[draftFlag]) {
      if (hosted?.player.id === user.id && gmWindow?.rendered && !hosted.state.finished) void showGM(hosted)?.catch(report);
      for (const app of spectatorWindows.values()) {
        const state = app.snapshot;
        if (state?.playerId === user.id && !state.finished) void app.show(state, false)?.catch(report);
      }
    }
    const round = hosted;
    const query = flags[request] && user.getFlag(MODULE_ID, request);
    if (round && sender === user.id && !user.isGM && user.active
      && typeof query?.id === "string" && query.gmId === game.user.id && query.session === round.state.id) {
      if (query.notice && ["notice", "accept", "release"].includes(query.action)) void resolveNotice(round, user, query).catch(report);
      else if (user.id === round.player.id) void resolveRequest(round, query).catch(report);
    }
  });
  Hooks.once("ready", () => {
    for (const gm of game.users) {
      if (!gm.isGM || !gm.active) continue;
      const state = gm.getFlag(MODULE_ID, invitation);
      if (state?.gmId === gm.id) present(state);
    }
  });
}
