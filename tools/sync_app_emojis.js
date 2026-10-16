/**
 * @file tools/sync_app_emojis.js
 * @description CLI script to force sync high-resolution filled custom emojis to the Discord Application Developer Portal.
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { autoSyncApplicationEmojis } = require('../src/utils/appEmojiSync');
require('dotenv').config();

async function runCliSync() {
    console.log('=== Starting Manual Developer Portal Application Emoji Sync ===');
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    await new Promise((resolve, reject) => {
        client.once('clientReady', resolve);
        client.on('error', reject);
        client.login(process.env.DISCORD_TOKEN);
    });

    console.log(`[CLI] Logged in as ${client.user.tag} (App ID: ${client.application.id})`);
    await autoSyncApplicationEmojis(client, { force: false });

    client.destroy();
}

runCliSync().catch(err => {
    console.error('Fatal CLI sync error:', err);
    process.exit(1);
});
