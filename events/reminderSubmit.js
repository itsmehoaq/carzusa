const { Events, MessageFlags } = require("discord.js");
const reminder = require("../commands/reminder");

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (interaction.isAutocomplete?.() && interaction.commandName === "reminder") {
      try {
        await reminder.autocomplete(interaction);
      } catch (error) {
        console.error("[Reminder] Autocomplete failed:", error);
        if (!interaction.responded) await interaction.respond([]);
      }
      return;
    }
    if (!interaction.isModalSubmit() || interaction.customId !== reminder.MODAL_ID) return;

    try {
      await reminder.handleModalSubmit(interaction);
    } catch (error) {
      console.error("[Reminder] Could not create reminder:", error);
      const content = "Could not save your reminder. Please try again later.";
      if (interaction.deferred) await interaction.editReply({ content });
      else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  },
};
