const { SlashCommandBuilder } = require("discord.js");
const { configureCommand, DESCRIPTIONS } = require("../utils/osu/commandOptions");
const { executeOsu } = require("../utils/osu/commandHandlers");

const data = new SlashCommandBuilder().setName("osu").setDescription("osu! profiles, scores, maps, and tournament tools");
for (const name of Object.keys(DESCRIPTIONS)) data.addSubcommand((command) => configureCommand(command.setName(name), name));

module.exports = { data, execute: executeOsu };
