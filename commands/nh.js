const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");
const axios = require("axios");

const API_BASE_URL = process.env.NH_API_BASE_URL || "https://nhentai.net";
const API_PREFIX = "/api/v2";

function buildAuthHeader() {
  if (process.env.NH_USER_TOKEN) return `User ${process.env.NH_USER_TOKEN}`;
  if (process.env.NH_API_KEY) return `Key ${process.env.NH_API_KEY}`;
  return null;
}

function dedupe(items) {
  return [...new Set(items.filter(Boolean))];
}

function buildCoverCandidates(gallery) {
  const mediaId = gallery?.media_id;
  const rawPath = String(gallery?.cover?.path || "").replace(/^\/+/, "");
  const cleanedPath = rawPath.replace(
    /\.(webp|jpg|jpeg|png)\.(webp|jpg|jpeg|png)$/i,
    ".$1",
  );

  const fromMediaId = mediaId
    ? [
        `https://t.nhentai.net/galleries/${mediaId}/cover.webp`,
        `https://t.nhentai.net/galleries/${mediaId}/cover.jpg`,
        `https://t.nhentai.net/galleries/${mediaId}/cover.jpeg`,
        `https://t.nhentai.net/galleries/${mediaId}/cover.png`,
      ]
    : [];

  const fromPath = rawPath
    ? [
        `https://t.nhentai.net/${rawPath}`,
        `https://t.nhentai.net/${cleanedPath}`,
        `https://i.nhentai.net/${rawPath}`,
        `https://i.nhentai.net/${cleanedPath}`,
      ]
    : [];

  return dedupe([...fromMediaId, ...fromPath]);
}

function getGalleryTitle(gallery) {
  const pretty = gallery?.title?.pretty?.trim();
  const english = gallery?.title?.english?.trim();
  const japanese = gallery?.title?.japanese?.trim();
  return pretty || english || japanese || `Book #${gallery?.id ?? "unknown"}`;
}

function truncateField(value, limit = 1024) {
  if (!value) return "None";
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3)}...`;
}

function formatTagList(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "None";
  const joined = tags.map((tag) => tag.name).join(" • ");
  return truncateField(joined);
}

function toAbsoluteUrl(url) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function formatArtistList(artists) {
  if (!Array.isArray(artists) || artists.length === 0) return "None";

  const joined = artists
    .map((artist) => {
      const name = artist?.name || "unknown";
      const url = toAbsoluteUrl(artist?.url);
      return url ? `[${name}](${url})` : name;
    })
    .join(" • ");

  return truncateField(joined);
}

const LANGUAGE_FLAGS = {
  english: "🇬🇧",
  japanese: "🇯🇵",
  chinese: "🇨🇳",
  korean: "🇰🇷",
  spanish: "🇪🇸",
  french: "🇫🇷",
  german: "🇩🇪",
  portuguese: "🇵🇹",
  russian: "🇷🇺",
  vietnamese: "🇻🇳",
  thai: "🇹🇭",
  italian: "🇮🇹",
  polish: "🇵🇱",
};

function formatLanguageList(languages) {
  if (!Array.isArray(languages) || languages.length === 0) return "None";

  const filtered = languages.filter(
    (language) => (language?.name || "").toLowerCase() !== "translated",
  );
  if (filtered.length === 0) return "None";

  const joined = filtered
    .map((language) => {
      const name = language?.name || "unknown";
      const flag = LANGUAGE_FLAGS[name.toLowerCase()];
      return flag ? `${flag} ${name}` : name;
    })
    .join(" • ");

  return truncateField(joined);
}

function normalizeTagName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsAlias(normalizedTag, alias) {
  if (!normalizedTag || !alias) return false;
  if (normalizedTag === alias) return true;
  return ` ${normalizedTag} `.includes(` ${alias} `);
}

const NON_VANILLA_WARNING_RULES = [
  { label: "yaoi", aliases: ["yaoi", "boys love", "shounen ai"] },
  { label: "rape", aliases: ["rape", "forced", "non consensual", "coercion"] },
  { label: "netorare", aliases: ["netorare", "ntr", "cuckold"] },
  {
    label: "mind break",
    aliases: ["mind break", "mindbreak", "mind control", "brainwashing"],
  },
  { label: "humiliation", aliases: ["humiliation", "degradation"] },
  { label: "cheating", aliases: ["cheating", "adultery", "infidelity"] },
  {
    label: "drugs",
    aliases: ["drugs", "drugged", "aphrodisiac", "chloroform", "sedatives"],
  },
  { label: "blackmail", aliases: ["blackmail", "extortion"] },
];

function formatNonVanillaWarnings(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "None";

  const normalizedTags = tags.map((tag) => normalizeTagName(tag?.name));
  const matched = [];

  for (const rule of NON_VANILLA_WARNING_RULES) {
    const hasMatch = normalizedTags.some((tagName) =>
      rule.aliases.some((alias) => containsAlias(tagName, alias)),
    );
    if (hasMatch) matched.push(rule.label);
  }

  if (matched.length === 0) return "None";
  return truncateField(matched.join(" • "));
}

function extFromContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized.includes("image/webp")) return "webp";
  if (normalized.includes("image/jpeg")) return "jpg";
  if (normalized.includes("image/png")) return "png";
  if (normalized.includes("image/gif")) return "gif";
  return "webp";
}

async function fetchCoverAttachment(gallery) {
  const candidates = buildCoverCandidates(gallery);

  for (const url of candidates) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        responseType: "arraybuffer",
        validateStatus: (status) => status === 200,
      });

      const contentType = response.headers?.["content-type"] || "";
      if (!String(contentType).toLowerCase().startsWith("image/")) continue;

      const ext = extFromContentType(contentType);
      const fileName = `cover.${ext}`;
      return {
        fileName,
        attachment: new AttachmentBuilder(Buffer.from(response.data), {
          name: fileName,
        }),
      };
    } catch {
      // Try next candidate URL.
    }
  }

  return null;
}

function splitTagsByType(tags) {
  const grouped = {};
  if (!Array.isArray(tags)) return grouped;

  for (const tag of tags) {
    const type = tag?.type || "tag";
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(tag);
  }

  return grouped;
}

function shouldInline(value, maxLength = 40) {
  return !!value && value.length <= maxLength;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nh")
    .setDescription("Get nhentai book details")
    .addIntegerOption((option) =>
      option
        .setName("bookid")
        .setDescription("Book ID")
        .setRequired(true)
        .setMinValue(1),
    ),

  async execute(interaction) {
    const channel = interaction.channel;
    const isNsfwChannel = Boolean(channel?.nsfw || channel?.parent?.nsfw);
    if (!isNsfwChannel) {
      return interaction.reply({
        content: "channel is not nsfw!",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const bookId = interaction.options.getInteger("bookid", true);
    const authHeader = buildAuthHeader();

    try {
      const response = await axios.get(
        `${API_BASE_URL}${API_PREFIX}/galleries/${bookId}`,
        {
          headers: authHeader ? { Authorization: authHeader } : undefined,
          timeout: 15000,
        },
      );

      const gallery = response.data;
      const groupedTags = splitTagsByType(gallery?.tags);
      const allTags = gallery?.tags || [];
      const title = getGalleryTitle(gallery);
      const artists = formatArtistList(groupedTags.artist);
      const parodies = formatTagList(groupedTags.parody);
      const language = formatLanguageList(groupedTags.language);
      const warningTags = formatNonVanillaWarnings(allTags);
      const otherTags = formatTagList(
        allTags.filter(
          (tag) => !["artist", "parody", "language"].includes(tag?.type),
        ),
      );
      const bookUrl = `${API_BASE_URL}/g/${bookId}/`;
      const coverAttachment = await fetchCoverAttachment(gallery);
      const pages = String(gallery?.num_pages ?? "Unknown");
      const favorites = String(gallery?.num_favorites ?? "Unknown");

      const embed = new EmbedBuilder()
        .setColor("#2B2D31")
        .setTitle(title.slice(0, 256))
        .setURL(bookUrl)
        .addFields(
          { name: "Pages", value: pages, inline: true },
          { name: "Favorites", value: favorites, inline: true },
          { name: "Language", value: truncateField(language), inline: true },
          {
            name: "Artists",
            value: truncateField(artists),
            inline: shouldInline(artists),
          },
          {
            name: "Parodies",
            value: truncateField(parodies),
            inline: shouldInline(parodies),
          },
          {
            name: "Non-vanilla warning",
            value: warningTags,
            inline: false,
          },
          { name: "Tags", value: truncateField(otherTags), inline: false },
        );

      if (coverAttachment) {
        embed.setImage(`attachment://${coverAttachment.fileName}`);
        return interaction.editReply({
          embeds: [embed],
          files: [coverAttachment.attachment],
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const status = error?.response?.status;
      const apiError = error?.response?.data?.error;

      if (status === 404) {
        return interaction.editReply(`Book \`${bookId}\` was not found.`);
      }

      if (status === 401) {
        return interaction.editReply(
          "Unauthorized (401). Check NH API credentials in env.",
        );
      }

      if (status === 429) {
        return interaction.editReply("Rate limited (429). Try again later.");
      }

      return interaction.editReply(
        `Failed to fetch book \`${bookId}\`${apiError ? `: ${apiError}` : "."}`,
      );
    }
  },
};
