const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("every command file serializes offline with a unique name and an execute function", () => {
  const names = new Set();
  for (const file of fs.readdirSync(path.join(__dirname, "../commands")).filter((file) => file.endsWith(".js"))) {
    const command = require(`../commands/${file}`);
    // Existing manual_gasnotify.js is an empty placeholder, skipped by the production loader too.
    if (!command.data && !command.execute) continue;
    assert.equal(typeof command.execute, "function", file);
    const json = command.data.toJSON();
    assert.equal(typeof json.description, "string", file);
    assert.ok(!names.has(json.name), `Duplicate command ${json.name}`);
    names.add(json.name);
  }
  for (const name of ["osu", "rs", "top", "mc"]) assert.ok(names.has(name));
});

test("osu uses strictly subcommands; aliases have identical option definitions", () => {
  const osu = require("../commands/osu").data.toJSON();
  assert.deepEqual(osu.options.map((option) => option.name), ["profile", "recent", "top", "map", "whatif", "bws", "matchcost", "link", "unlink"]);
  assert.ok(osu.options.every((option) => option.type === 1));
  assert.deepEqual(osu.options.find((option) => option.name === "map").options.map((option) => option.name), ["beatmap_id_or_url"]);
  for (const [alias, subcommand] of [["rs", "recent"], ["top", "top"], ["mc", "matchcost"]]) {
    assert.deepEqual(require(`../commands/${alias}`).data.toJSON().options, osu.options.find((option) => option.name === subcommand).options);
  }
  const recent = osu.options.find((option) => option.name === "recent");
  assert.deepEqual(recent.options.map((option) => option.name), ["username", "mode", "include_fails", "index"]);
});
