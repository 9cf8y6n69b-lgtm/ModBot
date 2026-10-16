const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createModEmbed, sendModLog } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlock a channel')
        .addChannelOption(option => option.setName('channel').setDescription('Channel to unlock').setRequired(false))
        .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'لم يُحدد سبب';

        try {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: null
            }, { reason });

            const embed = createModEmbed(`${emojis.unlock} تم فتح القناة`, `تم إلغاء قفل القناة والسماح بإرسال الرسائل مجدداً.\n**السبب:** ${reason}`, config.colors?.success || '#57F287');
            await channel.send({ embeds: [embed] });

            if (channel.id !== interaction.channel.id) {
                await interaction.reply({ content: `${emojis.success} تم فتح القناة ${channel} بنجاح.`, ephemeral: true });
            } else {
                await interaction.reply({ content: `${emojis.success} تم فتح هذه القناة بنجاح.`, ephemeral: true });
            }

            await sendModLog(interaction.guild, 'unlock', null, interaction.user, `${reason} (#${channel.name})`);
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء فتح القناة.`, ephemeral: true });
        }
    }
};
