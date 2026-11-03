const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, mock } = require("node:test");
const { MessageFlags, PermissionsBitField, PermissionFlagsBits } = require("discord.js");
const {
  parseReminderTime,
  getNextRunAt,
  ReminderScheduler,
  scheduler: sharedScheduler,
} = require("../utils/reminderScheduler");
const reminderCommand = require("../commands/reminder");
const reminderSubmit = require("../events/reminderSubmit");

const NOW = Date.parse("2026-11-03T03:20:00Z"); // 10:20 UTC+7

function makeScheduler(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carzusa-reminders-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const clock = { now: NOW };
  const scheduler = new ReminderScheduler({
    storagePath: path.join(directory, "reminders.json"),
    now: () => clock.now,
  });
  const send = mock.fn(async () => {});
  scheduler.client = {
    channels: { fetch: mock.fn(async () => ({ isSendable: () => true, send })) },
  };
  return { scheduler, send, clock };
}

function makeReminder(overrides = {}) {
  return {
    id: "reminder-1",
    userId: "123",
    channelId: "456",
    note: "Check the oven @everyone <@789>",
    interval: "once",
    nextRunAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function makeInteraction(overrides = {}) {
  return {
    id: "interaction-1",
    user: { id: "123" },
    channelId: "456",
    channel: { isSendable: () => true, isThread: () => false },
    inGuild: () => true,
    appPermissions: new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]),
    reply: mock.fn(async () => {}),
    deferReply: mock.fn(async () => {}),
    editReply: mock.fn(async () => {}),
    showModal: mock.fn(async () => {}),
    fields: {
      getTextInputValue: (id) => id === "time" ? "2099-12-01 18:30" : "Remember this",
      getStringSelectValues: () => ["daily"],
    },
    ...overrides,
  };
}

test("date and time are interpreted strictly in UTC+7", () => {
  assert.equal(parseReminderTime("2026-12-01 18:30", "once", NOW), "2026-12-01T11:30:00.000Z");
  assert.equal(parseReminderTime("2026-12-01T18:30", "daily", NOW), "2026-12-01T11:30:00.000Z");
  assert.equal(parseReminderTime(" 11:00 ", "once", NOW), "2026-11-03T04:00:00.000Z");
  assert.equal(parseReminderTime("9:05", "once", NOW), "2026-11-04T02:05:00.000Z");
});

test("past clock times roll forward according to the interval", () => {
  const expected = {
    once: "2026-11-04T02:00:00.000Z",
    hourly: "2026-11-03T04:00:00.000Z",
    daily: "2026-11-04T02:00:00.000Z",
    weekly: "2026-11-10T02:00:00.000Z",
  };
  for (const [interval, nextRunAt] of Object.entries(expected)) {
    assert.equal(parseReminderTime("09:00", interval, NOW), nextRunAt);
  }
  assert.equal(parseReminderTime("10:20", "hourly", NOW), "2026-11-03T04:20:00.000Z");
  assert.equal(parseReminderTime("10:20", "once", NOW), "2026-11-04T03:20:00.000Z");
  assert.equal(parseReminderTime("00:05", "once", Date.parse("2026-12-31T16:59:00Z")), "2026-12-31T17:05:00.000Z");
});

test("invalid times, dates, intervals and past explicit dates are rejected", () => {
  for (const input of ["", " ", "24:00", "25:00", "12:60", "tomorrow", "2026-02-30 12:00", "2026-12-01 24:00"]) {
    assert.throws(() => parseReminderTime(input, "once", NOW), /valid time/);
  }
  assert.throws(() => parseReminderTime("2026-11-03 10:20", "daily", NOW), /future/);
  assert.throws(() => parseReminderTime("2026-11-02 12:00", "once", NOW), /future/);
  assert.throws(() => parseReminderTime("12:00", "monthly", NOW), /Choose/);
  assert.throws(() => parseReminderTime("12:00", "toString", NOW), /Choose/);
});

test("recurrences retain their original cadence and skip missed runs", () => {
  const runAt = "2026-11-03T03:00:00.000Z";
  assert.equal(getNextRunAt(runAt, "once", NOW), null);
  assert.equal(getNextRunAt(runAt, "hourly", Date.parse("2026-11-03T06:45:00Z")), "2026-11-03T07:00:00.000Z");
  assert.equal(getNextRunAt(runAt, "daily", Date.parse("2026-11-06T03:00:00Z")), "2026-11-07T03:00:00.000Z");
  assert.equal(getNextRunAt(runAt, "weekly", Date.parse("2026-11-18T01:00:00Z")), "2026-11-24T03:00:00.000Z");
});

test("modal uses three required label components and the four interval options", async () => {
  const interaction = makeInteraction();
  await reminderCommand.execute(interaction);
  const modal = interaction.showModal.mock.calls[0].arguments[0].toJSON();
  assert.equal(modal.custom_id, reminderCommand.MODAL_ID);
  assert.equal(modal.components.length, 3);
  assert.ok(modal.components.every((component) => component.type === 18 && component.component.required));
  assert.deepEqual(modal.components.map((component) => component.component.custom_id), ["time", "interval", "note"]);
  assert.deepEqual(modal.components[1].component.options.map((option) => option.value), ["once", "hourly", "daily", "weekly"]);
});

test("command rejects channels without embed and send permissions", async () => {
  const interaction = makeInteraction({ appPermissions: new PermissionsBitField() });
  await reminderCommand.execute(interaction);
  assert.equal(interaction.showModal.mock.callCount(), 0);
  assert.equal(interaction.reply.mock.calls[0].arguments[0].flags, MessageFlags.Ephemeral);
});

test("thread permissions and bot DMs are supported", async () => {
  const interaction = makeInteraction({
    channel: { isSendable: () => true, isThread: () => true },
    appPermissions: new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.EmbedLinks,
    ]),
  });
  await reminderCommand.execute(interaction);
  assert.equal(interaction.showModal.mock.callCount(), 1);
  const dm = makeInteraction({ inGuild: () => false, appPermissions: null });
  await reminderCommand.execute(dm);
  assert.equal(dm.showModal.mock.callCount(), 1);
});

test("modal submission persists the reminder and confirms timestamps inside the embed", async (t) => {
  const add = t.mock.method(sharedScheduler, "addReminder", (reminder) => reminder);
  const interaction = makeInteraction();
  await reminderCommand.handleModalSubmit(interaction);
  assert.equal(interaction.deferReply.mock.calls[0].arguments[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(add.mock.calls[0].arguments[0], {
    id: "interaction-1", userId: "123", channelId: "456", interval: "daily",
    note: "Remember this", nextRunAt: "2099-12-01T11:30:00.000Z",
  });
  const confirmation = interaction.editReply.mock.calls[0].arguments[0];
  const unixTime = Math.floor(Date.parse("2099-12-01T11:30:00.000Z") / 1000);
  assert.doesNotMatch(confirmation.content, /<t:/);
  assert.equal(confirmation.embeds[0].toJSON().fields[0].value, `<t:${unixTime}:F> (<t:${unixTime}:R>)`);
  assert.deepEqual(confirmation.allowedMentions, { parse: [] });
});

test("blank notes and invalid intervals cannot be submitted", async (t) => {
  const add = t.mock.method(sharedScheduler, "addReminder", () => {});
  for (const [note, interval] of [["   ", "once"], ["a".repeat(4001), "once"], ["text", "monthly"], ["text", undefined]]) {
    const interaction = makeInteraction({
      fields: {
        getTextInputValue: (id) => id === "time" ? "18:30" : note,
        getStringSelectValues: () => interval ? [interval] : [],
      },
    });
    await reminderCommand.handleModalSubmit(interaction);
    assert.equal(interaction.deferReply.mock.callCount(), 0);
    assert.equal(interaction.reply.mock.calls[0].arguments[0].flags, MessageFlags.Ephemeral);
  }
  assert.equal(add.mock.callCount(), 0);
});

test("storage errors on submission are reported instead of confirming success", async (t) => {
  t.mock.method(sharedScheduler, "addReminder", () => { throw new Error("Disk full"); });
  t.mock.method(console, "error", () => {});
  const interaction = makeInteraction({
    isModalSubmit: () => true,
    customId: reminderCommand.MODAL_ID,
    deferred: true,
  });
  await reminderSubmit.execute(interaction);
  assert.match(interaction.editReply.mock.calls[0].arguments[0].content, /Could not save/);
});

test("modal event ignores other commands and modals", async () => {
  await reminderSubmit.execute({ isModalSubmit: () => false });
  await reminderSubmit.execute({ isModalSubmit: () => true, customId: "other-modal" });
});

test("reminders survive restart, use idempotent IDs and deliver overdue one-offs once", async (t) => {
  const { scheduler, send } = makeScheduler(t);
  scheduler.addReminder(makeReminder());
  scheduler.addReminder(makeReminder());
  const restarted = new ReminderScheduler({ storagePath: scheduler.storagePath, now: () => NOW });
  restarted.client = scheduler.client;
  await restarted.processDueReminders();
  await restarted.processDueReminders();
  assert.equal(send.mock.callCount(), 1);
  const payload = send.mock.calls[0].arguments[0];
  const embed = payload.embeds[0].toJSON();
  assert.equal(payload.content, "<@123>");
  assert.equal(embed.description, makeReminder().note);
  assert.equal(embed.footer.text, "Interval: once");
  assert.doesNotMatch(JSON.stringify(embed), /UTC\+7/);
  assert.ok(!embed.fields?.some((field) => field.name === "Next Reminder"));
  assert.deepEqual(payload.allowedMentions, { parse: [], users: ["123"] });
  assert.deepEqual(JSON.parse(fs.readFileSync(scheduler.storagePath, "utf8")), []);
});

test("future reminders wait and recurring reminders advance without flooding", async (t) => {
  const { scheduler, send, clock } = makeScheduler(t);
  scheduler.addReminder(makeReminder({ interval: "hourly", nextRunAt: "2026-11-03T04:00:00.000Z" }));
  await scheduler.processDueReminders();
  assert.equal(send.mock.callCount(), 0);
  clock.now = Date.parse("2026-11-03T07:30:00Z");
  await scheduler.processDueReminders();
  await scheduler.processDueReminders();
  assert.equal(send.mock.callCount(), 1);
  assert.equal(scheduler.reminders[0].nextRunAt, "2026-11-03T08:00:00.000Z");
  const unixTime = Math.floor(Date.parse(scheduler.reminders[0].nextRunAt) / 1000);
  assert.deepEqual(send.mock.calls[0].arguments[0].embeds[0].toJSON().fields, [
    { name: "Next Reminder", value: `<t:${unixTime}:R>` },
  ]);
  assert.equal(JSON.parse(fs.readFileSync(scheduler.storagePath, "utf8"))[0].nextRunAt, "2026-11-03T08:00:00.000Z");
});

test("hourly, daily and weekly embeds show the persisted next run as a relative timestamp", async (t) => {
  for (const [interval, hours] of [["hourly", 1], ["daily", 24], ["weekly", 168]]) {
    const { scheduler, send } = makeScheduler(t);
    scheduler.addReminder(makeReminder({ interval }));
    await scheduler.processDueReminders();

    const nextRunAt = new Date(NOW + hours * 60 * 60 * 1000).toISOString();
    const unixTime = Math.floor(Date.parse(nextRunAt) / 1000);
    const embed = send.mock.calls[0].arguments[0].embeds[0].toJSON();
    assert.equal(embed.footer.text, `Interval: ${interval}`);
    assert.doesNotMatch(JSON.stringify(embed), /UTC\+7/);
    assert.deepEqual(embed.fields, [{ name: "Next Reminder", value: `<t:${unixTime}:R>` }]);
    assert.equal(JSON.parse(fs.readFileSync(scheduler.storagePath, "utf8"))[0].nextRunAt, nextRunAt);
  }
});

test("overlapping polls do not duplicate deliveries or lose newly created reminders", async (t) => {
  const { scheduler, send } = makeScheduler(t);
  scheduler.addReminder(makeReminder());
  let release;
  send.mock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const processing = scheduler.processDueReminders();
  await new Promise((resolve) => setImmediate(resolve));
  await scheduler.processDueReminders();
  scheduler.addReminder(makeReminder({ id: "second", nextRunAt: "2026-11-04T03:20:00.000Z" }));
  release();
  await processing;
  assert.equal(send.mock.callCount(), 1);
  assert.deepEqual(scheduler.reminders.map((reminder) => reminder.id), ["second"]);
  assert.equal(JSON.parse(fs.readFileSync(scheduler.storagePath, "utf8"))[0].id, "second");
});

test("delivery failures retain reminders and retry with a cooldown", async (t) => {
  const { scheduler, send, clock } = makeScheduler(t);
  scheduler.addReminder(makeReminder());
  send.mock.mockImplementation(async () => { throw new Error("Missing permissions"); });
  t.mock.method(console, "error", () => {});
  await scheduler.processDueReminders();
  await scheduler.processDueReminders();
  assert.equal(send.mock.callCount(), 1);
  assert.equal(scheduler.reminders.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(scheduler.storagePath, "utf8")).length, 1);
  clock.now += 60_000;
  send.mock.mockImplementation(async () => {});
  await scheduler.processDueReminders();
  assert.equal(send.mock.callCount(), 2);
  assert.equal(scheduler.reminders.length, 0);
});

test("a failed post-delivery save is retried without sending again", async (t) => {
  const { scheduler, send } = makeScheduler(t);
  scheduler.addReminder(makeReminder());
  const save = scheduler.save.bind(scheduler);
  const saveMock = t.mock.method(scheduler, "save", () => { throw new Error("Disk full"); });
  await assert.rejects(scheduler.processDueReminders(), /Disk full/);
  assert.equal(scheduler.dirty, true);
  assert.equal(scheduler.processing, false);
  saveMock.mock.mockImplementation(save);
  await scheduler.processDueReminders();
  assert.equal(send.mock.callCount(), 1);
  assert.equal(scheduler.dirty, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(scheduler.storagePath, "utf8")), []);
});

test("corrupt storage is not silently overwritten by a new reminder", (t) => {
  const { scheduler } = makeScheduler(t);
  for (const contents of ["not json", "{}", '[{"id":"invalid"}]']) {
    fs.writeFileSync(scheduler.storagePath, contents);
    assert.throws(() => scheduler.addReminder(makeReminder()));
    assert.equal(fs.readFileSync(scheduler.storagePath, "utf8"), contents);
  }
});
