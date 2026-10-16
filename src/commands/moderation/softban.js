const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addCase } = require('../../database/connect.js');
const { createModEmbed, sendModLog, checkHierarchy, hasModPermission } = require('../../utils/helpers.js');
const { recordModAction } = require('../../utils/antiNuke.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('softban')
        .setDescription('Softban a member (ban and instant unban to purge messages)')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The member to softban')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Days of message history to delete (1 to 7)')
                .setMinValue(1)
                .setMaxValue(7)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the softban')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('silent')
                .setDescription('Do not send DM notification to member')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

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

        const me = interaction.guild.members.me;
        if (me && !me.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: `${emojis.error} البوت لا يمتلك صلاحية حظر الأعضاء (Ban Members)!`, ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const days = interaction.options.getInteger('days') || 1;
        const reason = interaction.options.getString('reason') || 'لم يُحدد سبب (حظر خفيف ومسح رسائل)';
        const silent = interaction.options.getBoolean('silent') || false;

        if (!user) {
            return interaction.reply({ content: `${emojis.error} يرجى تحديد العضو المستهدف.`, ephemeral: true });
        }

        if (interaction.client?.user && user.id === interaction.client.user.id) {
            return interaction.reply({ content: `${emojis.error} لا يمكنك تطبيق الحظر الخفيف على البوت!`, ephemeral: true });
        }
        if (interaction.user && user.id === interaction.user.id) {
            return interaction.reply({ content: `${emojis.error} لا يمكنك تطبيق الحظر الخفيف على نفسك!`, ephemeral: true });
        }

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member) {
            if (!checkHierarchy(interaction.member, member)) {
                return interaction.reply({ content: `${emojis.error} لا تملك صلاحية لتطبيق هذا الإجراء على العضو لأن رتبته متساوية أو أعلى من رتبتك.`, ephemeral: true });
            }
            if (!member.bannable) {
                return interaction.reply({ content: `${emojis.error} ليس لدي الصلاحيات الكافية لحظر هذا العضو (رتبتي أقل منه).`, ephemeral: true });
            }
        }

        // 1. Send DM notification if not silent
        if (!silent) {
            try {
                const dmEmbed = createModEmbed(
                    `${emojis.warn} تم تطبيق حظر خفيف (Softban) بحقك`,
                    `**السيرفر:** ${interaction.guild.name}\n` +
                    `**السبب:** ${reason}\n` +
                    `**توضيح:** تم حظرك مؤقتاً ومسح رسائلك لآخر \`${days}\` يوم ثم فك الحظر فوراً لتتمكن من العودة برابط السيرفر.`,
                    config.colors?.warning || '#FEE75C'
                );
                await user.send({ embeds: [dmEmbed] }).catch(() => {});
            } catch {}
        }

        try {
            // 2. Ban with message deletion (seconds)
            const deleteMessageSeconds = days * 24 * 60 * 60;
            await interaction.guild.members.ban(user.id, {
                deleteMessageSeconds,
                reason: `Softban (${days}d purge) by ${interaction.user.tag}: ${reason}`
            });

            // 3. Immediately unban to allow rejoining
            await interaction.guild.members.unban(user.id, `Softban auto-unban by ${interaction.user.tag}`);

            // 4. Record action for Anti-Nuke protection
            await recordModAction(interaction.guild, interaction.user.id, 'softban', interaction.client);

            // 5. Store case in SQLite
            const caseId = addCase(
                interaction.guild.id,
                'softban',
                user.id,
                interaction.user.id,
                reason,
                `مسح ${days} يوم رسائل`
            );

            // 6. Send audit embed to mod logs
            await sendModLog(
                interaction.guild,
                'softban',
                user,
                interaction.user,
                reason,
                caseId,
                `مسح رسائل ${days} يوم`
            );

            // 7. Reply confirmation
            const replyEmbed = createModEmbed(
                `${emojis.success} تم الحظر الخفيف ومسح الرسائل بنجاح`,
                `تم تطبيق الحظر الخفيف على ${user} (\`${user.tag}\`) ومسح رسائله لآخر **${days}** يوم.\n` +
                `**السبب:** ${reason}\n` +
                `${emojis.folder} **رقم القضية:** \`#${caseId}\``,
                config.colors?.success || '#57F287'
            );
            return interaction.reply({ embeds: [replyEmbed] });

        } catch (error) {
            console.error('[Softban] Execution error:', error);
            return interaction.reply({ content: `${emojis.error} حدث خطأ غير متوقع أثناء تنفيذ أمر الحظر الخفيف.`, ephemeral: true });
        }
    }
};
