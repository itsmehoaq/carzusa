const { Events, EmbedBuilder } = require('discord.js');
const supabase = require('../utils/supabase');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return;
        if (!message.guild) return;

        const content = message.content;

        const urlMatch = content.match(/https?:\/\/(www\.)?(twitter|x)\.com\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/);

        if (urlMatch && !content.includes("||")) {
            const username = urlMatch[3];
            const tweetId = urlMatch[4];

            const uniqueKey = `${username}/status/${tweetId}`;
            const fixedUrl = `https://fixupx.com/${username}/status/${tweetId}`;

            const guildId = message.guild.id;
            const channelId = message.channel.id;
            const messageId = message.id;
            const userId = message.author.id;

            const { data: existingRecord, error } = await supabase
                .from('twitter_reposts')
                .select('*')
                .eq('guild_id', guildId)
                .eq('tweet_key', uniqueKey)
                .single();

            if (existingRecord) {
                const newCount = existingRecord.count + 1;

                supabase
                    .from('twitter_reposts')
                    .update({ count: newCount })
                    .eq('id', existingRecord.id)
                    .then(({ error }) => {
                        if (error) console.error("Error updating count:", error);
                    });

                const originalUser = `<@${existingRecord.first_user_id}>`;

                const embed = new EmbedBuilder()
                    .setColor('#FFCC00')
                    .setTitle('Repost detected')
                    .setDescription(`Count: **${newCount}**`)
                    .addFields({ name: 'First Posted By', value: originalUser, inline: true });

                if (existingRecord.first_channel_id && existingRecord.first_message_id) {
                    const jumpUrl = `https://discord.com/channels/${guildId}/${existingRecord.first_channel_id}/${existingRecord.first_message_id}`;
                    embed.addFields({ name: 'Original Message', value: `[Jump to message](${jumpUrl})`, inline: true });
                }

                await message.reply({
                    embeds: [embed],
                    allowedMentions: { repliedUser: true }
                });

            } else {
                const { error: insertError } = await supabase
                    .from('twitter_reposts')
                    .insert([
                        {
                            guild_id: guildId,
                            tweet_key: uniqueKey,
                            first_user_id: userId,
                            first_channel_id: channelId,
                            first_message_id: messageId,
                            count: 1
                        }
                    ]);

                if (insertError) {
                    console.error("Supabase Insert Error:", insertError);
                }

                try {
                    await message.suppressEmbeds(true);
                } catch (e) {
                }

                await message.reply({
                    content: `[Tweet \u25b8 @${username}](${fixedUrl})`,
                    allowedMentions: { repliedUser: false }
                });
            }
        }
    },
};