const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/connect.js');
const { hasModPermission } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

function parseUtcTimestamp(str) {
    if (!str) return Math.floor(Date.now() / 1000);
    const s = String(str);
    const iso = s.includes('T') ? (s.endsWith('Z') ? s : s + 'Z') : s.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    return Math.floor((isNaN(d.getTime()) ? new Date(s) : d).getTime() / 1000);
}

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Check User History')
        .setType(ApplicationCommandType.User)
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').UserContextMenuCommandInteraction} interaction
     */
    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} لا يمكن استخدام هذا الإجراء إلا داخل السيرفرات.`, ephemeral: true });
        }

        if (!hasModPermission(interaction.member)) {
            return interaction.reply({ content: `${emojis.error} ليس لديك الصلاحية لاستخدام هذا الإجراء.`, ephemeral: true });
        }

        const targetUser = interaction.targetUser;
        const guildId = interaction.guild.id;

        // Fetch records from SQLite
        const allCases = db.getCases(guildId, targetUser.id);
        const allWarnings = db.getWarnings(guildId, targetUser.id);
        const activeWarnings = allWarnings.filter(w => w.active === 1);
        const quarantinedUsers = db.getQuarantinedUsers(guildId);
        const isQuarantined = quarantinedUsers.some(q => q.user_id === targetUser.id && q.active === 1);
        const allTickets = db.getUserTickets ? db.getUserTickets(guildId, targetUser.id) : db.getAllTickets(guildId, 1000).filter(t => t.user_id === targetUser.id);

        const member = interaction.targetMember 
            || (interaction.guild?.members?.fetch 
                ? await interaction.guild.members.fetch(targetUser.id).catch(() => null) 
                : null);

        let timeoutStatus = 'سليم (غير مكتوم)';
        if (member && typeof member.isCommunicationDisabled === 'function' && member.isCommunicationDisabled()) {
            const until = member.communicationDisabledUntil;
            timeoutStatus = until ? `مكتوم حتى <t:${Math.floor(until.getTime() / 1000)}:R>` : 'مكتوم حالياً';
        }

        const avatarUrl = typeof targetUser.displayAvatarURL === 'function' ? targetUser.displayAvatarURL({ dynamic: true }) : null;
        const embed = new EmbedBuilder()
            .setColor(isQuarantined ? '#ED4245' : (activeWarnings.length > 0 ? '#FEE75C' : config.colors?.primary || '#5865F2'))
            .setTitle(`${emojis.shield} فحص الملف الإشرافي | ${targetUser.tag || targetUser.username}`);

        if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.trim().length > 0) {
            embed.setThumbnail(avatarUrl);
        }

        embed.setDescription(
                `${emojis.user} **العضو المستهدف:** ${targetUser} (\`${targetUser.id}\`)\n` +
                `${emojis.calendar} **تاريخ إنشاء الحساب:** <t:${Math.floor(targetUser.createdTimestamp / 1000)}:D>\n` +
                `${emojis.shield} **الحالة بالسيرفر:** ${member ? 'متواجد حالياً' : 'غير متواجد'}\n` +
                `${emojis.alert} **العزل الاحترازي:** ${isQuarantined ? `${emojis.dot_red} محجور في قائمة Alt Quarantine` : `${emojis.dot_green} غير محجور`}\n` +
                `${emojis.mute} **حالة الكتم:** ${timeoutStatus}`
            )
            .addFields(
                {
                    name: `${emojis.chart} ملخص العقوبات`,
                    value: `${emojis.folder} **إجمالي القضايا:** \`${allCases.length}\`\n` +
                        `${emojis.warn} **تحذيرات نشطة:** \`${activeWarnings.length}\` (من أصل \`${allWarnings.length}\`)\n` +
                        `${emojis.ticket} **تكتات الدعم:** \`${allTickets.length}\``,
                    inline: true
                }
            )
            .setTimestamp();

        // Recent cases snippet (latest 3)
        if (allCases.length > 0) {
            const caseList = allCases.slice(0, 3).map(c => {
                const dateStamp = parseUtcTimestamp(c.created_at);
                return `• **#${c.case_number}** [\`${c.action}\`]: ${c.reason || 'بدون سبب'} (<t:${dateStamp}:R>)`;
            }).join('\n');
            embed.addFields({ name: `${emojis.scroll} آخر القضايا المسجلة`, value: caseList, inline: false });
        }

        if (activeWarnings.length > 0) {
            const warnList = activeWarnings.slice(0, 3).map(w => {
                const dateStamp = parseUtcTimestamp(w.created_at);
                return `• **#${w.id}**: ${w.reason} (<t:${dateStamp}:R>)`;
            }).join('\n');
            embed.addFields({ name: `${emojis.warn} التحذيرات النشطة الحالية`, value: warnList, inline: false });
        }

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
