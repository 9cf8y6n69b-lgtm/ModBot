const { Events, AuditLogEvent } = require('discord.js');
const { recordModAction } = require('../../utils/antiNuke');

module.exports = {
    name: Events.GuildBanAdd,
    /**
     * @param {import('discord.js').GuildBan} ban
     * @param {import('discord.js').Client} client
     */
    async execute(ban, client) {
        if (!ban || !ban.guild) return;
        const { guild, user } = ban;
        try {
            const auditLogs = await guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.MemberBanAdd
            }).catch(() => null);

            const entry = auditLogs?.entries.first();
            if (entry && entry.target?.id === user.id && entry.executor) {
                const executorId = entry.executor.id;
                if (executorId !== client.user?.id) {
                    await recordModAction(guild, executorId, 'ban', client);
                }
            }
        } catch (error) {
            console.error('[Anti-Nuke] GuildBanAdd check error:', error);
        }
    }
};
