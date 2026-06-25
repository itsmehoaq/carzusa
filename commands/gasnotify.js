const { SlashCommandBuilder } = require("discord.js");
const path = require("path");
const fs = require("fs");
const {
  fetchTrackedGasPrices,
  withDiffs,
  pricesUnchanged,
  buildGasEmbeds,
} = require("../utils/gasApi");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gasnotify")
    .setDescription("Manage gas price notifications")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("check")
        .setDescription("Check API for gas price updates (Owner Only)"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("test")
        .setDescription(
          "Preview the announcement embed (no ping, only you see it)",
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("noping")
        .setDescription(
          "Send the announcement without pinging @everyone (Owner Only)",
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("manual")
        .setDescription("Manually set gas prices (Owner Only)")
        .addIntegerOption((o) =>
          o
            .setName("price_ron95v")
            .setDescription("Price RON95-V")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("price_ron95iii")
            .setDescription("Price RON95-III")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("price_e10ron95v")
            .setDescription("Price E10RON95-V")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("price_e10ron95iii")
            .setDescription("Price E10RON95-III")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("price_e5ron92")
            .setDescription("Price E5RON92-II")
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const requiredRoleId = "1058299698374524980";

    if (
      subcommand === "check" ||
      subcommand === "test" ||
      subcommand === "noping"
    ) {
      if (!interaction.member?.roles?.cache?.has(requiredRoleId)) {
        return interaction.reply({
          content: "You are not authorized.",
          ephemeral: true,
        });
      }
    } else if (interaction.user.id !== process.env.OWNER) {
      return interaction.reply({
        content: "You are not authorized.",
        ephemeral: true,
      });
    }
    const dataDir = path.join(__dirname, "../data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    const pricesDataPath = path.join(dataDir, "prices.json");
    const isDev =
      process.env.DEV_MODE === "true" || process.env.DEV_MODE === "1";

    if (subcommand === "check" || subcommand === "noping") {
      const ping = subcommand === "check";
      await interaction.deferReply({ ephemeral: true });

      try {
        const currentData = await fetchTrackedGasPrices();

        if (!currentData) {
          return interaction.editReply("No data available from API.");
        }

        const prevData = readPrevData(pricesDataPath);

        if (!isDev && pricesUnchanged(currentData, prevData)) {
          return interaction.editReply("Data identical to last update.");
        }

        const items = withDiffs(currentData, prevData);

        fs.writeFileSync(
          pricesDataPath,
          JSON.stringify(currentData, null, 2),
          "utf-8",
        );

        const sent = await sendAnnouncement(interaction, items, isDev, ping);

        if (sent) await interaction.editReply("Automated announcement sent!");
        else
          await interaction.editReply(
            "Failed to send announcement. Check logs.",
          );
      } catch (error) {
        console.error("API Error:", error);
        await interaction.editReply("Error fetching prices from API.");
      }
    } else if (subcommand === "test") {
      await interaction.deferReply({ ephemeral: true });

      try {
        const currentData = await fetchTrackedGasPrices();

        if (!currentData) {
          return interaction.editReply("No data available from API.");
        }

        const prevData = readPrevData(pricesDataPath);
        const items = withDiffs(currentData, prevData);
        const embeds = buildGasEmbeds(items, isDev);

        // Preview only: no @everyone ping, no file write, ephemeral so only
        // the invoker sees it.
        await interaction.editReply({
          content:
            "**Preview** — this is what the announcement would look like (no one was pinged):",
          embeds: embeds,
        });
      } catch (error) {
        console.error("API Error:", error);
        await interaction.editReply("Error fetching prices from API.");
      }
    } else if (subcommand === "manual") {
      await interaction.deferReply({ ephemeral: true });

      const gasTitles = [
        "Xăng RON 95-V",
        "Xăng RON 95-III",
        "Xăng E10 RON 95-V",
        "Xăng E10 RON 95-III",
        "Xăng E5 RON 92-II",
      ];
      const newPrices = [
        interaction.options.getInteger("price_ron95v"),
        interaction.options.getInteger("price_ron95iii"),
        interaction.options.getInteger("price_e10ron95v"),
        interaction.options.getInteger("price_e10ron95iii"),
        interaction.options.getInteger("price_e5ron92"),
      ];

      const prevData = readPrevData(pricesDataPath);
      const prevByTitle = new Map((prevData || []).map((p) => [p.title, p]));

      const currentData = gasTitles.map((title, i) => {
        const prev = prevByTitle.get(title);
        return {
          petrolimex_id: prev ? prev.petrolimex_id : null,
          date: prev ? prev.date : new Date().toISOString(),
          title,
          zone1_price: newPrices[i],
          zone2_price: prev ? prev.zone2_price : newPrices[i],
        };
      });

      const items = withDiffs(currentData, prevData);

      fs.writeFileSync(
        pricesDataPath,
        JSON.stringify(currentData, null, 2),
        "utf-8",
      );

      const sent = await sendAnnouncement(interaction, items, isDev);
      if (sent) await interaction.editReply("Manual announcement sent!");
      else await interaction.editReply("Failed to send announcement.");
    }
  },
};

function readPrevData(pricesDataPath) {
  if (!fs.existsSync(pricesDataPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pricesDataPath, "utf-8"));
  } catch (e) {
    console.log("Error reading previous data:", e.message);
    return null;
  }
}

async function sendAnnouncement(interaction, items, isDev, ping = true) {
  const guildId = process.env.GAS_NOTIFY_GUILD_ID;
  const channelId = process.env.GAS_NOTIFY_CHANNEL_ID;

  if (!guildId || !channelId) {
    console.error(
      "Config Missing: GAS_NOTIFY_GUILD_ID or GAS_NOTIFY_CHANNEL_ID",
    );
    return false;
  }

  const guild = interaction.client.guilds.cache.get(guildId);
  if (!guild) {
    console.error(`Bot not in target guild: ${guildId}`);
    return false;
  }

  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    console.error(`Channel ${channelId} not found in guild ${guildId}`);
    return false;
  }

  const embeds = buildGasEmbeds(items, isDev);
  const prefix = ping ? "@everyone **ᴘɪɴ ᴘᴏɴ ᴘᴀɴ ᴘᴏɴ**\n" : "";

  try {
    await channel.send({
      content: `${prefix}**Update giá xăng trong nước, theo kỳ điều chỉnh được áp dụng từ ~~15h chiều hôm nay~~ thời gian ping như sau:**`,
      embeds: embeds,
      allowedMentions: ping ? undefined : { parse: [] },
    });
    return true;
  } catch (e) {
    console.error("Send Failed:", e);
    return false;
  }
}
