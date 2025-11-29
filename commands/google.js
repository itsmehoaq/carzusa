const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");

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

    if (!apiKey || !cx) {
      return interaction.editReply(
        "Google API configuration (`GG_API_KEY` & `CSE_ID`) is missing in .env file.",
      );
    }

    try {
      const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`;
      const response = await axios.get(url);
      const data = response.data;

      if (data.items && data.items.length > 0) {
        const embeds = data.items.slice(0, 3).map((result, index) => {
          return new EmbedBuilder()
            .setColor("#4285F4")
            .setTitle(result.title)
            .setURL(result.link)
            .setDescription(result.snippet || "*No description available*")
            .setFooter({ text: `Result ${index + 1}` });
        });

        await interaction.editReply({
          content: `🔍 **Search results for:** \`${query}\``,
          embeds: embeds,
        });
      } else {
        const noResultsEmbed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle("No Results Found")
          .setDescription(
            `No results for \`${query}\`. [Try manually](https://www.google.com/search?q=${encodeURIComponent(query)})`,
          );

        await interaction.editReply({ embeds: [noResultsEmbed] });
      }
    } catch (error) {
      console.error(error);
      await interaction.editReply(
        "An error occurred while executing this command.",
      );
    }
  },
};
