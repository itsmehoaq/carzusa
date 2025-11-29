const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");
const fs = require("fs");
const moment = require("moment");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gasnotify")
    .setDescription("Manage gas price notifications")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("check")
        .setDescription("Check vnexpress for updates (Owner Only)"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("manual")
        .setDescription("Manually set gas prices (Owner Only)")
        .addIntegerOption((o) =>
          o
            .setName("price92")
            .setDescription("Price E5RON92")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o.setName("price95").setDescription("Price RON95").setRequired(true),
        ),
    ),

  async execute(interaction) {
    // Owner Check
    if (interaction.user.id !== process.env.OWNER) {
      return interaction.reply({
        content: "You are not authorized.",
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const dataDir = path.join(__dirname, "../data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    const pricesDataPath = path.join(dataDir, "prices.txt");
    const isDev =
      process.env.DEV_MODE === "true" || process.env.DEV_MODE === "1";

    if (subcommand === "check") {
      await interaction.deferReply({ ephemeral: true });
      const URL = "https://vnexpress.net/chu-de/gia-xang-dau-3026";

      try {
        const response = await axios.get(URL);
        const $ = cheerio.load(response.data);
        const today = moment().format("D/M/YYYY");
        const searchString = `Giá từ ${today}`;
        const table = $("table");
        const rows = table.find("tr");

        let new92Price = null,
          diff92 = null;
        let new95Price = null,
          diff95 = null;
        let isTodayDataAvailable = false;

        rows.each((index, row) => {
          const columns = $(row).find("td");
          if (columns.eq(1).html()?.includes(searchString))
            isTodayDataAvailable = true;

          if (columns.eq(0).text().includes("Xăng E5 RON 92-II")) {
            new92Price = parseInt(columns.eq(1).text().replace(/\D/g, ""), 10);
            const rawDiff = columns.eq(2).text();
            diff92 =
              parseInt(rawDiff.replace(/\D/g, ""), 10) *
              (rawDiff.includes("-") ? -1 : 1);
          }
          if (columns.eq(0).text().includes("Xăng RON 95-III")) {
            new95Price = parseInt(columns.eq(1).text().replace(/\D/g, ""), 10);
            const rawDiff = columns.eq(2).text();
            diff95 =
              parseInt(rawDiff.replace(/\D/g, ""), 10) *
              (rawDiff.includes("-") ? -1 : 1);
          }
        });

        if (!isTodayDataAvailable && !isDev) {
          return interaction.editReply("No new data found for today.");
        }

        if (fs.existsSync(pricesDataPath)) {
          const prev = fs.readFileSync(pricesDataPath, "utf-8").split(",");
          if (!isDev && new92Price == prev[0] && new95Price == prev[1]) {
            return interaction.editReply("Data identical to last update.");
          }
        }

        if (new92Price && new95Price) {
          fs.writeFileSync(
            pricesDataPath,
            `${new92Price},${new95Price}`,
            "utf-8",
          );
          const sent = await sendAnnouncement(
            interaction,
            new92Price,
            diff92,
            new95Price,
            diff95,
          );
          if (sent) await interaction.editReply("Automated announcement sent!");
          else
            await interaction.editReply(
              "Failed to send announcement. Check logs.",
            );
        }
      } catch (error) {
        console.error(error);
        await interaction.editReply("Error fetching prices.");
      }
    } else if (subcommand === "manual") {
      await interaction.deferReply({ ephemeral: true });
      const n92 = interaction.options.getInteger("price92");
      const n95 = interaction.options.getInteger("price95");
      let c92 = n92,
        c95 = n95;

      if (fs.existsSync(pricesDataPath)) {
        const parts = fs.readFileSync(pricesDataPath, "utf8").split(",");
        if (parts.length === 2) {
          c92 = Number(parts[0]);
          c95 = Number(parts[1]);
        }
      }

      fs.writeFileSync(pricesDataPath, `${n92},${n95}`, "utf-8");
      const sent = await sendAnnouncement(
        interaction,
        n92,
        n92 - c92,
        n95,
        n95 - c95,
      );
      if (sent) await interaction.editReply("Manual announcement sent!");
      else await interaction.editReply("Failed to send announcement.");
    }
  },
};

async function sendAnnouncement(interaction, p92, d92, p95, d95) {
  const guildId = process.env.GAS_NOTIFY_GUILD_ID;
  const channelId = process.env.GAS_NOTIFY_CHANNEL_ID;
  const isDev = process.env.DEV_MODE === "true" || process.env.DEV_MODE === "1";

  if (!guildId || !channelId) {
    console.error(
      "Config Missing: GAS_NOTIFY_GUILD_ID or GAS_NOTIFY_CHANNEL_ID",
    );
    return false;
  }

  if (isDev) {
    console.log(
      `DEV_MODE ACTIVE: Strictly sending to Dev Channel (${channelId}) in Guild (${guildId})`,
    );
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

  const embed92 = new EmbedBuilder()
    .setTitle("E5RON92")
    .setColor(d92 < 0 ? "#7be863" : "#e85353")
    .addFields(
      {
        name: "Giá mới",
        value: `${p92.toLocaleString()} đồng/lít`,
        inline: true,
      },
      {
        name: "Chênh lệch",
        value: `${d92 < 0 ? "▼" : "▲"} ${Math.abs(d92).toLocaleString()} đồng/lít`,
        inline: true,
      },
    );

  const embed95 = new EmbedBuilder()
    .setTitle("RON95")
    .setColor(d95 < 0 ? "#7be863" : "#e85353")
    .addFields(
      {
        name: "Giá mới",
        value: `${p95.toLocaleString()} đồng/lít`,
        inline: true,
      },
      {
        name: "Chênh lệch",
        value: `${d95 < 0 ? "▼" : "▲"} ${Math.abs(d95).toLocaleString()} đồng/lít`,
        inline: true,
      },
    );

  try {
    await channel.send({
      content: "@everyone **ᴘɪɴ ᴘᴏɴ ᴘᴀɴ ᴘᴏɴ**\n**Update giá xăng trong nước, theo kỳ điều chỉnh được áp dụng từ 15h chiều hôm nay như sau:**",
      embeds: [embed92, embed95],
    });
    return true;
  } catch (e) {
    console.error("Send Failed:", e);
    return false;
  }
}
