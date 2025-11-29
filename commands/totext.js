const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("totext")
    .setDescription("Convert hex to text")
    .addStringOption((option) =>
      option
        .setName("hex")
        .setDescription("Hex string to convert")
        .setRequired(true),
    ),

  async execute(interaction) {
    const hex = interaction.options.getString("hex");

    try {
      const cleanedHex = hex.replace(/\s+/g, "");
      const normalString = cleanedHex
        .match(/.{1,2}/g)
        .map((byte) => String.fromCharCode(parseInt(byte, 16)))
        .join("");

      await interaction.reply(`${normalString}`);
    } catch (error) {
      await interaction.reply({
        content: "Invalid hex string.",
        ephemeral: true,
      });
    }
  },
};
