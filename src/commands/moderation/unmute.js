const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addCase, deactivateUserMutes, getConfig } = require('../../database/connect.js');
const { createModEmbed, sendModLog, checkHierarchy, hasModPermission } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove member timeout')
        .setDMPermission(false)
        .addUserOption(option => option.setName('user').setDescription('User to unmute').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({ content: `${emojis.error} ليس لديك الصلاحية لاستخدام هذا الأمر.`, ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'لم يُحدد سبب';

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply({ content: `${emojis.error} العضو ليس موجوداً في هذا السيرفر.`, ephemeral: true });

        if (!checkHierarchy(interaction.member, member)) {
            return interaction.reply({ content: `${emojis.error} لا تملك صلاحية لإلغاء كتم هذا العضو لأن رتبته متساوية أو أعلى من رتبتك.`, ephemeral: true });
        }
        if (!member.moderatable) {
            return interaction.reply({ content: `${emojis.error} ليس لدي الصلاحيات الكافية للتعامل مع هذا العضو.`, ephemeral: true });
        }

        const guildConfig = getConfig(interaction.guild.id);
        const hasTimeout = typeof member.isCommunicationDisabled === 'function' && member.isCommunicationDisabled();
        const hasMuteRole = guildConfig?.mute_role_id && member.roles.cache.has(guildConfig.mute_role_id);

        if (!hasTimeout && !hasMuteRole) {
            return interaction.reply({ content: `${emojis.info} هذا العضو غير مكتوم حالياً.`, ephemeral: true });
        }

        try {
            if (hasTimeout) {
                await member.timeout(null, reason);
            }
            if (hasMuteRole) {
                const modTag = interaction.user?.tag || interaction.member?.displayName || 'Moderator';
                await member.roles.remove(guildConfig.mute_role_id, `Unmute by ${modTag}: ${reason}`).catch(() => {});
            }

            // Deactivate previous active mute cases for this user in the database
            deactivateUserMutes(interaction.guild.id, user.id);

            const moderatorId = interaction.user?.id || interaction.member?.id || 'unknown';
            const caseId = addCase(interaction.guild.id, 'unmute', user.id, moderatorId, reason);
            await sendModLog(interaction.guild, 'unmute', user, interaction.user || interaction.member, reason, caseId);
            
            const replyEmbed = createModEmbed(`${emojis.unmute} تم إلغاء الكتم بنجاح`, `تم فك الكتم عن ${user} (\`${user.tag}\`) بنجاح.\n**السبب:** ${reason}`, config.colors?.success || '#57F287');
            await interaction.reply({ embeds: [replyEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء محاولة إلغاء كتم العضو.`, ephemeral: true });
        }
    }
};
