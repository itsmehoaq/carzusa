const { Events, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const facebook = require("../utils/facebook");

const processingCache = new Set();
const CACHE_TTL = 30000;

module.exports = {
  name: Events.MessageCreate,

  async execute(message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content;

    const fbUrl = facebook.extractFacebookUrl(content);
    if (!fbUrl) return;

    const cacheKey = `${message.id}-${fbUrl}`;
    if (processingCache.has(cacheKey)) return;
    processingCache.add(cacheKey);
    setTimeout(() => processingCache.delete(cacheKey), CACHE_TTL);

    if (!facebook.validateCookies()) {
      return;
    }

    try {
      await message.channel.sendTyping();

      const result = await facebook.scrapePost(fbUrl);

      if (result.error) {
        console.error(`[FacebookFixer] Error: ${result.error}`);
        if (process.env.DEV_MODE === "true") {
          const errorEmbed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle("⚠️ Facebook Fixer Error")
            .setDescription(`Could not fetch Facebook content: ${result.error}`)
            .setTimestamp();
          
          await message.reply({
            embeds: [errorEmbed],
            allowedMentions: { repliedUser: false },
          });
        }
        return;
      }

      if (result.files.length === 0 && !result.message) {
        console.log("[FacebookFixer] No content found for:", fbUrl);
        return;
      }

      const images = [];
      const videos = [];
      
      result.files.forEach((file, index) => {
        const filename = `fb_media_${index + 1}_${+ Date.now()}.${file.extension}`;
        const attachment = new AttachmentBuilder(file.buffer, { name: filename });
        
        if (["mp4", "mov", "webm"].includes(file.extension.toLowerCase())) {
          videos.push({ attachment, filename });
        } else {
          images.push({ attachment, filename });
        }
      });

      try {
        await message.suppressEmbeds(true);
      } catch (e) {}

      if (videos.length > 0) {
        let videoContent = "";
        if (result.message) {
          const truncatedMsg = result.message.length > 1800
            ? result.message.substring(0, 1800) + `... [View more](${fbUrl})`
            : result.message;
          videoContent = truncatedMsg;
        }
        
        const footerParts = [];
        footerParts.push(`[Facebook](<${fbUrl}>)`);
        if (result.skippedLargeFiles > 0) {
          footerParts.push(`${result.skippedLargeFiles} file(s) skipped (>25MB)`);
        }
        
        if (videoContent) {
          videoContent += `\n\n-# ${footerParts.join(" • ")}`;
        } else {
          videoContent = `-# ${footerParts.join(" • ")}`;
        }
        
        await message.reply({
          content: videoContent,
          files: videos.map(v => v.attachment),
          allowedMentions: { repliedUser: false },
        });
        
        if (images.length > 0) {
          const imageEmbed = new EmbedBuilder()
            .setColor("#1877F2")
            .setImage(`attachment://${images[0].filename}`);
          
          if (images.length > 1) {
            imageEmbed.setFooter({ text: `+${images.length - 1} more image(s)` });
          }
          
          await message.channel.send({
            embeds: [imageEmbed],
            files: [images[0].attachment],
          });
        }
      } else if (images.length > 0) {
        const embed = new EmbedBuilder()
          .setColor("#1877F2")
          .setAuthor({
            name: "Facebook link",
            url: fbUrl,
          })
          .setImage(`attachment://${images[0].filename}`)
          .setTimestamp();

        if (result.message) {
          const truncatedMsg = result.message.length > 4096 
            ? result.message.substring(0, 4093) + "..."
            : result.message;
          embed.setDescription(truncatedMsg);
        }

        const footerParts = [];
        if (images.length > 1) {
          footerParts.push(`+${images.length - 1} more image(s)`);
        }
        if (result.skippedLargeFiles > 0) {
          footerParts.push(`${result.skippedLargeFiles} file(s) skipped (>25MB)`);
        }
        if (footerParts.length > 0) {
          embed.setFooter({ text: footerParts.join(" • ") });
        }

        await message.reply({
          embeds: [embed],
          files: [images[0].attachment],
          allowedMentions: { repliedUser: false },
        });
      } else if (result.message) {
        const embed = new EmbedBuilder()
          .setColor("#1877F2")
          .setAuthor({
            name: "Facebook link",
            url: fbUrl,
          })
          .setDescription(result.message.length > 4096 
            ? result.message.substring(0, 4093) + "..."
            : result.message)
          .setTimestamp();

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false },
        });
      }

    } catch (error) {
      console.error("[FacebookFixer] Unexpected error:", error);
    }
  },
};
