const cron = require("node-cron");
const moment = require("moment-timezone");
const fs = require("fs");
const path = require("path");
const {
  fetchTrackedGasPrices,
  withDiffs,
  pricesUnchanged,
  buildGasEmbeds,
} = require("./gasApi");

let client = null;

function initScheduler(discordClient) {
  client = discordClient;
  
  const isDev = process.env.DEV_MODE === "true";
  
  const cronExpression = "0 15 * * 4";
  const timezone = "Asia/Bangkok";
  
  console.log("\n=== Gas Price Scheduler Initialized ===");
  console.log(`Schedule: Every Thursday at 3:00 PM ${timezone} (UTC+7)`);
  console.log(`Current time: ${moment().tz(timezone).format("YYYY-MM-DD HH:mm:ss")}`);
  console.log("=======================================\n");

  cron.schedule(
    cronExpression,
    async () => {
      const now = moment().tz(timezone);
      console.log(`\n[Gas Scheduler] Triggered at: ${now.format("YYYY-MM-DD HH:mm:ss")} ${timezone}`);
      
      try {
        await checkAndAnnounceGasPrices();
      } catch (error) {
        console.error("[Gas Scheduler] Error during execution:", error);
      }
    },
    {
      scheduled: true,
      timezone: timezone,
    }
  );
}

function getNextThursday3PM() {
  const timezone = "Asia/Bangkok";
  let next = moment().tz(timezone);
  
  next.hour(15).minute(0).second(0).millisecond(0);
  
  if (next.day() !== 4 || next.isBefore(moment().tz(timezone))) {
    const daysUntilThursday = (4 - next.day() + 7) % 7 || 7;
    next.add(daysUntilThursday, 'days');
  }
  
  return next;
}

async function checkAndAnnounceGasPrices() {
  console.log("[Gas Scheduler] Starting automated gas price check...");
  
  const isDev = process.env.DEV_MODE === "true";
  const guildId = process.env.GAS_NOTIFY_GUILD_ID;
  const channelId = process.env.GAS_NOTIFY_CHANNEL_ID;

  if (!guildId || !channelId) {
    console.error("Missing config: GAS_NOTIFY_GUILD_ID or GAS_NOTIFY_CHANNEL_ID");
    return;
  }

  const dataDir = path.join(__dirname, "../data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  const pricesDataPath = path.join(dataDir, "prices.json");

  try {
    const currentData = await fetchTrackedGasPrices();

    if (!currentData) {
      console.log("[Gas Scheduler] No data available from API");
      return;
    }

    let prevData = null;
    if (fs.existsSync(pricesDataPath)) {
      try {
        const fileContent = fs.readFileSync(pricesDataPath, "utf-8");
        prevData = JSON.parse(fileContent);
      } catch (e) {
        console.log("[Gas Scheduler] Error reading previous data:", e.message);
      }
    }

    if (!isDev && pricesUnchanged(currentData, prevData)) {
      console.log("[Gas Scheduler] Prices unchanged, skipping announcement");
      return;
    }

    const items = withDiffs(currentData, prevData);

    fs.writeFileSync(
      pricesDataPath,
      JSON.stringify(currentData, null, 2),
      "utf-8"
    );

    const sent = await sendAnnouncement(items, channelId);

    if (sent) {
      console.log("[Gas Scheduler] Automated announcement sent successfully!");
    } else {
      console.error("[Gas Scheduler] Failed to send announcement. Check logs.");
    }
  } catch (error) {
    console.error("[Gas Scheduler] API Error:", error.message);
  }
}

async function sendAnnouncement(items, channelId) {
  const guildId = process.env.GAS_NOTIFY_GUILD_ID;
  const isDev = process.env.DEV_MODE === "true";

  if (!client) {
    console.error("[Gas Scheduler] Discord client not initialized");
    return false;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.error(`[Gas Scheduler] Bot not in target guild: ${guildId}`);
    return false;
  }

  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    console.error(
      `[Gas Scheduler] Channel ${channelId} not found in guild ${guildId}`
    );
    return false;
  }

  const embeds = buildGasEmbeds(items, isDev);

  try {
    await channel.send({
      content:
        "@everyone **ᴘɪɴ ᴘᴏɴ ᴘᴀɴ ᴘᴏɴ**\n**Update giá xăng trong nước, theo kỳ điều chỉnh được áp dụng từ 15h chiều hôm nay như sau:**",
      embeds: embeds,
    });
    return true;
  } catch (e) {
    console.error("Send gas price failed:", e);
    return false;
  }
}

module.exports = { initScheduler };
