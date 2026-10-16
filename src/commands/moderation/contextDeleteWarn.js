const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { addWarning, addCase, getActiveWarnings } = require('../../database/connect.js');
const { sendModLog, checkHierarchy, hasModPermission } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Delete & Warn')
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction
     */
    async execute(interaction) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({ content: `${emojis.error} ليس لديك صلاحية لاستخدام هذا الأمر.`, ephemeral: true });
        }

        const targetMessage = interaction.targetMessage;
        if (!targetMessage) {
            return interaction.reply({ content: `${emojis.error} تعذر العثور على الرسالة.`, ephemeral: true });
        }

        const author = targetMessage.author;
        if (author.id === interaction.client.user.id || author.id === interaction.user.id || author.bot) {
            return interaction.reply({ content: `${emojis.error} لا يمكن تحذير هذا الحساب.`, ephemeral: true });
        }

        const member = await interaction.guild.members.fetch(author.id).catch(() => null);
        if (member && !checkHierarchy(interaction.member, member)) {
            return interaction.reply({ content: `${emojis.error} لا تملك صلاحية لتحذير هذا العضو (رتبته متساوية أو أعلى منك).`, ephemeral: true });
        }

        const contentPreview = targetMessage.content ? targetMessage.content.substring(0, 500) : '[مرفقات أو إمبد]';

        try {
            // Delete message
            await targetMessage.delete().catch(() => {});

            // Record warning & case
            const reason = `حذف وتحذير سريع في #${interaction.channel.name}: "${contentPreview}"`;
            const warningId = addWarning(interaction.guild.id, author.id, interaction.user.id, reason);
            const caseId = addCase(interaction.guild.id, 'warn', author.id, interaction.user.id, reason);

            // DM user
            const dmEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle(`${emojis.warn} تم حذف رسالتك وتحذيرك`)
                .setDescription(`تم حذف رسالتك في **#${interaction.channel.name}** وتحذيرك بواسطة مشرف.\n**المحتوى:** \`${contentPreview}\``);
            await author.send({ embeds: [dmEmbed] }).catch(() => {});

            // Send Mod Log
            await sendModLog(interaction.guild, 'warn', author, interaction.user, reason, caseId);

            const activeWarnings = getActiveWarnings(interaction.guild.id, author.id);
            await interaction.reply({
                content: `${emojis.success} تم حذف الرسالة وتحذير ${author} بنجاح. (إجمالي التحذيرات: \`${activeWarnings.length}\`)`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Delete & Warn error:', error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء تنفيذ الإجراء.`, ephemeral: true });
        }
    }
};
