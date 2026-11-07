const { SlashCommandBuilder } = require("discord.js");
const { configureCommand } = require("../utils/osu/commandOptions");
const { executeOsu } = require("../utils/osu/commandHandlers");

module.exports = {
  data: configureCommand(new SlashCommandBuilder().setName("checkname"), "checkname"),
  execute: (interaction) => executeOsu(interaction, "checkname"),
};
