const { Events, ActivityType } = require('discord.js');
const { startScheduler } = require('../../utils/scheduler');
const { autoSyncApplicationEmojis } = require('../../utils/appEmojiSync');

module.exports = {
    name: Events.ClientReady,
    once: true,
    /**
     * @param {import('discord.js').Client} client
     */
    async execute(client) {
        console.log(`[Boot] Ready! Logged in as ${client.user.tag}`);
        console.log(`[Boot] Watching over ${client.guilds.cache.size} servers`);

        client.user.setPresence({
            status: 'online',
            activities: [{
                name: 'EnzoCord',
                type: ActivityType.Watching
            }]
        });

        // Start background auto-unmute and warning expiration scheduler
        startScheduler(client);

        // Auto-sync Application Emojis if bot token / application changed or if emojis are missing
        await autoSyncApplicationEmojis(client);
    },
};
