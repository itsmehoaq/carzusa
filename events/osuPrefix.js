const { Events } = require("discord.js");
const { parsePrefixCommand } = require("../utils/osu/prefixParser");
const { createMessageInteraction } = require("../utils/osu/messageInteractionAdapter");
const { executeOsu } = require("../utils/osu/commandHandlers");

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author?.bot) return;
    if (!message.content) return;

    const parsed = parsePrefixCommand(message.content);
    if (!parsed) return;

    const interaction = createMessageInteraction(message, parsed.command, parsed.options);
    try {
      await executeOsu(interaction, parsed.command);
    } catch (error) {
      console.error("Error executing osu! prefix command:", error);
    }
  },
};
