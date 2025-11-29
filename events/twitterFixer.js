const { Events } = require("discord.js");

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    const content = message.content;

    const urlMatch = content.match(
      /https?:\/\/(www\.)?(twitter|x)\.com\/[a-zA-Z0-9_]+\/status\/[0-9]+/,
    );

    if (urlMatch && !content.includes("||")) {
      const originalUrl = urlMatch[0];

      const username = originalUrl.split("/")[3];

      const fixedUrl = originalUrl
        .replace("twitter.com", "fixupx.com")
        .replace("x.com", "fixupx.com");

      try {
        await message.suppressEmbeds(true);
      } catch (e) {}

      await message.reply({
        content: `[Tweet \u25b8 @${username}](${fixedUrl})`,
        allowedMentions: { repliedUser: false },
      });
    }
  },
};
