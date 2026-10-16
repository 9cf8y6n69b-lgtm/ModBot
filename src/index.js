require('dotenv').config();
const { DefaultWebSocketManagerOptions } = require('discord.js');

// Set Discord Gateway identify properties for VR headset status (client_status.vr)
if (DefaultWebSocketManagerOptions && DefaultWebSocketManagerOptions.identifyProperties) {
    DefaultWebSocketManagerOptions.identifyProperties.browser = 'Discord VR';
    DefaultWebSocketManagerOptions.identifyProperties.device = 'Discord VR';
    DefaultWebSocketManagerOptions.identifyProperties.os = 'Android';
}

const ExtendedClient = require('./structures/ExtendedClient');
const { initDatabase } = require('./database/connect');
const { startDashboard } = require('./dashboard/server');

// Handle unhandled promise rejections
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Handle uncaught exceptions
process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

// Start the client
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('Missing DISCORD_TOKEN in .env file!');
    process.exit(1);
}

(async () => {
    try {
        // Initialize SQLite (sql.js WASM) before anything else
        await initDatabase();
        console.log('[Boot] Database ready');

        // Initialize and start the Discord client
        const client = new ExtendedClient();
        await client.start(token);

        // Start Dashboard Web Server
        const port = process.env.PORT || 3000;
        startDashboard(client, port);
    } catch (error) {
        console.error('Failed to start:', error);
        process.exit(1);
    }
})();
