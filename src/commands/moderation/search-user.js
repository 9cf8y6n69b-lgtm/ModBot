const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
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
    data: new SlashCommandBuilder()
        .setName('search-user')
        .setDescription('Search user moderation history (cases, warnings, tickets, quarantine, activity)')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Select user to view history')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('User ID (if not currently in the server)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} لا يمكن استخدام هذا الأمر إلا داخل السيرفرات.`, ephemeral: true });
        }

        if (!hasModPermission(interaction.member)) {
            return interaction.reply({ content: `${emojis.error} ليس لديك الصلاحية لاستخدام هذا الأمر.`, ephemeral: true });
        }

        const selectedUser = interaction.options.getUser('user');
        const inputId = interaction.options.getString('user_id')?.trim();

        let targetUser = selectedUser;
        if (!targetUser && inputId) {
            targetUser = await interaction.client.users.fetch(inputId).catch(() => null);
            if (!targetUser) {
                targetUser = { id: inputId, tag: `User#${inputId.slice(-4)}`, username: `User ${inputId}`, bot: false, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' };
            }
        }

        if (!targetUser) {
            return interaction.reply({
                content: `${emojis.error} يرجى تحديد العضو إما باختياره من القائمة أو بإدخال معرف حسابه (User ID).`,
                ephemeral: true
            });
        }

        const guildId = interaction.guild.id;
        const member = interaction.guild?.members?.fetch 
            ? await interaction.guild.members.fetch(targetUser.id).catch(() => null) 
            : null;

        // Fetch user records from SQLite
        const allCases = db.getCases(guildId, targetUser.id);
        const allWarnings = db.getWarnings(guildId, targetUser.id);
        const activeWarnings = allWarnings.filter(w => w.active === 1);
        const expiredWarnings = allWarnings.filter(w => w.active === 0);

        const allTickets = db.getUserTickets ? db.getUserTickets(guildId, targetUser.id) : db.getAllTickets(guildId, 1000).filter(t => t.user_id === targetUser.id);
        const openTickets = allTickets.filter(t => t.status === 'open');

        const quarantinedUsers = db.getQuarantinedUsers(guildId);
        const isQuarantined = quarantinedUsers.some(q => q.user_id === targetUser.id && q.active === 1);

        const activityStats = db.getMemberActivityStats ? db.getMemberActivityStats(guildId, targetUser.id) : { today: 0, week: 0, total: 0 };

        // Case breakdown
        const bans = allCases.filter(c => c.action === 'ban').length;
        const softbans = allCases.filter(c => c.action === 'softban').length;
        const kicks = allCases.filter(c => c.action === 'kick').length;
        const mutes = allCases.filter(c => c.action === 'mute').length;
        const automods = allCases.filter(c => c.action === 'automod' || (c.reason && c.reason.toLowerCase().includes('automod'))).length;

        // Current Timeout / Mute check
        let timeoutStatus = 'غير مكتوم';
        if (member && typeof member.isCommunicationDisabled === 'function' && member.isCommunicationDisabled()) {
            const until = member.communicationDisabledUntil;
            timeoutStatus = until ? `مكتوم حتى <t:${Math.floor(until.getTime() / 1000)}:R>` : 'مكتوم حالياً';
        }

        const avatarUrl = typeof targetUser.displayAvatarURL === 'function' ? targetUser.displayAvatarURL({ dynamic: true }) : null;
        const embed = new EmbedBuilder()
            .setColor(isQuarantined ? '#ED4245' : (activeWarnings.length > 0 ? '#FEE75C' : config.colors?.primary || '#5865F2'))
            .setTitle(`${emojis.case} السجل الإشرافي الشامل | ${targetUser.tag || targetUser.username}`);

        if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.trim().length > 0) {
            embed.setThumbnail(avatarUrl);
        }

        embed.setDescription(
                `${emojis.user} **الحساب:** ${targetUser} (\`${targetUser.id}\`)\n` +
                `${emojis.shield} **الحالة بالسيرفر:** ${member ? 'عضو متواجد حالياً' : 'غير متواجد بالسيرفر'}\n` +
                `${emojis.alert} **العزل الاحترازي:** ${isQuarantined ? `${emojis.dot_red} محجور في قائمة Alt Quarantine` : `${emojis.dot_green} سليم`}\n` +
                `${emojis.mute} **الكتم الصوتي/الكتابي:** ${timeoutStatus}\n` +
                `${emojis.chat} **نشاط الرسائل:** \`${Number(activityStats.total || 0).toLocaleString('ar-EG')}\` رسالة (اليوم: \`${activityStats.today || 0}\` | الأسبوع: \`${activityStats.week || 0}\`)`
            )
            .addFields(
                {
                    name: `${emojis.chart} ملخص القضايا والعقوبات`,
                    value: `${emojis.folder} **إجمالي القضايا:** \`${allCases.length}\`\n` +
                        `${emojis.hammer} حظر نهائي: \`${bans}\` | ${emojis.zap} حظر خفيف: \`${softbans}\`\n` +
                        `${emojis.kick} طرد: \`${kicks}\` | ${emojis.mute} كتم: \`${mutes}\`\n` +
                        `${emojis.bot} مخالفات أوتومود: \`${automods}\``,
                    inline: true
                },
                {
                    name: `${emojis.warn} سجل التحذيرات`,
                    value: `${emojis.dot_yellow} **تحذيرات نشطة:** \`${activeWarnings.length}\`\n` +
                        `${emojis.dot_white} **تحذيرات منتهية/ملغاة:** \`${expiredWarnings.length}\`\n` +
                        `${emojis.folder} **إجمالي التحذيرات:** \`${allWarnings.length}\``,
                    inline: true
                },
                {
                    name: `${emojis.ticket} تكتات الدعم الفني`,
                    value: `${emojis.folder} تكتات مفتوحة: \`${openTickets.length}\`\n` +
                        `${emojis.folder} إجمالي التكتات: \`${allTickets.length}\``,
                    inline: true
                }
            )
            .setTimestamp();

        // Recent cases snippet (latest 4)
        if (allCases.length > 0) {
            const caseList = allCases.slice(0, 4).map(c => {
                const dateStamp = parseUtcTimestamp(c.created_at);
                const remaining = c.remaining_duration ? ` (متبقي: ${c.remaining_duration})` : '';
                return `• **#${c.case_number}** [\`${c.action}\`]: ${c.reason || 'بدون سبب'} — <t:${dateStamp}:R>${remaining}`;
            }).join('\n');
            embed.addFields({ name: `${emojis.scroll} آخر الإجراءات والقضايا المسجلة`, value: caseList, inline: false });
        }

        // Active warnings snippet
        if (activeWarnings.length > 0) {
            const warnList = activeWarnings.slice(0, 3).map(w => {
                const dateStamp = parseUtcTimestamp(w.created_at);
                return `• **تحذير #${w.id}**: ${w.reason} (<@${w.moderator_id}> — <t:${dateStamp}:R>)`;
            }).join('\n');
            embed.addFields({ name: `${emojis.warn} تفاصيل التحذيرات النشطة الحالية`, value: warnList, inline: false });
        }

        return interaction.reply({ embeds: [embed] });
    }
};
