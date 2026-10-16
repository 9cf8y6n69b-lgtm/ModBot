const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { deactivateWarning } = require('../../database/connect.js');
const { createModEmbed } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removewarn')
        .setDescription('Remove a warning')
        .addIntegerOption(option => option.setName('warning_id').setDescription('Warning ID').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
        const warningId = interaction.options.getInteger('warning_id');

        try {
            const changes = deactivateWarning(warningId, interaction.guild.id);
            if (changes === 0) {
                return interaction.reply({ content: `${emojis.error} لم يتم العثور على هذا التحذير، أو قد تم إلغاؤه مسبقاً.`, ephemeral: true });
            }

            const replyEmbed = createModEmbed(`${emojis.success} تم إلغاء التحذير`, `تم إلغاء وتجريد التحذير رقم **#${warningId}** بنجاح.`, config.colors?.success || '#57F287');
            await interaction.reply({ embeds: [replyEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء محاولة إلغاء التحذير.`, ephemeral: true });
        }
    }
};
