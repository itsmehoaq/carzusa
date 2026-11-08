const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require("discord.js");

function controls(page, total, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("osu:prev").setLabel("Prev").setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId("osu:next").setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === total - 1),
  );
}

async function paginate(interaction, pages, initialIndex = 0) {
  let index = Math.max(0, Math.min(pages.length - 1, initialIndex));
  if (!pages.length) return interaction.editReply({ content: "No results found.", components: [] });
  const pagePayload = () => {
    const page = pages[index];
    return page.embeds ? { ...page } : { embeds: Array.isArray(page) ? page : [page] };
  };
  const message = await interaction.editReply({
    ...pagePayload(), components: pages.length > 1 ? [controls(index, pages.length)] : [],
    allowedMentions: { parse: [] },
  });
  if (pages.length < 2) return message;
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
  let ended = false;
  let updates = Promise.resolve();
  collector.on("collect", async (button) => {
    try {
      if (button.user.id !== interaction.user.id) {
        await button.reply({ content: "Only the command author can navigate these results.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (!["osu:prev", "osu:next"].includes(button.customId)) return;
      // Keep timeout cleanup after any in-flight update, so it cannot re-enable expired buttons.
      updates = updates.then(async () => {
        index = Math.max(0, Math.min(pages.length - 1, index + (button.customId === "osu:next" ? 1 : -1)));
        await button.update({ ...pagePayload(), components: [controls(index, pages.length, ended)], allowedMentions: { parse: [] } });
      }).catch(() => {});
      await updates;
    } catch {
      // The interaction or message may have been deleted while this button was in flight.
    }
  });
  collector.on("end", async () => {
    ended = true;
    updates = updates.then(() => interaction.editReply({ components: [controls(index, pages.length, true)] }))
      .catch(() => {}); // A deleted reply needs no timeout cleanup.
    await updates;
  });
  return message;
}

module.exports = { paginate };
