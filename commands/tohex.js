const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tohex")
    .setDescription("Convert text to hex")
    .addStringOption((option) =>
      option
        .setName("input")
        .setDescription("Text to convert")
        .setRequired(true),
    ),

  async execute(interaction) {
    const input = interaction.options.getString("input");

    const hexString = input
      .split("")
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");

    await interaction.reply(`${hexString}`);
  },
};
