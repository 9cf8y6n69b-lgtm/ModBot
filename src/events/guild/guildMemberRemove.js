const { Events, EmbedBuilder, AuditLogEvent } = require('discord.js');
const { sendModLog, formatTemplate } = require('../../utils/helpers');
const { recordModAction } = require('../../utils/antiNuke');
const db = require('../../database/connect');
const emojis = require('../../utils/emojis');

module.exports = {
    name: Events.GuildMemberRemove,
    /**
     * @param {import('discord.js').GuildMember} member
     * @param {import('discord.js').Client} client
     */
    async execute(member, client) {
        if (!member || !member.guild) return;

        // 1. فحص ما إذا كان العضو قد طُرد بواسطة مشرف (Anti-Nuke kick detection)
        if (typeof member.guild?.fetchAuditLogs === 'function') {
            try {
                const auditLogs = await member.guild.fetchAuditLogs({
                    limit: 1,
                    type: AuditLogEvent.MemberKick
                }).catch(() => null);

                const entry = auditLogs?.entries.first();
                if (entry && entry.target?.id === member.id && (Date.now() - entry.createdTimestamp < 5000) && entry.executor) {
                    const executorId = entry.executor.id;
                    if (executorId !== client?.user?.id) {
                        await recordModAction(member.guild, executorId, 'kick', client);
                    }
                }
            } catch (auditErr) {
                console.error('[Anti-Nuke] GuildMemberRemove audit check error:', auditErr);
            }
        }

        // 2. إرسال رسالة وداع في القناة المخصصة (Farewell Message)
        const config = db.getConfig(member.guild.id);
        const farewellChannelId = config?.farewell_channel_id || config?.farewellChannelId || config?.welcome_channel_id;
        if (farewellChannelId) {
            try {
                const farewellChannel = member.guild.channels.cache.get(farewellChannelId)
                    || await member.guild.channels.fetch(farewellChannelId).catch(() => null);
                if (farewellChannel && farewellChannel.isTextBased()) {
                    const defaultFarewell = `غادر العضو **${member.user?.tag || member.user?.username}** السيرفر. أصبح عدد الأعضاء الآن \`${member.guild.memberCount}\`.`;
                    const description = config.farewell_message
                        ? formatTemplate(config.farewell_message, member)
                        : defaultFarewell;

                    const farewellEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(`${emojis.wave} وداعاً يا ${member.user?.username || 'عضو'}!`)
                        .setDescription(description);

                    const farewellAvatar = typeof member.user?.displayAvatarURL === 'function' ? member.user.displayAvatarURL({ dynamic: true }) : null;
                    if (farewellAvatar && typeof farewellAvatar === 'string' && farewellAvatar.trim().length > 0) {
                        farewellEmbed.setThumbnail(farewellAvatar);
                    }

                    farewellEmbed.addFields(
                        { name: `${emojis.user} العضو`, value: `${member.user?.tag || member.user?.username} (\`${member.user?.id || member.id}\`)`, inline: true },
                        { name: `${emojis.chart} متبقي في السيرفر`, value: `${member.guild.memberCount} عضو`, inline: true }
                    )
                    .setTimestamp();

                    await farewellChannel.send({ embeds: [farewellEmbed] }).catch(() => {});
                }
            } catch (farewellErr) {
                console.error('[Farewell Message] Error sending farewell embed:', farewellErr);
            }
        }

        // 3. إرسال إشعار في سجل المشرفين
        const embed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle(`${emojis.wave} مغادرة عضو من السيرفر`)
            .setDescription(`غادر العضو **${member.user?.tag || member.user?.username}** (\`${member.user?.id || member.id}\`) السيرفر.`)
            .setThumbnail(member.user?.displayAvatarURL ? member.user.displayAvatarURL() : null)
            .setTimestamp();
            
        await sendModLog(member.guild, embed);
    }
};
