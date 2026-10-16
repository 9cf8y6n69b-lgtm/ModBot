const { EmbedBuilder } = require('discord.js');
const db = require('../database/connect');
const { sendModLog } = require('./helpers');
const config = require('../../config.json');
const emojis = require('./emojis');

/**
 * Checks all active mutes in the database and automatically un-times out/unmutes
 * members whose duration has expired.
 * @param {import('discord.js').Client} client
 * @returns {Promise<number>} Number of resolved mutes
 */
async function checkExpiredMutes(client) {
    if (!client) return 0;
    const expiredCases = db.getExpiredMutes();
    if (!expiredCases || expiredCases.length === 0) return 0;

    let resolvedCount = 0;

    for (const c of expiredCases) {
        try {
            // 1. Mark case as resolved in SQLite
            db.resolveExpiredMute(c.case_number, c.guild_id);
            resolvedCount++;

            // 2. Fetch guild
            const guild = client.guilds.cache.get(c.guild_id)
                || (client.guilds.fetch ? await client.guilds.fetch(c.guild_id).catch(() => null) : null);
            if (!guild) continue;

            const guildConfig = db.getConfig(guild.id);

            // 3. Sync member state (remove timeout and mute role)
            const member = await guild.members.fetch(c.user_id).catch(() => null);
            if (member) {
                // If member has Discord timeout
                if (typeof member.isCommunicationDisabled === 'function' && member.isCommunicationDisabled()) {
                    await member.timeout(null, 'Auto-Unmute: Timeout expired').catch(() => {});
                }
                // If guild uses custom mute role
                if (guildConfig && guildConfig.mute_role_id && member.roles.cache.has(guildConfig.mute_role_id)) {
                    await member.roles.remove(guildConfig.mute_role_id, 'Auto-Unmute: Mute role expired').catch(() => {});
                }
            }

            // 4. Send audit embed to mod-logs channel
            const logEmbed = new EmbedBuilder()
                .setColor(config.colors?.success || '#57F287')
                .setTitle(`${emojis.timer} انتهاء مدة الكتم التلقائي`)
                .setDescription(`انتهت فترة الكتم المقررة للعضو <@${c.user_id}> وتم فك الكتم تلقائياً.`)
                .addFields(
                    { name: `${emojis.user} العضو المستهدف`, value: `<@${c.user_id}> (\`${c.user_id}\`)`, inline: true },
                    { name: `${emojis.folder} رقم القضية`, value: `#${c.case_number}`, inline: true },
                    { name: `${emojis.slowmode} المدة المنقضية`, value: String(c.duration || 'مؤقت'), inline: true },
                    { name: `${emojis.notes} سبب الكتم الأصلي`, value: c.reason || 'لم يُحدد سبب', inline: false }
                )
                .setTimestamp();

            await sendModLog(guild, logEmbed);
        } catch (err) {
            console.error(`[Scheduler] Error resolving expired mute for case #${c.case_number}:`, err);
        }
    }

    return resolvedCount;
}

/**
 * Starts the background auto-unmute and warning expiration scheduler
 * @param {import('discord.js').Client} client
 * @param {number} [intervalMs=15000]
 * @returns {NodeJS.Timeout}
 */
function startScheduler(client, intervalMs = 15000) {
    // Run immediately on boot
    checkExpiredMutes(client).catch(() => {});
    db.checkAndExpireWarnings();

    const interval = setInterval(async () => {
        try {
            await checkExpiredMutes(client);
            db.checkAndExpireWarnings();
        } catch (err) {
            console.error('[Scheduler] Interval check error:', err);
        }
    }, intervalMs);

    interval.unref();
    return interval;
}

module.exports = {
    checkExpiredMutes,
    startScheduler
};
