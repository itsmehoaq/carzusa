const {
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const moment = require("moment-timezone");
const { INTERVALS, TIMEZONE, parseReminderTime, scheduler } = require("../utils/reminderScheduler");

const MODAL_ID = "reminder:create";

function canSendReminders(interaction) {
  const channel = interaction.channel;
  if (!channel?.isSendable()) return false;
  if (!interaction.inGuild()) return true;
  return interaction.appPermissions?.has([
    PermissionFlagsBits.ViewChannel,
    channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ]) === true;
}

module.exports = {
  MODAL_ID,
  data: new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Create a reminder in this channel (UTC+7)"),

  async execute(interaction) {
    if (!canSendReminders(interaction)) {
      return interaction.reply({
        content: "I need permission to send messages and embed links in this channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle("Create Reminder")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("Time (UTC+7)")
          .setDescription("HH:mm for the next occurrence, or YYYY-MM-DD HH:mm for a specific date.")
          .setTextInputComponent(new TextInputBuilder()
            .setCustomId("time")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("18:30 or 2026-12-01 18:30")
            .setRequired(true)
            .setMinLength(4)
            .setMaxLength(16)),
        new LabelBuilder()
          .setLabel("Interval")
          .setStringSelectMenuComponent(new StringSelectMenuBuilder()
            .setCustomId("interval")
            .setPlaceholder("Select an interval")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(Object.keys(INTERVALS).map((value) => ({ label: value, value })))),
        new LabelBuilder()
          .setLabel("Note")
          .setTextInputComponent(new TextInputBuilder()
            .setCustomId("note")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(4000)),
      );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    if (!canSendReminders(interaction)) {
      return interaction.reply({
        content: "I need permission to send messages and embed links in this channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const time = interaction.fields.getTextInputValue("time");
    const [interval] = interaction.fields.getStringSelectValues("interval");
    const note = interaction.fields.getTextInputValue("note").trim();
    let nextRunAt;
    try {
      if (!note || note.length > 4000) throw new Error("Enter a note between 1 and 4000 characters.");
      nextRunAt = parseReminderTime(time, interval);
    } catch (error) {
      return interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    scheduler.addReminder({
      id: interaction.id,
      userId: interaction.user.id,
      channelId: interaction.channelId,
      interval,
      note,
      nextRunAt,
    });

    const unixTime = Math.floor(Date.parse(nextRunAt) / 1000);
    await interaction.editReply({
      content: `Reminder set in <#${interaction.channelId}> for <t:${unixTime}:F> (<t:${unixTime}:R>).`,
      embeds: [new EmbedBuilder()
        .setColor("#57F287")
        .setTitle("Reminder Scheduled")
        .setDescription(note)
        .addFields(
          { name: "Time (UTC+7)", value: moment.tz(nextRunAt, TIMEZONE).format("YYYY-MM-DD HH:mm"), inline: true },
          { name: "Interval", value: interval, inline: true },
        )],
      allowedMentions: { parse: [] },
    });
  },
};
