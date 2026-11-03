const fs = require("node:fs");
const path = require("node:path");
const { EmbedBuilder } = require("discord.js");
const moment = require("moment-timezone");

const TIMEZONE = "Asia/Ho_Chi_Minh";
const INTERVALS = {
  once: null,
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

function parseReminderTime(input, interval, now = Date.now()) {
  if (!Object.hasOwn(INTERVALS, interval)) {
    throw new Error("Choose once, hourly, daily, or weekly.");
  }

  const value = input.trim();
  const timeOnly = /^\d{1,2}:\d{2}$/.test(value);
  const formats = timeOnly
    ? ["HH:mm", "H:mm"]
    : ["YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm"];
  const parsed = moment.tz(value, formats, true, TIMEZONE);

  if (!parsed.isValid() || !formats.some((format) => parsed.format(format) === value)) {
    throw new Error("Enter a valid time as HH:mm or YYYY-MM-DD HH:mm (UTC+7).");
  }

  if (timeOnly) {
    const today = moment.tz(now, TIMEZONE);
    today.hour(parsed.hour()).minute(parsed.minute()).second(0).millisecond(0);
    if (today.valueOf() <= now) {
      if (interval === "once") today.add(1, "day");
      else return getNextRunAt(today.toISOString(), interval, now);
    }
    return today.toISOString();
  }

  if (parsed.valueOf() <= now) {
    throw new Error("The reminder date and time must be in the future (UTC+7).");
  }

  return parsed.toISOString();
}

function getNextRunAt(runAt, interval, now = Date.now()) {
  const duration = INTERVALS[interval];
  if (!duration) return null;

  const start = Date.parse(runAt);
  // Keep the original cadence, skipping missed occurrences after downtime.
  const steps = Math.max(1, Math.floor((now - start) / duration) + 1);
  return new Date(start + steps * duration).toISOString();
}

class ReminderScheduler {
  constructor({ storagePath, now = Date.now } = {}) {
    const isDev = process.env.DEV_MODE === "true" || process.env.DEV_MODE === "1";
    this.storagePath = storagePath || path.join(
      __dirname,
      `../data/reminders${isDev ? ".development" : ""}.json`,
    );
    this.now = now;
    this.reminders = [];
    this.loaded = false;
    this.dirty = false;
    this.processing = false;
    this.retryAfter = new Map();
    this.client = null;
    this.timer = null;
  }

  load() {
    if (this.loaded) return;
    let reminders;
    try {
      reminders = JSON.parse(fs.readFileSync(this.storagePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      reminders = [];
    }

    if (!Array.isArray(reminders) || reminders.some((reminder) =>
      !reminder || !reminder.id || !reminder.userId || !reminder.channelId ||
      typeof reminder.note !== "string" || !reminder.note.trim() ||
      reminder.note.length > 4000 || !Object.hasOwn(INTERVALS, reminder.interval) ||
      !Number.isFinite(Date.parse(reminder.nextRunAt))
    )) {
      throw new Error("Invalid reminder storage. Refusing to overwrite it.");
    }

    this.reminders = reminders;
    this.loaded = true;
  }

  save(reminders) {
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
    const temporaryPath = `${this.storagePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(reminders, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, this.storagePath);
    this.dirty = false;
  }

  addReminder(reminder) {
    this.load();
    const existing = this.reminders.find((item) => item.id === reminder.id);
    if (existing) return existing;

    const reminders = [...this.reminders, reminder];
    this.save(reminders);
    this.reminders = reminders;
    return reminder;
  }

  getReminders(userId) {
    this.load();
    return this.reminders.filter((reminder) => reminder.userId === userId);
  }

  deleteReminder(id, userId) {
    this.load();
    const reminder = this.reminders.find((item) => item.id === id && item.userId === userId);
    if (!reminder) return false;
    const reminders = this.reminders.filter((item) => item.id !== id);
    this.save(reminders);
    this.reminders = reminders;
    this.retryAfter.delete(id);
    return true;
  }

  initScheduler(client) {
    if (this.timer) return;
    this.client = client;

    const check = () => this.processDueReminders().catch((error) => {
      console.error("[Reminder Scheduler] Error:", error);
    });
    this.timer = setInterval(check, 15_000);
    this.timer.unref();
    void check();
    console.log("[Reminder Scheduler] Initialized (UTC+7)");
  }

  async processDueReminders() {
    if (this.processing || !this.client) return;
    this.processing = true;

    try {
      this.load();
      if (this.dirty) this.save(this.reminders);

      const due = this.reminders.filter((reminder) =>
        Date.parse(reminder.nextRunAt) <= this.now() &&
        (this.retryAfter.get(reminder.id) || 0) <= this.now(),
      );

      for (const reminder of due) {
        let nextRunAt;
        try {
          const channel = await this.client.channels.fetch(reminder.channelId);
          if (!channel?.isSendable()) {
            throw new Error(`Channel ${reminder.channelId} is not sendable.`);
          }
          // A reminder may have been deleted while the channel was being fetched.
          if (!this.reminders.some((item) => item.id === reminder.id)) continue;

          nextRunAt = getNextRunAt(reminder.nextRunAt, reminder.interval, this.now());
          const embed = new EmbedBuilder()
            .setColor("#57F287")
            .setTitle("Reminder")
            .setDescription(reminder.note)
            .setFooter({ text: `Interval: ${reminder.interval}` });

          if (nextRunAt) {
            const unixTime = Math.floor(Date.parse(nextRunAt) / 1000);
            embed.addFields({ name: "Next Reminder", value: `<t:${unixTime}:R>` });
          }

          await channel.send({
            content: `<@${reminder.userId}>`,
            embeds: [embed],
            allowedMentions: { parse: [], users: [reminder.userId] },
          });
        } catch (error) {
          this.retryAfter.set(reminder.id, this.now() + 60_000);
          console.error(`[Reminder Scheduler] Delivery failed (${reminder.id}):`, error);
          continue;
        }

        this.retryAfter.delete(reminder.id);
        this.reminders = nextRunAt
          ? this.reminders.map((item) => item.id === reminder.id ? { ...item, nextRunAt } : item)
          : this.reminders.filter((item) => item.id !== reminder.id);
        // Retain the delivery in memory if disk writes fail, then retry the save.
        this.dirty = true;
        this.save(this.reminders);
      }
    } finally {
      this.processing = false;
    }
  }
}

module.exports = {
  INTERVALS,
  TIMEZONE,
  parseReminderTime,
  getNextRunAt,
  ReminderScheduler,
  scheduler: new ReminderScheduler(),
};
