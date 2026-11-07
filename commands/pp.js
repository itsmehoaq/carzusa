const { SlashCommandBuilder } = require("discord.js");
const { configureCommand } = require("../utils/osu/commandOptions");
const { executeOsu } = require("../utils/osu/commandHandlers");

module.exports = {
  data: configureCommand(new SlashCommandBuilder().setName("pp"), "pp"),
  execute: (interaction) => executeOsu(interaction, "pp"),
};
