const axios = require("axios");
const { EmbedBuilder } = require("discord.js");

// Official Petrolimex portal CMS search API.
// The filter selects the public "current fuel prices" list and is constant,
// so the x-request param can be derived once at module load.
const PETROLIMEX_FILTER = {
  FilterBy: {
    And: [
      { SystemID: { Equals: "6783dc1271ff449e95b74a9520964169" } },
      { RepositoryID: { Equals: "a95451e23b474fe5886bfb7cf843f53c" } },
      { RepositoryEntityID: { Equals: "3801378fe1e045b1afa10de7c5776124" } },
    ],
  },
};

const X_REQUEST = Buffer.from(JSON.stringify(PETROLIMEX_FILTER)).toString(
  "base64url",
);

const API_URL = `https://portals.petrolimex.com.vn/~apis/portals/cms.item/search?x-request=${X_REQUEST}`;

// Products excluded from announcements, keyed by Petrolimex item ID.
const EXCLUDED_IDS = new Set([
  "85176bf8a6dd45d597c6980f7a674316", // Xăng E10 RON 95-III
]);

// Items are split into individual embeds (gasolines) vs a single combined
// embed (oils) by their Vietnamese title prefix.
function isGasoline(item) {
  return item.title.trim().startsWith("Xăng");
}

// Fetches the tracked fuel prices, ordered by the feed's DIsplayOrder (which
// Petrolimex controls), excluding EXCLUDED_IDS. New products added to the feed
// flow through automatically. Returns null if the response is empty so callers
// can treat it the same as "no data available".
async function fetchTrackedGasPrices() {
  const response = await axios.get(API_URL);
  const objects = response.data?.Objects;

  if (!Array.isArray(objects) || objects.length === 0) {
    return null;
  }

  const currentData = objects
    .filter((o) => !EXCLUDED_IDS.has(o.ID))
    .sort((a, b) => a.DIsplayOrder - b.DIsplayOrder)
    .map((o) => ({
      petrolimex_id: o.ID,
      date: o.LastModified,
      title: o.Title,
      zone1_price: o.Zone1Price,
      zone2_price: o.Zone2Price,
    }));

  return currentData.length ? currentData : null;
}

// Attaches a `diff` (zone1 price change vs the previously saved data) to each
// item, matched by petrolimex_id so reordering never misaligns the comparison.
function withDiffs(currentData, prevData) {
  const prevById = new Map((prevData || []).map((p) => [p.petrolimex_id, p]));
  return currentData.map((item) => {
    const prev = prevById.get(item.petrolimex_id);
    return { ...item, diff: prev ? item.zone1_price - prev.zone1_price : 0 };
  });
}

// True when every current product has a previous price and none changed.
function pricesUnchanged(currentData, prevData) {
  if (!prevData || prevData.length !== currentData.length) return false;
  const prevById = new Map(prevData.map((p) => [p.petrolimex_id, p]));
  return currentData.every((item) => {
    const prev = prevById.get(item.petrolimex_id);
    return prev && prev.zone1_price === item.zone1_price;
  });
}

// Builds the announcement embeds: one embed per gasoline, then a single
// combined embed listing all oils. Each item must carry a `diff` (see withDiffs).
function buildGasEmbeds(items, isDev) {
  const upEmoji = isDev
    ? "<:up_small:1465930784685690922>"
    : "<:up_small:1465964979114082314>";
  const downEmoji = isDev
    ? "<:down_small:1465930783108628552>"
    : "<:down_small:1465964976823992370>";
  const arrow = (d) => (d < 0 ? downEmoji : d > 0 ? upEmoji : "•");

  const gasolines = items.filter(isGasoline);
  const oils = items.filter((item) => !isGasoline(item));

  const embeds = gasolines.map((item) => {
    const displayTitle = item.title.replace(/^Xăng\s+/, "");
    const color =
      item.diff < 0 ? "#7be863" : item.diff > 0 ? "#e85353" : "#808080";

    return new EmbedBuilder()
      .setTitle(displayTitle)
      .addFields(
        {
          name: "Giá mới",
          value: `${item.zone1_price.toLocaleString()} ₫/lít`,
          inline: true,
        },
        {
          name: "Chênh lệch",
          value: `${arrow(item.diff)} ${Math.abs(item.diff).toLocaleString()} ₫/lít`,
          inline: true,
        },
      )
      .setColor(color);
  });

  if (oils.length) {
    const oilEmbed = new EmbedBuilder()
      .setTitle("Dầu")
      .setColor("#808080")
      .addFields(
        oils.map((item) => ({
          name: item.title,
          value: `${item.zone1_price.toLocaleString()} ₫/lít\n${arrow(item.diff)} ${Math.abs(item.diff).toLocaleString()} ₫/lít`,
          inline: true,
        })),
      );
    embeds.push(oilEmbed);
  }

  return embeds;
}

module.exports = {
  fetchTrackedGasPrices,
  withDiffs,
  pricesUnchanged,
  buildGasEmbeds,
};
