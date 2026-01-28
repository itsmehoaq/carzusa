const { REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

require("./envLoader")();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error("Error: Missing DISCORD_TOKEN or CLIENT_ID in configuration.");
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, "../commands");
if (!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath);

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

console.log(`Scanning ${commandFiles.length} files in '../commands/'...`);

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ("data" in command && "execute" in command) {
    commands.push(command.data.toJSON());
  } else {
    console.warn(
      `WARNING: Skipping "${file}". It is missing "data" or "execute" properties.`,
    );
  }
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`,
    );
    console.log(`Target Client ID: ${clientId}`);
    console.log(`Deploying commands globally...`);

    const route = Routes.applicationCommands(clientId);
    const data = await rest.put(route, { body: commands });

    console.log(
      `Successfully reloaded ${data.length} application (/) commands.`,
    );
  } catch (error) {
    console.error(error);
  }
})();
