const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const { getAIReply, formatContentWithCitations } = require("../utils/perplexity");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("google")
    .setDescription("Search Google")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("What do you want to search for?")
        .setRequired(true),
    ),

  async execute(interaction) {
    const query = interaction.options.getString("query");
    await interaction.deferReply();

    const apiKey = process.env.GG_API_KEY;
    const cx = process.env.CSE_ID;
    const pplxKey = process.env.PPLX_KEY;

    if (!apiKey || !cx) {
      return interaction.editReply(
        "Google API configuration (`GG_API_KEY` & `CSE_ID`) is missing in .env file.",
      );
    }

    try {
      const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`;
      const response = await axios.get(url);
      const data = response.data;

      let embeds = [];
      let hasGoogleResults = false;

      if (data.items && data.items.length > 0) {
        hasGoogleResults = true;
        embeds = data.items.slice(0, 3).map((result, index) => {
          return new EmbedBuilder()
            .setColor("#4285F4")
            .setTitle(result.title)
            .setURL(result.link)
            .setDescription(result.snippet || "*No description available*")
            .setFooter({ text: `Result ${index + 1}` });
        });
      } else {
        const noResultsEmbed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle("No Results Found")
          .setDescription(
            `No results for \`${query}\`. [Try manually](https://www.google.com/search?q=${encodeURIComponent(query)})`,
          );
        embeds.push(noResultsEmbed);
      }

      if (pplxKey) {
        const waitingEmbed = new EmbedBuilder()
          .setColor("#FFA500")
          .setTitle("🤖 AI Reply")
          .setDescription("⏳ Waiting for AI reply...");

        await interaction.editReply({
          content: `🔍 **Search results for:** \`${query}\``,
          embeds: [...embeds, waitingEmbed],
        });

        const aiResult = await getAIReply(query);

        let aiEmbed;
        if (aiResult.error) {
          aiEmbed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle("🤖 AI Reply")
            .setDescription("❌ Failed to get AI response");
        } else {
          const formattedContent = formatContentWithCitations(
            aiResult.content,
            aiResult.citations,
          );
          aiEmbed = new EmbedBuilder()
            .setColor("#10A37F")
            .setTitle("🤖 AI Reply")
            .setDescription(formattedContent || "*No response*");
        }

        await interaction.editReply({
          content: `🔍 **Search results for:** \`${query}\``,
          embeds: [...embeds, aiEmbed],
        });
      } else {
        await interaction.editReply({
          content: `🔍 **Search results for:** \`${query}\``,
          embeds: embeds,
        });
      }
    } catch (error) {
      console.error(error);
      await interaction.editReply(
        "An error occurred while executing this command.",
      );
    }
  },
};
