const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addCase } = require('../../database/connect.js');
const { createModEmbed, sendModLog } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user')
        .addStringOption(option => option.setName('user_id').setDescription('User ID').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    async execute(interaction) {
        const userId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('reason') || 'لم يُحدد سبب';

        try {
            const user = await interaction.client.users.fetch(userId);
            if (!user) return interaction.reply({ content: `${emojis.error} لم يتم العثور على هذا المستخدم.`, ephemeral: true });

            await interaction.guild.members.unban(userId, reason);
            const caseId = addCase(interaction.guild.id, 'unban', userId, interaction.user.id, reason);
            await sendModLog(interaction.guild, 'unban', user, interaction.user, reason, caseId);
            
            const replyEmbed = createModEmbed(`${emojis.unban} تم إلغاء الحظر بنجاح`, `تم فك الحظر عن ${user} (\`${user.tag}\`) بنجاح.\n**السبب:** ${reason}`, config.colors?.success || '#57F287');
            await interaction.reply({ embeds: [replyEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} تعذر إلغاء الحظر. تأكد من صحة الآيدي (ID) وأن العضو محظور بالفعل.`, ephemeral: true });
        }
    }
};
