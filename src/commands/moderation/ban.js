const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addCase } = require('../../database/connect.js');
const { createModEmbed, sendModLog, checkHierarchy } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member')
        .addUserOption(option => option.setName('user').setDescription('User to ban').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false))
        .addIntegerOption(option => option.setName('delete_days').setDescription('Delete message history days (0-7)').setRequired(false).setMinValue(0).setMaxValue(7))
        .addBooleanOption(option => option.setName('silent').setDescription('Do not send DM').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'لم يُحدد سبب';
        const deleteDays = interaction.options.getInteger('delete_days') || 0;
        const silent = interaction.options.getBoolean('silent') || false;

        if (user.id === interaction.client.user.id) return interaction.reply({ content: `${emojis.error} لا يمكنك حظر البوت!`, ephemeral: true });
        if (user.id === interaction.user.id) return interaction.reply({ content: `${emojis.error} لا يمكنك حظر نفسك!`, ephemeral: true });

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (member) {
            if (!checkHierarchy(interaction.member, member)) {
                return interaction.reply({ content: `${emojis.error} لا تملك صلاحية لحظر هذا العضو لأن رتبته متساوية أو أعلى من رتبتك.`, ephemeral: true });
            }
            if (!member.bannable) {
                return interaction.reply({ content: `${emojis.error} ليس لدي الصلاحيات الكافية لحظر هذا العضو (رتبتي أقل منه).`, ephemeral: true });
            }
            if (!silent) {
                try {
                    const dmEmbed = createModEmbed(`${emojis.ban} تم حظرك من السيرفر`, `**السيرفر:** ${interaction.guild.name}\n**السبب:** ${reason}`, config.colors?.danger || '#ED4245');
                    await user.send({ embeds: [dmEmbed] });
                } catch (error) {}
            }
        }

        try {
            await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: deleteDays * 24 * 60 * 60 });
            const caseId = addCase(interaction.guild.id, 'ban', user.id, interaction.user.id, reason);
            await sendModLog(interaction.guild, 'ban', user, interaction.user, reason, caseId);
            
            const { recordModAction } = require('../../utils/antiNuke.js');
            await recordModAction(interaction.guild, interaction.user.id, 'ban', interaction.client);

            const replyEmbed = createModEmbed(`${emojis.success} تم الحظر بنجاح`, `تم حظر ${user} (\`${user.tag}\`) بنجاح.\n**السبب:** ${reason}`, config.colors?.success || '#57F287');
            await interaction.reply({ embeds: [replyEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء محاولة حظر العضو.`, ephemeral: true });
        }
    }
};
