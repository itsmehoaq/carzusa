const { REST, Routes } = require('discord.js');
const fs = require('node:fs');

const isDev = process.env.npm_config_dev || process.argv.includes('--dev');

if (isDev) {
    process.env.DEV_MODE = 'true';
    console.log("Cleaning DEV Bot...");
} else {
    console.log("Cleaning PROD Bot...");
}

require('./envLoader')();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GAS_NOTIFY_GUILD_ID;

if (!token || !clientId) {
    console.error("Error: Missing credentials.");
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
	try {
		console.log(`Started deleting all commands for Client ID: ${clientId}`);

        console.log("Deleting Global Commands...");
		await rest.put(Routes.applicationCommands(clientId), { body: [] });
        console.log("Global Commands cleared.");

        if (guildId) {
            console.log(`Deleting Guild Commands for Guild ID: ${guildId}...`);
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
            console.log("Guild Commands cleared.");
        }

		console.log("All commands successfully reset. You can now run your deploy script.");
	} catch (error) {
		console.error(error);
	}
})();