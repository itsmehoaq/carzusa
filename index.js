require("./utils/envLoader")();

const fs = require("node:fs");
const path = require("node:path");
const { Client, Collection, Events, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
if (!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath);

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  }
}

const eventsPath = path.join(__dirname, "events");
if (!fs.existsSync(eventsPath)) fs.mkdirSync(eventsPath);

const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));
for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.name && event.execute) {
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(
    `Environment: ${process.env.DEV_MODE === "true" ? "DEVELOPMENT" : "PRODUCTION"}`,
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const replyObj = {
      content: "There was an error while executing this command!",
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred)
      await interaction.followUp(replyObj);
    else await interaction.reply(replyObj);
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error("Error: DISCORD_TOKEN is missing from .env files.");
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
