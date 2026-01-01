const { SlashCommandBuilder } = require("discord.js");
const moment = require("moment-timezone");

const TIMEZONE_MAPPINGS = {
  VN: "Asia/Ho_Chi_Minh",
  ICT: "Asia/Ho_Chi_Minh",
  JST: "Asia/Tokyo",
  KST: "Asia/Seoul",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  UTC: "UTC",
  GMT: "Etc/GMT",
  CET: "Europe/Paris",
  BST: "Europe/London",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("converttime")
    .setDescription("Convert time from one timezone to another")
    .addStringOption((option) =>
      option
        .setName("time")
        .setDescription("Time to convert (e.g. 0:00)")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("from")
        .setDescription("Source Timezone (e.g. -7, UTC, PST). Default: UTC")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("to")
        .setDescription("Target Timezone (e.g. VN, JST, +7). Default: VN")
        .setRequired(false),
    ),

  async execute(interaction) {
    const timeInput = interaction.options.getString("time");
    const fromInput = (
      interaction.options.getString("from") || "UTC"
    ).toUpperCase();
    const toInput = (interaction.options.getString("to") || "VN").toUpperCase();

    const resolveZone = (input) => {
      if (TIMEZONE_MAPPINGS[input]) return TIMEZONE_MAPPINGS[input];

      if (/^[+-]?\d+$/.test(input)) {
        const offset = parseInt(input);
        if (offset > -16 && offset < 16) {
          const sign = offset >= 0 ? "+" : "-";
          const abs = Math.abs(offset).toString().padStart(2, "0");
          return `UTC${sign}${abs}:00`;
        }
      }

      return input;
    };

    const sourceZone = resolveZone(fromInput);
    const targetZone = resolveZone(toInput);

    if (!moment.tz.zone(sourceZone) && !sourceZone.startsWith("UTC")) {
      return interaction.reply({
        content: `❌ Invalid Source: \`${fromInput}\``,
        ephemeral: true,
      });
    }
    if (!moment.tz.zone(targetZone) && !targetZone.startsWith("UTC")) {
      return interaction.reply({
        content: `❌ Invalid Target: \`${toInput}\``,
        ephemeral: true,
      });
    }

    let baseTime;

    const formats = ["HH:mm", "H:mm", "YYYY-MM-DD HH:mm", "DD/MM/YYYY HH:mm"];
    if (sourceZone.startsWith("UTC")) {
      baseTime = moment.tz(timeInput, formats, sourceZone);
    } else {
      baseTime = moment.tz(timeInput, formats, sourceZone);
    }

    if (!baseTime.isValid()) {
      return interaction.reply({
        content: `❌ Invalid time format. Try \`0:00\`.`,
        ephemeral: true,
      });
    }

    const convertedTime = baseTime.clone().tz(targetZone);

    const dayDiff = convertedTime.dayOfYear() - baseTime.dayOfYear();
    let dayDiffString = "";

    const yearDiff = convertedTime.year() - baseTime.year();

    if (yearDiff > 0 || (yearDiff === 0 && dayDiff > 0)) {
      dayDiffString = " (Next Day)";
    } else if (yearDiff < 0 || (yearDiff === 0 && dayDiff < 0)) {
      dayDiffString = " (Previous Day)";
    }

    await interaction.reply(
      `\`${baseTime.format("HH:mm")} ${fromInput}\` \u2192 \`${convertedTime.format("HH:mm")}\`${dayDiffString} ${toInput} Time`,
    );
  },
};
