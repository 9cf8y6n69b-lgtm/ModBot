const { Events, AuditLogEvent } = require('discord.js');
const { recordModAction } = require('../../utils/antiNuke');

module.exports = {
    name: Events.ChannelDelete,
    /**
     * @param {import('discord.js').GuildChannel} channel
     * @param {import('discord.js').Client} client
     */
    async execute(channel, client) {
        if (!channel || !channel.guild) return;
        try {
            const auditLogs = await channel.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.ChannelDelete
            }).catch(() => null);

            const entry = auditLogs?.entries.first();
            if (entry && entry.targetId === channel.id && entry.executor) {
                const executorId = entry.executor.id;
                if (executorId !== client.user?.id) {
                    await recordModAction(channel.guild, executorId, 'channel_delete', client);
                }
            }
        } catch (error) {
            console.error('[Anti-Nuke] ChannelDelete check error:', error);
        }
    }
};
