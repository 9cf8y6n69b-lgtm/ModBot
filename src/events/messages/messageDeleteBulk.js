const { Events, AuditLogEvent, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { recordModAction } = require('../../utils/antiNuke');
const { sendMessageLog } = require('../../utils/helpers');
const emojis = require('../../utils/emojis');

module.exports = {
    name: Events.MessageBulkDelete,
    /**
     * @param {import('discord.js').Collection<string, import('discord.js').Message>} messages
     * @param {import('discord.js').GuildTextBasedChannel} channel
     * @param {import('discord.js').Client} client
     */
    async execute(messages, channel, client) {
        if (!channel || !channel.guild) return;

        // 1. فحص درع الحماية Anti-Nuke عند الحذف الجماعي
        let executorUser = null;
        if (typeof channel.guild?.fetchAuditLogs === 'function') {
            try {
                const auditLogs = await channel.guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.MessageBulkDelete
                }).catch(() => null);

            const entry = auditLogs?.entries.first();
            if (entry && (Date.now() - entry.createdTimestamp < 10000) && entry.executor) {
                executorUser = entry.executor;
                const executorId = entry.executor.id;
                if (executorId !== client.user?.id) {
                    await recordModAction(channel.guild, executorId, 'purge', client);
                }
            }
            } catch (error) {
                console.error('[Anti-Nuke] MessageBulkDelete check error:', error);
            }
        }

        // 2. إنشاء وتنسيق ملف نصي (Transcript) لجميع الرسائل المحذوفة
        try {
            const messageCount = messages?.size || 0;
            let transcript = `ModBot Bulk Message Deletion Transcript\n`;
            transcript += `Guild: ${channel.guild.name} (${channel.guild.id})\n`;
            transcript += `Channel: #${channel.name} (${channel.id})\n`;
            transcript += `Count: ${messageCount} messages\n`;
            if (executorUser) {
                transcript += `Purged By: ${executorUser.tag} (${executorUser.id})\n`;
            }
            transcript += `Date: ${new Date().toISOString()}\n`;
            transcript += `-------------------------------------------------------\n\n`;

            if (messages && messages.size > 0) {
                const sorted = Array.from(messages.values()).reverse();
                for (const msg of sorted) {
                    const time = msg.createdTimestamp ? new Date(msg.createdTimestamp).toISOString() : new Date().toISOString();
                    const authorTag = msg.author ? `${msg.author.tag || msg.author.username} (${msg.author.id})` : 'Unknown Author';
                    const content = msg.content || (msg.attachments?.size ? `[Attachment(s): ${msg.attachments.size}]` : '[Embed or No Text]');
                    transcript += `[${time}] ${authorTag}:\n${content}\n\n`;
                }
            } else {
                transcript += `[No cached message bodies were available]\n`;
            }

            const buffer = Buffer.from(transcript, 'utf-8');
            const file = new AttachmentBuilder(buffer, { name: `bulk-delete-${channel.name}-${Date.now()}.txt` });

            const embed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle(`${emojis.trash} حذف جماعي للرسائل (Bulk Delete Purge)`)
                .setDescription(`تم حذف \`${messageCount}\` رسالة من القناة ${channel}.`)
                .addFields(
                    { name: `${emojis.channel} القناة`, value: `${channel} (\`${channel.id}\`)`, inline: true },
                    { name: `${emojis.number} عدد الرسائل`, value: `\`${messageCount}\``, inline: true }
                )
                .setTimestamp();

            if (executorUser) {
                embed.addFields({ name: `${emojis.mod} المنفّذ`, value: `${executorUser} (\`${executorUser.id}\`)`, inline: true });
            }

            await sendMessageLog(channel.guild, { embeds: [embed], files: [file] });
        } catch (logErr) {
            console.error('[MessageBulkDelete] Transcript logging error:', logErr);
        }
    }
};
