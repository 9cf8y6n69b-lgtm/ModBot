require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const token = process.env.DISCORD_TOKEN;

if (!clientId || !token) {
    console.error('CLIENT_ID or DISCORD_TOKEN is missing in .env file.');
    process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');

if (fs.existsSync(commandsPath)) {
    const commandFolders = fs.readdirSync(commandsPath);

    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if (!fs.statSync(folderPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                commands.push(command.data.toJSON());
            } else {
                console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
            }
        }
    }
} else {
    console.log('No commands directory found.');
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        let data;
        if (guildId) {
            // Guild specific
            console.log(`Deploying to guild: ${guildId}`);
            data = await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands },
            );
        } else {
            // Global
            console.log('Deploying globally.');
            data = await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );
        }

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
})();
