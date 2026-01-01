const { Events } = require("discord.js");

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;

    const botId = message.client.user.id;
    const mentionRegex = new RegExp(`^<@!?${botId}>$`);

    if (mentionRegex.test(message.content.trim())) {
      try {
        const sent = await message.reply({
          content: "Pinging...",
          allowedMentions: { repliedUser: false },
        });

        const roundtripLatency =
          sent.createdTimestamp - message.createdTimestamp;

        await sent.edit(`Pong! \nRoundtrip Latency: **${roundtripLatency}ms**`);

        setTimeout(async () => {
          try {
            await sent.delete().catch(() => {});

            await message.delete().catch(() => {});
          } catch (e) {}
        }, 10_000);
      } catch (error) {
        console.error("Error in mentionPong:", error);
      }
    }
  },
};
