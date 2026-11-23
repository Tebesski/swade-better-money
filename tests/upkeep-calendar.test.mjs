import assert from "node:assert/strict";
import test from "node:test";
import {synchroniseUpkeep} from "../scripts/upkeep-calendar.mjs";

test("upkeep sync preserves the entire calendar when adding a category, including a custom year and selected future note date", async () => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const previousCalendar = globalThis.SimpleCalendar;
  const calendar = {
    id: "avatar", name: "Avatar",
    currentDate: {year: 160, month: 3, day: 13, seconds: 0},
    year: {numericRepresentation: 160, postfix: "AG", yearNamingRule: "repeat", yearNames: ["Dragon", "Snake", "Horse", "Goat", "Monkey"], yearNamesStart: 0},
    months: Array.from({length: 12}, (_, index) => ({name: `Month ${index + 1}`, numberOfDays: 30})),
    weekdays: [{name: "First Day"}], moons: [{name: "Tui", cycleLength: 29.53059}],
    seasons: [{name: "Winter", startingMonth: 11, startingDay: 20}],
    time: {hoursInDay: 24, minutesInHour: 60, secondsInMinute: 60},
    leapYear: {rule: "none", customMod: 0}, general: {pf2eSync: false},
    noteCategories: [{id: "festival", name: "Festival"}]
  };
  const original = structuredClone(calendar);
  const noteDate = {year: 161, month: 4, day: 6, hour: 0, minute: 0, seconds: 0};
  const gm = {id: "gm", isGM: true};
  const player = {id: "player", isGM: false};
  const users = [gm, player];
  users.get = id => users.find(user => user.id === id);
  const notes = new Map();
  let noteId;
  let configured = 0;
  let created = 0;
  let deleted = 0;
  let dialogChoice = "sync";
  const actor = {
    name: "Hen Li", uuid: "Actor.henli", testUserPermission: () => true,
    getFlag: (_scope, key) => key === "upkeepCalendarNote" ? noteId : {obligations: []},
    setFlag: async (_scope, _key, value) => { noteId = value; },
    unsetFlag: async () => { noteId = undefined; }
  };
  try {
    globalThis.foundry = {
      utils: {deepClone: structuredClone, randomID: () => "lifestyle", escapeHTML: value => value},
      applications: {api: {DialogV2: {wait: async () => dialogChoice, confirm: async () => true}}}
    };
    globalThis.game = {
      user: gm, users, journal: notes,
      macros: [{uuid: "Macro.refresh", getFlag: () => actor.uuid}],
      modules: new Map([["foundryvtt-simple-calendar-reborn", {active: true}]]),
      settings: {get: (_scope, key) => key === "catalog" ? {currencies: [{id: "yuan", symbol: "¥"}]}
        : {currencyId: "yuan", lifestyles: [], obligations: []}},
      time: {worldTime: 0, calendar: {
        days: {secondsPerMinute: 60, minutesPerHour: 60, hoursPerDay: 24, values: Array(7).fill(0)},
        years: {firstWeekday: 0}, months: {values: calendar.months},
        timeToComponents: () => ({year: 160, month: 3})
      }}
    };
    globalThis.SimpleCalendar = {api: {
      getCurrentCalendar: () => structuredClone(calendar),
      currentDateTime: () => ({year: 160, month: 3, day: 13, hour: 0, minute: 0, seconds: 0}),
      timestampToDate: () => ({year: 160, month: 3, day: 13}),
      DateSelector: {
        Get: (_id, options) => {
          options.onDateSelect({startDate: noteDate});
          return {build: () => ""};
        },
        Activate() {}, Remove() {}
      },
      configureCalendar: async (config, id) => {
        configured++;
        assert.equal(id, original.id);
        // This API replaces configuration. Missing sections reset to defaults in Simple Calendar.
        const {noteCategories, ...rest} = config;
        const {noteCategories: originalCategories, ...originalRest} = original;
        assert.deepEqual(rest, originalRest);
        assert.deepEqual(noteCategories[0], originalCategories[0]);
        assert.equal(noteCategories[1].name, "Lifestyle");
        Object.assign(calendar, structuredClone(config));
        return true;
      },
      addNote: async (_title, _text, start, end, _allDay, repeat) => {
        assert.deepEqual(start, dialogChoice === "current" ? {year: 160, month: 3, day: 13, hour: 0, minute: 0, seconds: 0} : noteDate);
        assert.deepEqual(end, start);
        assert.equal(repeat, 2);
        const note = {id: `note-${++created}`, update: async () => {}, delete: async () => { deleted++; notes.delete(note.id); }};
        notes.set(note.id, note);
        return note;
      }
    }};
    await synchroniseUpkeep(actor);
    assert.equal(configured, 1);
    assert.deepEqual(calendar.currentDate, original.currentDate);
    assert.deepEqual(calendar.year, original.year);
    dialogChoice = "current";
    await synchroniseUpkeep(actor);
    assert.equal(configured, 1);
    assert.equal(created, 2);
    assert.equal(deleted, 1);
    assert.deepEqual(calendar.year, original.year);
    dialogChoice = "cancel";
    await synchroniseUpkeep(actor);
    assert.equal(created, 2);
    assert.deepEqual(calendar.currentDate, original.currentDate);
  } finally {
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
    globalThis.SimpleCalendar = previousCalendar;
  }
});
