const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addCase } = require('../../database/connect.js');
const { createModEmbed, sendModLog, checkHierarchy } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member')
        .addUserOption(option => option.setName('user').setDescription('User to kick').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false))
        .addBooleanOption(option => option.setName('silent').setDescription('Do not send DM').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'لم يُحدد سبب';
        const silent = interaction.options.getBoolean('silent') || false;

        if (user.id === interaction.client.user.id) return interaction.reply({ content: `${emojis.error} لا يمكنك طرد البوت!`, ephemeral: true });
        if (user.id === interaction.user.id) return interaction.reply({ content: `${emojis.error} لا يمكنك طرد نفسك!`, ephemeral: true });

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply({ content: `${emojis.error} العضو ليس موجوداً في هذا السيرفر.`, ephemeral: true });

        if (!checkHierarchy(interaction.member, member)) {
            return interaction.reply({ content: `${emojis.error} لا تملك صلاحية لطرد هذا العضو لأن رتبته متساوية أو أعلى من رتبتك.`, ephemeral: true });
        }
        if (!member.kickable) {
            return interaction.reply({ content: `${emojis.error} ليس لدي الصلاحيات الكافية لطرد هذا العضو (رتبتي أقل منه).`, ephemeral: true });
        }

        if (!silent) {
            try {
                const dmEmbed = createModEmbed(`${emojis.warn} تم طردك من السيرفر`, `**السيرفر:** ${interaction.guild.name}\n**السبب:** ${reason}`, config.colors?.warning || '#FEE75C');
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {}
        }

        try {
            await member.kick(reason);
            const caseId = addCase(interaction.guild.id, 'kick', user.id, interaction.user.id, reason);
            await sendModLog(interaction.guild, 'kick', user, interaction.user, reason, caseId);
            
            const { recordModAction } = require('../../utils/antiNuke.js');
            await recordModAction(interaction.guild, interaction.user.id, 'kick', interaction.client);

            const replyEmbed = createModEmbed(`${emojis.success} تم الطرد بنجاح`, `تم طرد ${user} (\`${user.tag}\`) بنجاح.\n**السبب:** ${reason}`, config.colors?.success || '#57F287');
            await interaction.reply({ embeds: [replyEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء محاولة طرد العضو.`, ephemeral: true });
        }
    }
};
