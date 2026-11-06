const { Events, EmbedBuilder } = require("discord.js");
const db = require("../utils/db");

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content;

    const urlMatch = content.match(
      /https?:\/\/(www\.)?(twitter|x|fixupx|cunnyx|vxtwitter|fxtwitter)\.com\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/,
    );

    if (urlMatch && !content.includes("||")) {
      const username = urlMatch[3];
      const tweetId = urlMatch[4];

      const matchEndIndex = urlMatch.index + urlMatch[0].length;
      const urlTail = content.slice(matchEndIndex).match(/^[^\s<>]*/)?.[0] || "";
      const normalizedUrlTail = urlTail.replace(/[.,!?;:)]$/, "");
      const isMediaSpecific = /^\/(photo|video)\/\d+/.test(normalizedUrlTail);
      const isEn =
        /^\/en(?:$|[/?#])/.test(normalizedUrlTail) ||
        /^\?[^#]*\/en(?:$|[/?#])/.test(normalizedUrlTail);

      const isGenericI = username === "i";

      const uniqueKey = `${username}/status/${tweetId}`;
      let fixedUrl = `https://fixupx.com/${username}/status/${tweetId}`;

      if (isEn) {
        fixedUrl += "/en";
      }

      const guildId = message.guild.id;
      const channelId = message.channel.id;
      const messageId = message.id;
      const userId = message.author.id;

      const sendFixMessage = async () => {
        let msgContent = `[Tweet \u25b8 @${username}](${fixedUrl})`;
        if (isGenericI) {
          msgContent = ` -# [Original Tweet](${fixedUrl})`;
        }

        const tipText =
          "\n\n-# Did you know: adding `/en` to the end of the URL can translate the post to :flag_gb: English? ";

        try {
          await message.suppressEmbeds(true);
        } catch (e) {}

        const reply = await message.reply({
          content: msgContent + tipText,
          allowedMentions: { repliedUser: false },
        });

        setTimeout(() => {
          reply.edit({ content: msgContent }).catch(() => {});
        }, 10000);
      };

      if (isMediaSpecific) {
        await sendFixMessage();
        return;
      }

      if (process.env.DEV_MODE === "true") {
        await sendFixMessage();
        return;
      }

      const { rows, error } = await db.query(
        `INSERT INTO twitter_reposts
          (guild_id, tweet_key, first_user_id, first_channel_id, first_message_id, count)
         VALUES ($1, $2, $3, $4, $5, 1)
         ON CONFLICT (guild_id, tweet_key)
         DO UPDATE SET count = twitter_reposts.count + 1, updated_at = NOW()
         RETURNING id, guild_id, tweet_key, first_user_id, first_channel_id,
                   first_message_id, count, (xmax = 0) AS is_first_post`,
        [guildId, uniqueKey, userId, channelId, messageId],
      );
      const record = rows[0];
      if (error || !record || record.is_first_post) {
        if (error) console.error("Twitter repost database error:", error.message);
        await sendFixMessage();
        return;
      }

      if (userId === process.env.OWNER) {
        await sendFixMessage();
        return;
      }

      const originalUser = `<@${record.first_user_id}>`;

      const embed = new EmbedBuilder()
        .setColor("#FFCC00")
        .setTitle("Repost detected")
        .setDescription(`Repost count: **${record.count}**`)
        .addFields({
          name: "First Posted By",
          value: originalUser,
          inline: true,
        });

      if (
        record.first_channel_id &&
        record.first_message_id
      ) {
        const jumpUrl = `https://discord.com/channels/${guildId}/${record.first_channel_id}/${record.first_message_id}`;
        embed.addFields({
          name: "Original Message",
          value: `[Jump to message](${jumpUrl})`,
          inline: true,
        });
      }

      try {
        await message.suppressEmbeds(true);
      } catch (e) {}

      await message.reply({
        embeds: [embed],
        allowedMentions: { repliedUser: true },
      });
    }
  },
};
