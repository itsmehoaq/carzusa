const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");

const PLATFORM_CONFIG = [
  {
    platform: "hsr",
    name: "Honkai: Star Rail",
    redeemUrl: (code) => `https://hsr.hoyoverse.com/gift?code=${code}`,
    baseUrl: "https://hsr.hoyoverse.com/gift",
    icon: "https://s.hoaq.works/Sticker_PPG_15_Pom-Pom_01.webp",
  },
  {
    platform: "genshin",
    name: "Genshin Impact",
    redeemUrl: (code) => `https://genshin.hoyoverse.com/en/gift?code=${code}`,
    baseUrl: "https://genshin.hoyoverse.com/en/gift",
    icon: "https://s.hoaq.works/Icon_Emoji_CFFA_Gifts.webp",
  },
  {
    platform: "zzz",
    name: "Zenless Zone Zero",
    redeemUrl: (code) =>
      `https://zenless.hoyoverse.com/redemption?code=${code}`,
    baseUrl: "https://zenless.hoyoverse.com/redemption",
    icon: "https://s.hoaq.works/NPC_Eous.webp",
  },
  {
    platform: "cnuy",
    name: "Blue Archive",
    redeemUrl: (code) => `https://mcoupon.nexon.com/bluearchive`,
    baseUrl: "https://mcoupon.nexon.com/bluearchive",
    icon: "https://s.hoaq.works/Arona_Icon.webp",
  },
];

const PLATFORM_CHOICES = PLATFORM_CONFIG.map((p) => ({
  name: p.name,
  value: p.platform,
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName("redeem")
    .setDescription(
      "Chia sẻ code redeem cho game (trong danh sách bot support)",
    )
    .addStringOption((option) =>
      option
        .setName("platform")
        .setDescription("Select game")
        .setRequired(true)
        .addChoices(...PLATFORM_CHOICES),
    )
    .addStringOption((option) =>
      option.setName("code").setDescription("Redeem code").setRequired(true),
    )
    .addBooleanOption((option) =>
      option
        .setName("prefill")
        .setDescription("Use pre-filled URL if available")
        .setRequired(false),
    ),

  async execute(interaction) {
    const platformVal = interaction.options.getString("platform");
    const code = interaction.options.getString("code");
    const prefill = interaction.options.getBoolean("prefill") ?? false;

    const platformConfig = PLATFORM_CONFIG.find(
      (game) => game.platform === platformVal,
    );

    if (!platformConfig)
      return interaction.reply({
        content: "Invalid platform selected.",
        ephemeral: true,
      });

    const redeemLink = prefill
      ? platformConfig.redeemUrl(code)
      : platformConfig.baseUrl;

    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setThumbnail(platformConfig.icon)
      .setTitle(platformConfig.name)
      .setDescription(`New redeem code found`)
      .addFields(
        { name: "Code", value: `\`${code}\``, inline: true },
        { name: "Redeem URL", value: `${redeemLink}` },
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("copy_code")
        .setLabel("Show Redeem Code")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📋"),
      new ButtonBuilder()
        .setLabel(prefill ? "Open Pre-filled Page" : "Open Redeem Page")
        .setStyle(ButtonStyle.Link)
        .setURL(redeemLink),
    );

    const response = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 86_400_000,
    });

    collector.on("collect", async (i) => {
      if (i.customId === "copy_code") {
        await i.reply({ content: `${code}`, ephemeral: true });
      }
    });
  },
};
