const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const moment = require("moment-timezone");

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
            .setName("price_e5ron92")
            .setDescription("Price E5RON92-II")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("price_e10ron95")
            .setDescription("Price E10RON95-III")
            .setRequired(true),
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
    const pricesDataPath = path.join(dataDir, "prices.json");
    const isDev =
      process.env.DEV_MODE === "true" || process.env.DEV_MODE === "1";

    if (subcommand === "check") {
      await interaction.deferReply({ ephemeral: true });
      
      const today = moment().format("YYYY-MM-DD");
      const API_URL = `https://giaxanghomnay.com/api/pvdate/${today}`;

      try {
        const response = await axios.get(API_URL);
        const data = response.data;

        if (!data || !data[0] || data[0].length < 4) {
          return interaction.editReply("No data available from API for today.");
        }

        const petrolimexData = data[0];
        
        const currentData = [
          petrolimexData[2], 
          petrolimexData[1], 
          petrolimexData[0], 
          petrolimexData[3], 
        ];
        let prevData = null;
        if (fs.existsSync(pricesDataPath)) {
          try {
            const fileContent = fs.readFileSync(pricesDataPath, "utf-8");
            prevData = JSON.parse(fileContent);
          } catch (e) {
            console.log("Error reading previous data, will overwrite:", e.message);
          }
        }

        if (!isDev && prevData && fs.existsSync(pricesDataPath)) {
          const isIdentical = currentData.every((item, i) => 
            prevData[i] && item.zone1_price === prevData[i].zone1_price
          );
          if (isIdentical) {
            return interaction.editReply("Data identical to last update.");
          }
        }

        const diffs = currentData.map((item, i) => {
          if (prevData && prevData[i]) {
            return item.zone1_price - prevData[i].zone1_price;
          }
          return 0;
        });

        fs.writeFileSync(
          pricesDataPath, 
          JSON.stringify(currentData, null, 2), 
          "utf-8"
        );

        const sent = await sendAnnouncement(
          interaction,
          currentData,
          diffs,
        );

        if (sent) await interaction.editReply("Automated announcement sent!");
        else
          await interaction.editReply(
            "Failed to send announcement. Check logs.",
          );
      } catch (error) {
        console.error("API Error:", error);
        await interaction.editReply("Error fetching prices from API.");
      }
    } else if (subcommand === "manual") {
      await interaction.deferReply({ ephemeral: true });
      
      const newPrices = [
        interaction.options.getInteger("price_e5ron92"),
        interaction.options.getInteger("price_ron95iii"),
        interaction.options.getInteger("price_ron95v"),
        interaction.options.getInteger("price_e10ron95"),
      ];

      const gasTitles = [
        "Xăng E5 RON 92-II",
        "Xăng RON 95-III",
        "Xăng RON 95-V",
        "Xăng E10 RON 95-III",
      ];

      let prevData = null;
      if (fs.existsSync(pricesDataPath)) {
        try {
          const fileContent = fs.readFileSync(pricesDataPath, "utf8");
          prevData = JSON.parse(fileContent);
        } catch (e) {
          console.log("Error reading previous data:", e.message);
        }
      }

      const diffs = newPrices.map((newPrice, i) => {
        if (prevData && prevData[i]) {
          return newPrice - prevData[i].zone1_price;
        }
        return 0;
      });

      const today = moment().format("YYYY-MM-DD");
      const currentData = newPrices.map((price, i) => ({
        id: prevData && prevData[i] ? prevData[i].id : null,
        created_at: prevData && prevData[i] ? prevData[i].created_at : new Date().toISOString(),
        updated_at: new Date().toISOString(),
        petrolimex_id: prevData && prevData[i] ? prevData[i].petrolimex_id : null,
        date: `${today} 00:00:00`,
        title: gasTitles[i],
        zone1_price: price,
        zone2_price: prevData && prevData[i] ? prevData[i].zone2_price : price,
      }));

      fs.writeFileSync(
        pricesDataPath, 
        JSON.stringify(currentData, null, 2), 
        "utf-8"
      );

      const sent = await sendAnnouncement(interaction, currentData, diffs);
      if (sent) await interaction.editReply("Manual announcement sent!");
      else await interaction.editReply("Failed to send announcement.");
    }
  },
};

async function sendAnnouncement(interaction, gasData, diffs) {
  const guildId = process.env.GAS_NOTIFY_GUILD_ID;
  const channelId = process.env.GAS_NOTIFY_CHANNEL_ID;
  const isDev = process.env.DEV_MODE === "true";

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

  const upEmoji = isDev ? "<:up_small:1465930784685690922>" : "<:up_small:1465964979114082314>";
  const downEmoji = isDev ? "<:down_small:1465930783108628552>" : "<:down_small:1465964976823992370>";
  
  const embeds = gasData.map((item, index) => {
    const price = item.zone1_price;
    const diff = diffs[index];
    const displayTitle = item.title.replace(/^Xăng\s+/, "");
    
    const emoji = diff < 0 ? downEmoji : diff > 0 ? upEmoji : "•";
    
    const embedColor = diff < 0 ? "#7be863" : diff > 0 ? "#e85353" : "#808080";
    
    return new EmbedBuilder()
      .setTitle(displayTitle)
      .addFields(
        {
          name: "Giá mới",
          value: `${price.toLocaleString()} ₫/lít`,
          inline: true
        },
        {
          name: "Chênh lệch",
          value: `${emoji} ${Math.abs(diff).toLocaleString()} ₫/lít`,
          inline: true
        }
      )
      .setColor(embedColor);
  });

  try {
    await channel.send({
      content:
        "@everyone **ᴘɪɴ ᴘᴏɴ ᴘᴀɴ ᴘᴏɴ**\n**Update giá xăng trong nước, theo kỳ điều chỉnh được áp dụng từ 15h chiều hôm nay như sau:**",
      embeds: embeds,
    });
    return true;
  } catch (e) {
    console.error("Send Failed:", e);
    return false;
  }
}
