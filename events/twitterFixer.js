const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
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

            const matchEndIndex = urlMatch.index + urlMatch[0].length;
            const remainingText = content.slice(matchEndIndex);
            const isMediaSpecific = /^\/(photo|video)\/\d+/.test(remainingText);

            const isGenericI = (username === 'i');

            const uniqueKey = `${username}/status/${tweetId}`;
            const fixedUrl = `https://fixupx.com/${username}/status/${tweetId}`;
            const mediaUrl = `https://d.fixupx.com/${username}/status/${tweetId}`;

            const guildId = message.guild.id;
            const channelId = message.channel.id;
            const messageId = message.id;
            const userId = message.author.id;

            const createButtonRow = (isDisabled) => {
                return new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('Show Media')
                            .setStyle(ButtonStyle.Primary) // Interactive button
                            .setCustomId('show_media')
                            .setDisabled(isDisabled)
                    );
            };

            const sendFixMessage = async () => {
                let msgContent = `[Tweet \u25b8 @${username}](${fixedUrl})`;
                if (isGenericI) {
                    msgContent = ` -# [Original Tweet](${fixedUrl})`;
                }

                try { await message.suppressEmbeds(true); } catch (e) {}

                const reply = await message.reply({
                    content: msgContent,
                    allowedMentions: { repliedUser: false },
                    components: [createButtonRow(false)]
                });

                const collector = reply.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                    time: 900_000
                });

                collector.on('collect', async (i) => {
                    if (i.customId === 'show_media') {
                        let newContent = `[Tweet \u25b8 @${username}](${mediaUrl})`;
                        if (isGenericI) {
                            newContent = ` -# [Original Tweet](${mediaUrl})`;
                        }

                        await i.update({
                            content: newContent
                        });
                    }
                });
            };

            if (isMediaSpecific) {
                await sendFixMessage();
                return;
            }

            const { data: existingRecord } = await supabase
                .from('twitter_reposts')
                .select('*')
                .eq('guild_id', guildId)
                .eq('tweet_key', uniqueKey)
                .single();

            if (existingRecord) {
                const newCount = existingRecord.count + 1;

                supabase.from('twitter_reposts').update({ count: newCount }).eq('id', existingRecord.id).then(()=>{});

                const originalUser = `<@${existingRecord.first_user_id}>`;

                const embed = new EmbedBuilder()
                    .setColor('#FFCC00')
                    .setTitle('Repost detected')
                    .setDescription(`Repost count: **${newCount}**`)
                    .addFields({ name: 'First Posted By', value: originalUser, inline: true });

                if (existingRecord.first_channel_id && existingRecord.first_message_id) {
                    const jumpUrl = `https://discord.com/channels/${guildId}/${existingRecord.first_channel_id}/${existingRecord.first_message_id}`;
                    embed.addFields({ name: 'Original Message', value: `[Jump to message](${jumpUrl})`, inline: true });
                }

                try { await message.suppressEmbeds(true); } catch (e) {}

                await message.reply({
                    embeds: [embed],
                    allowedMentions: { repliedUser: true },
                    components: [createButtonRow(true)] // Disabled Button
                });

            } else {
                await supabase.from('twitter_reposts').insert([{
                    guild_id: guildId,
                    tweet_key: uniqueKey,
                    first_user_id: userId,
                    first_channel_id: channelId,
                    first_message_id: messageId,
                    count: 1
                }]);

                await sendFixMessage();
            }
        }
    },
};