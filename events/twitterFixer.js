const { Events, EmbedBuilder } = require("discord.js");
const supabase = require("../utils/supabase");

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
      const remainingText = content.slice(matchEndIndex);
      const isMediaSpecific = /^\/(photo|video)\/\d+/.test(remainingText);
      const isEn = /\/en($|\?)/.test(remainingText);

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

        const tipText = "\n\n-# Did you know: adding `/en` to the end of the URL to translate the post to :flag_gb: English! ";

        try { await message.suppressEmbeds(true); } catch (e) {}

        const reply = await message.reply({
          content: msgContent + tipText,
          allowedMentions: { repliedUser: false }
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

      const { data: existingRecord } = await supabase
        .from("twitter_reposts")
        .select("*")
        .eq("guild_id", guildId)
        .eq("tweet_key", uniqueKey)
        .single();

      if (existingRecord) {
        const newCount = existingRecord.count + 1;

        supabase
          .from("twitter_reposts")
          .update({ count: newCount })
          .eq("id", existingRecord.id)
          .then(() => {});

        const originalUser = `<@${existingRecord.first_user_id}>`;

        const embed = new EmbedBuilder()
          .setColor("#FFCC00")
          .setTitle("Repost detected")
          .setDescription(`Repost count: **${newCount}**`)
          .addFields({
            name: "First Posted By",
            value: originalUser,
            inline: true,
          });

        if (
          existingRecord.first_channel_id &&
          existingRecord.first_message_id
        ) {
          const jumpUrl = `https://discord.com/channels/${guildId}/${existingRecord.first_channel_id}/${existingRecord.first_message_id}`;
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
      } else {
        await supabase.from("twitter_reposts").insert([
          {
            guild_id: guildId,
            tweet_key: uniqueKey,
            first_user_id: userId,
            first_channel_id: channelId,
            first_message_id: messageId,
            count: 1,
          },
        ]);

        await sendFixMessage();
      }
    }
  },
};
