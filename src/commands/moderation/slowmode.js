const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createModEmbed, sendModLog } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set channel slowmode')
        .addIntegerOption(option => option.setName('seconds').setDescription('Seconds (0 to disable)').setRequired(true).setMinValue(0).setMaxValue(21600))
        .addChannelOption(option => option.setName('channel').setDescription('Target channel').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction) {
        const seconds = interaction.options.getInteger('seconds');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        try {
            await channel.setRateLimitPerUser(seconds, `تم الضبط بواسطة ${interaction.user.tag}`);
            
            const actionStr = seconds === 0 ? 'تم تعطيل الوضع البطيء' : `تم ضبط الوضع البطيء على **${seconds} ثانية**`;
            const embed = createModEmbed(`${emojis.slowmode} تحديث الوضع البطيء`, `${actionStr} في ${channel}.`, config.colors?.success || '#57F287');
            await interaction.reply({ embeds: [embed] });
            
            await sendModLog(interaction.guild, 'slowmode', null, interaction.user, `${actionStr} في #${channel.name}`);
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء ضبط الوضع البطيء.`, ephemeral: true });
        }
    }
};
