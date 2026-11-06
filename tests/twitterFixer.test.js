const assert = require("node:assert/strict");
const { test } = require("node:test");
const db = require("../utils/db");
const twitterFixer = require("../events/twitterFixer");

function setEnv(t, key, value) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

function setup(t, result, content = "https://x.com/author/status/123") {
  setEnv(t, "DEV_MODE", "false");
  setEnv(t, "OWNER", "owner");
  const query = t.mock.method(db, "query", async () => result);
  const edit = t.mock.fn(async () => {});
  // Avoid waiting ten seconds for the translation tip's cleanup.
  t.mock.method(global, "setTimeout", () => 0);
  const message = {
    id: "message", content, guild: { id: "guild" }, channel: { id: "channel" },
    author: { id: "user", bot: false }, suppressEmbeds: t.mock.fn(async () => {}),
    reply: t.mock.fn(async () => ({ edit })),
  };
  return { message, query };
}

function duplicate(overrides = {}) {
  return { rows: [{ id: "1", count: 3, is_first_post: false, first_user_id: "first",
    first_channel_id: "original-channel", first_message_id: "original-message", ...overrides }], error: null };
}

test("first post uses the atomic upsert and sends the fixed link", async (t) => {
  const { message, query } = setup(t, { rows: [{ count: 1, is_first_post: true }], error: null });
  await twitterFixer.execute(message);
  const [sql, params] = query.mock.calls[0].arguments;
  assert.match(sql, /ON CONFLICT \(guild_id, tweet_key\)/);
  assert.match(sql, /count = twitter_reposts.count \+ 1/);
  assert.deepEqual(params, ["guild", "author/status/123", "user", "channel", "message"]);
  assert.equal(query.mock.callCount(), 1);
  assert.match(message.reply.mock.calls[0].arguments[0].content, /https:\/\/fixupx.com\/author\/status\/123/);
});

test("duplicate uses the returned count and original author and message", async (t) => {
  const { message, query } = setup(t, duplicate());
  await twitterFixer.execute(message);
  assert.equal(query.mock.callCount(), 1);
  const reply = message.reply.mock.calls[0].arguments[0];
  const embed = reply.embeds[0].toJSON();
  assert.equal(embed.description, "Repost count: **3**");
  assert.equal(embed.fields[0].value, "<@first>");
  assert.match(embed.fields[1].value, /https:\/\/discord.com\/channels\/guild\/original-channel\/original-message/);
});

test("DB failure sends a fixed link instead of losing the reply", async (t) => {
  const { message } = setup(t, { rows: [], error: new Error("Query read timeout") });
  t.mock.method(console, "error", () => {});
  await twitterFixer.execute(message);
  assert.match(message.reply.mock.calls[0].arguments[0].content, /fixupx.com/);
});

test("owner duplicate still increments once and sends a fixed link", async (t) => {
  const { message, query } = setup(t, duplicate());
  message.author.id = "owner";
  await twitterFixer.execute(message);
  assert.equal(query.mock.callCount(), 1);
  assert.match(message.reply.mock.calls[0].arguments[0].content, /fixupx.com/);
});

test("duplicate without original message IDs omits the jump link", async (t) => {
  const { message } = setup(t, duplicate({ first_channel_id: null, first_message_id: null }));
  await twitterFixer.execute(message);
  assert.equal(message.reply.mock.calls[0].arguments[0].embeds[0].toJSON().fields.length, 1);
});

test("media-specific and development links bypass the DB; translations survive", async (t) => {
  const { message, query } = setup(t, null, "https://x.com/author/status/123/photo/1");
  await twitterFixer.execute(message);
  setEnv(t, "DEV_MODE", "true");
  message.content = "https://x.com/author/status/123/en";
  await twitterFixer.execute(message);
  assert.equal(query.mock.callCount(), 0);
  assert.match(message.reply.mock.calls[1].arguments[0].content, /status\/123\/en/);
});

test("bot, DM, spoiler and unrelated messages do not query or reply", async (t) => {
  const { message, query } = setup(t, null);
  for (const override of [{ author: { bot: true } }, { guild: null },
    { content: "||https://x.com/author/status/123||" }, { content: "hello" }]) {
    await twitterFixer.execute({ ...message, ...override });
  }
  assert.equal(query.mock.callCount(), 0);
  assert.equal(message.reply.mock.callCount(), 0);
});
