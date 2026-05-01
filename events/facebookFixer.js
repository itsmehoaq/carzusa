const { Events, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { scrapePost, extractFacebookUrl, validateCookies } = require("../utils/facebook");

const processingCache = new Set();

const COLORS = {
  FACEBOOK: 0x0866ff,
  REEL: 0xff8a00,
  ERROR: 0xed4245,
};

const FB_ICON =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Facebook_Logo_%282019%29.png/600px-Facebook_Logo_%282019%29.png";

const trimText = (text, limit) => {
  if (!text || text.length <= limit) return text || "";
  return `${text.slice(0, limit - 1).trimEnd()}…`;
};

const getFileName = (prefix, index, extension) => {
  const cleanExtension = extension?.startsWith(".") ? extension.slice(1) : extension || "jpg";
  return `${prefix}${index > 1 ? index : ""}.${cleanExtension}`;
};

module.exports = {
  name: Events.MessageCreate,

  execute: async (message) => {
    if (message.author.bot || !message.guild) return;

    const fbUrl = extractFacebookUrl(message.content);
    if (!fbUrl) return;

    const cacheKey = `${message.channelId}-${fbUrl}`;
    if (processingCache.has(cacheKey)) return;
    processingCache.add(cacheKey);
    setTimeout(() => processingCache.delete(cacheKey), 30000);

    if (!validateCookies()) return;

    try {
      await message.channel.sendTyping();

      const result = await scrapePost(fbUrl);

      if (result.error) {
        console.error(`[FacebookFixer] Error: ${result.error}`);
        return;
      }

      if (result.files.length === 0 && !result.message) return;

      try {
        await message.suppressEmbeds(true);
      } catch {}

      const images = [];
      const videos = [];
      for (const file of result.files) {
        const ext = file.extension?.toLowerCase() || "";
        if (["mp4", "mov", "webm"].includes(ext)) {
          videos.push(file);
        } else {
          images.push(file);
        }
      }

      const footerParts = [];
      if (result.likes && result.likes !== "null") footerParts.push(`❤️ ${result.likes}`);
      if (result.comments && result.comments !== "null") footerParts.push(`💬 ${result.comments}`);
      if (result.shares && result.shares !== "null") footerParts.push(`🔁 ${result.shares}`);
      if (result.skippedLargeFiles > 0) footerParts.push(`⚠️ ${result.skippedLargeFiles} file(s) too large`);
      const footerText = footerParts.length > 0 ? footerParts.join(" • ") : null;

      const embedColor = result.isReel ? COLORS.REEL : COLORS.FACEBOOK;

      let authorDisplay = result.authorName || result.postInfo?.title || "Facebook";
      if (result.groupName) {
        authorDisplay = `${result.authorName || "Unknown"} › ${result.groupName}`;
      }

      const displayMessage = trimText(result.message, 4000);
      const postUrl = result.postInfo?.url || fbUrl;
      const label = result.isReel ? "Facebook Reel" : "Facebook Post";

      if (videos.length > 0) {
        const videoAttachments = videos.map((v, i) => new AttachmentBuilder(v.buffer, { name: getFileName("video", i + 1, v.extension) }));

        const contentLines = [`**${label} · ${authorDisplay}**`];
        if (displayMessage) contentLines.push(displayMessage);
        if (footerText) contentLines.push(`\n${footerText}`);

        const content = trimText(contentLines.join("\n"), 2000);

        await message.reply({
          content,
          files: videoAttachments,
          allowedMentions: { repliedUser: false },
        });

        if (images.length > 0) {
          const imageAttachments = images.map((img, i) => new AttachmentBuilder(img.buffer, { name: getFileName("image", i + 1, img.extension) }));
          await message.channel.send({ files: imageAttachments });
        }
        return;
      }

      if (images.length > 0) {
        const firstImageName = getFileName("image", 1, images[0].extension);
        const firstImageAttachment = new AttachmentBuilder(images[0].buffer, { name: firstImageName });

        const mainEmbed = new EmbedBuilder()
          .setColor(embedColor)
          .setAuthor({ name: `${label} · ${authorDisplay}`, url: postUrl, iconURL: FB_ICON })
          .setURL(postUrl)
          .setImage(`attachment://${firstImageName}`);

        if (displayMessage) {
          mainEmbed.setDescription(displayMessage);
        }

        if (footerText) {
          mainEmbed.setFooter({ text: footerText });
        }

        if (result.postDate) {
          mainEmbed.setTimestamp(result.postDate * 1000);
        }

        const embeds = [mainEmbed];
        const files = [firstImageAttachment];

        for (let i = 1; i < Math.min(images.length, 4); i++) {
          const imgName = getFileName("image", i + 1, images[i].extension);
          const imgAttachment = new AttachmentBuilder(images[i].buffer, { name: imgName });
          const galleryEmbed = new EmbedBuilder()
            .setURL(postUrl)
            .setImage(`attachment://${imgName}`);
          embeds.push(galleryEmbed);
          files.push(imgAttachment);
        }

        await message.reply({
          embeds,
          files,
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      if (displayMessage) {
        const textEmbed = new EmbedBuilder()
          .setColor(embedColor)
          .setAuthor({ name: `${label} · ${authorDisplay}`, url: postUrl, iconURL: FB_ICON })
          .setDescription(displayMessage)
          .setURL(postUrl);

        if (footerText) {
          textEmbed.setFooter({ text: footerText });
        }

        if (result.postDate) {
          textEmbed.setTimestamp(result.postDate * 1000);
        }

        await message.reply({
          embeds: [textEmbed],
          allowedMentions: { repliedUser: false },
        });
      }
    } catch (err) {
      console.error("[FacebookFixer] Error:", err.message);
    }
  },
};
