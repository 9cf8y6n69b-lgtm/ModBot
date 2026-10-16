const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { addCase } = require('../../database/connect.js');
const { sendModLog, checkHierarchy, hasModPermission } = require('../../utils/helpers.js');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Quick Mute (10m)')
        .setType(ApplicationCommandType.User)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').UserContextMenuCommandInteraction} interaction
     */
    async execute(interaction) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({ content: `${emojis.error} ليس لديك صلاحية لاستخدام هذا الأمر.`, ephemeral: true });
        }

        const targetUser = interaction.targetUser;
        if (targetUser.id === interaction.client.user.id || targetUser.id === interaction.user.id) {
            return interaction.reply({ content: `${emojis.error} لا يمكنك كتم هذا الحساب.`, ephemeral: true });
        }

        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) {
            return interaction.reply({ content: `${emojis.error} العضو ليس موجوداً في السيرفر.`, ephemeral: true });
        }

        if (!checkHierarchy(interaction.member, member)) {
            return interaction.reply({ content: `${emojis.error} لا تملك صلاحية لكتم هذا العضو (رتبته متساوية أو أعلى منك).`, ephemeral: true });
        }
        if (!member.moderatable) {
            return interaction.reply({ content: `${emojis.error} ليس لدي صلاحيات كافية لكتم هذا العضو.`, ephemeral: true });
        }

        const durationMs = 10 * 60 * 1000; // 10 minutes
        const reason = 'كتم سريع (Quick Mute 10m)';

        try {
            await member.timeout(durationMs, reason);
            const expiresAt = new Date(Date.now() + durationMs).toISOString();
            const caseId = addCase(interaction.guild.id, 'mute', targetUser.id, interaction.user.id, reason, '10 دقيقة', expiresAt);

            const dmEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle(`${emojis.mute} تم كتمك مؤقتاً`)
                .setDescription(`تم كتمك في سيرفر **${interaction.guild.name}** لمدة **10 دقائق** بواسطة مشرف.`);
            await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

            await sendModLog(interaction.guild, 'mute', targetUser, interaction.user, reason, caseId, '10 دقائق');

            await interaction.reply({
                content: `${emojis.success} تم كتم ${targetUser} (\`${targetUser.tag}\`) لمدة **10 دقائق** بنجاح.`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Quick Mute error:', error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء كتم العضو.`, ephemeral: true });
        }
    }
};
