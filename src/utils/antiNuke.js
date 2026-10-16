const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database/connect');
const emojis = require('./emojis');

// In-memory sliding window: guildId -> Map(moderatorId -> [{ timestamp, actionType }])
const actionWindows = new Map();
const WINDOW_DURATION_MS = 60000; // 60 ثانية

/**
 * Records a moderation action (ban, kick, channel delete, mass message delete)
 * and checks if the Anti-Nuke threshold is exceeded.
 * @param {import('discord.js').Guild} guild
 * @param {string} moderatorId
 * @param {string} actionType - 'ban' | 'kick' | 'purge' | 'channel_delete'
 * @param {import('discord.js').Client} client
 * @returns {Promise<boolean>} True if anti-nuke was triggered
 */
async function recordModAction(guild, moderatorId, actionType, client) {
    if (!guild || !moderatorId) return false;
    // Exempt server owner and the bot itself
    if (moderatorId === guild.ownerId || (client?.user && moderatorId === client.user.id)) return false;

    const guildConfig = db.getConfig(guild.id);
    if (!guildConfig || (guildConfig.anti_nuke_enabled !== undefined && guildConfig.anti_nuke_enabled === 0)) {
        return false;
    }

    const threshold = Number(guildConfig.anti_nuke_threshold) || 3;

    if (!actionWindows.has(guild.id)) {
        actionWindows.set(guild.id, new Map());
    }
    const guildActions = actionWindows.get(guild.id);
    if (!guildActions.has(moderatorId)) {
        guildActions.set(moderatorId, []);
    }

    const now = Date.now();
    const history = guildActions.get(moderatorId);
    history.push({ timestamp: now, actionType });

    // Clean up older entries outside 60s window
    const recent = history.filter(item => now - item.timestamp < WINDOW_DURATION_MS);
    guildActions.set(moderatorId, recent);

    if (recent.length >= threshold) {
        // Reset history to prevent cascading triggers
        guildActions.delete(moderatorId);

        console.warn(`[Anti-Nuke] Triggered on guild ${guild.id} for user ${moderatorId}: ${recent.length} actions in 60s`);

        try {
            const member = await guild.members.fetch(moderatorId).catch(() => null);
            if (member) {
                // Demote / strip high permission roles
                const dangerousRoles = member.roles.cache.filter(role => 
                    !role.managed &&
                    role.id !== guild.id &&
                    (role.permissions.has(PermissionFlagsBits.Administrator) ||
                     role.permissions.has(PermissionFlagsBits.BanMembers) ||
                     role.permissions.has(PermissionFlagsBits.KickMembers) ||
                     role.permissions.has(PermissionFlagsBits.ManageChannels) ||
                     role.permissions.has(PermissionFlagsBits.ManageRoles) ||
                     role.permissions.has(PermissionFlagsBits.ManageGuild) ||
                     role.permissions.has(PermissionFlagsBits.ManageMessages))
                );

                const me = guild.members.me || (guild.members.fetchMe ? await guild.members.fetchMe().catch(() => null) : null);
                if (dangerousRoles.size > 0 && me) {
                    const stripRoles = dangerousRoles.filter(role => role.position < me.roles.highest.position);
                    if (stripRoles.size > 0) {
                        await member.roles.remove(stripRoles, 'Anti-Nuke Shield: Rapid moderation actions limit exceeded').catch(() => {});
                    }
                }

                // Apply emergency timeout
                if (member.moderatable) {
                    await member.timeout(28 * 24 * 60 * 60 * 1000, 'Anti-Nuke Shield Triggered').catch(() => {});
                }
            }

            // Save record in database cases
            const reason = `تفعيل درع الحماية ضد التخريب (Anti-Nuke): تم رصد تنفيذ ${recent.length} إجراءات إشرافية (${actionType}) خلال 60 ثانية`;
            db.addCase(guild.id, 'automod', moderatorId, client?.user?.id || 'SYSTEM', reason, '28d');

            // Send emergency alert
            const alertEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle(`${emojis.alert} تم تفعيل درع الحماية ضد التخريب (Anti-Nuke Shield)`)
                .setDescription(`تم رصد نشاط إشرافي مكثف وسريع غير مصرح به من المشرف <@${moderatorId}>!\n\n` +
                    `**الإجراءات المرصودة:** \`${recent.length}\` إجراءات (${actionType}) خلال أقل من دقيقة.\n` +
                    `**الحد المسموح:** \`${threshold}\` إجراءات في 60 ثانية.\n\n` +
                    `${emojis.shield} **الإجراء التلقائي:** تم تجريد المشرف من الرتب الإدارية الحساسة وتطبيق الكتم الوقائي الفوري لحماية السيرفر.`)
                .setTimestamp();

            const { sendModLog } = require('./helpers');
            await sendModLog(guild, alertEmbed);

            return true;
        } catch (err) {
            console.error('[Anti-Nuke] Error applying mitigations:', err);
            return false;
        }
    }

    return false;
}

module.exports = {
    recordModAction
};
