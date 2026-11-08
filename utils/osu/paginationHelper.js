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
  const loaded = new Map();
  const pagePayload = async (pageIndex) => {
    if (!loaded.has(pageIndex)) {
      const pending = Promise.resolve().then(() => typeof pages[pageIndex] === "function" ? pages[pageIndex]() : pages[pageIndex]);
      loaded.set(pageIndex, pending);
      pending.catch(() => loaded.delete(pageIndex));
    }
    const page = await loaded.get(pageIndex);
    return page.embeds || page.content !== undefined ? { ...page } : { embeds: Array.isArray(page) ? page : [page] };
  };
  const message = await interaction.editReply({
    ...await pagePayload(index), components: pages.length > 1 ? [controls(index, pages.length)] : [],
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
      // Acknowledge before waiting for queued navigation, downloads, or calculations.
      const direction = button.customId === "osu:next" ? 1 : -1;
      const acknowledgement = button.deferUpdate
        ? button.deferUpdate().then(() => null, error => error) : Promise.resolve(null);
      // Keep timeout cleanup after any in-flight update, so it cannot re-enable expired buttons.
      updates = updates.then(async () => {
        const acknowledgementError = await acknowledgement;
        if (acknowledgementError) throw acknowledgementError;
        if (ended) return;
        const target = Math.max(0, Math.min(pages.length - 1, index + direction));
        const update = button.deferUpdate ? payload => interaction.editReply(payload) : payload => button.update(payload);
        try {
          const payload = await pagePayload(target);
          await update({ content: "", ...payload, components: [controls(target, pages.length, ended)], allowedMentions: { parse: [] } });
          index = target;
        } catch (error) {
          await update({ content: error.message, embeds: [], components: [controls(index, pages.length, ended)], allowedMentions: { parse: [] } });
        }
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
