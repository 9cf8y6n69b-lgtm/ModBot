const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createModEmbed } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Bulk delete messages')
        .addIntegerOption(option => option.setName('amount').setDescription('Amount (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
        .addUserOption(option => option.setName('user').setDescription('Filter by user').setRequired(false))
        .addStringOption(option => option.setName('filter').setDescription('Filter by type')
            .addChoices(
                { name: 'Links', value: 'links' },
                { name: 'Bots', value: 'bots' },
                { name: 'Embeds', value: 'embeds' },
                { name: 'Attachments', value: 'attachments' },
                { name: 'Mentions', value: 'mentions' }
            ).setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    async execute(interaction) {
        const amount = interaction.options.getInteger('amount');
        const user = interaction.options.getUser('user');
        const filterType = interaction.options.getString('filter');

        const messages = await interaction.channel.messages.fetch({ limit: amount });
        const now = Date.now();
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;

        let messagesToDelete = messages.filter(msg => (now - msg.createdTimestamp) < fourteenDays);

        if (user) {
            messagesToDelete = messagesToDelete.filter(msg => msg.author.id === user.id);
        }

        if (filterType) {
            switch(filterType) {
                case 'links':
                    messagesToDelete = messagesToDelete.filter(msg => /https?:\/\//i.test(msg.content));
                    break;
                case 'bots':
                    messagesToDelete = messagesToDelete.filter(msg => msg.author.bot);
                    break;
                case 'embeds':
                    messagesToDelete = messagesToDelete.filter(msg => msg.embeds.length > 0);
                    break;
                case 'attachments':
                    messagesToDelete = messagesToDelete.filter(msg => msg.attachments.size > 0);
                    break;
                case 'mentions':
                    messagesToDelete = messagesToDelete.filter(msg => msg.mentions.users.size > 0 || msg.mentions.roles.size > 0);
                    break;
            }
        }

        if (messagesToDelete.size === 0) {
            return interaction.reply({ content: `${emojis.error} لم يتم العثور على رسائل تطابق الشروط المحددة (أو أن الرسائل أقدم من 14 يوماً ولا يمكن حذفها جماعياً).`, ephemeral: true });
        }

        try {
            await interaction.channel.bulkDelete(messagesToDelete, true);

            const { recordModAction } = require('../../utils/antiNuke.js');
            await recordModAction(interaction.guild, interaction.user.id, 'purge', interaction.client);

            const embed = createModEmbed(`${emojis.purge} تم تنظيف الرسائل`, `تم حذف **${messagesToDelete.size}** رسالة بنجاح.`, config.colors?.success || '#57F287');
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء محاولة حذف الرسائل.`, ephemeral: true });
        }
    }
};
