const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createModEmbed, sendModLog } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('Lock a channel')
        .addChannelOption(option => option.setName('channel').setDescription('Channel to lock').setRequired(false))
        .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'لم يُحدد سبب';

        try {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: false
            }, { reason });

            const embed = createModEmbed(`${emojis.lock} تم إغلاق القناة`, `تم قفل هذه القناة ومنع إرسال الرسائل مؤقتاً.\n**السبب:** ${reason}`, config.colors?.danger || '#ED4245');
            await channel.send({ embeds: [embed] });
            
            if (channel.id !== interaction.channel.id) {
                await interaction.reply({ content: `${emojis.success} تم إغلاق القناة ${channel} بنجاح.`, ephemeral: true });
            } else {
                await interaction.reply({ content: `${emojis.success} تم إغلاق هذه القناة بنجاح.`, ephemeral: true });
            }

            await sendModLog(interaction.guild, 'lockdown', null, interaction.user, `${reason} (#${channel.name})`);
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء إغلاق القناة.`, ephemeral: true });
        }
    }
};
