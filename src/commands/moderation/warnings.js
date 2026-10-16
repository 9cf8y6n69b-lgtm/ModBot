const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { getActiveWarnings } = require('../../database/connect.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('View member warnings')
        .addUserOption(option => option.setName('user').setDescription('User to check').setRequired(true)),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const warnings = getActiveWarnings(interaction.guild.id, user.id);

        if (!warnings || warnings.length === 0) {
            return interaction.reply({ content: `${emojis.success} العضو **${user.tag}** ليس لديه أي تحذيرات نشطة حالياً.`, ephemeral: true });
        }

        const itemsPerPage = 5;
        const totalPages = Math.ceil(warnings.length / itemsPerPage);
        let currentPage = 1;

        const generateEmbed = (page) => {
            const start = (page - 1) * itemsPerPage;
            const end = start + itemsPerPage;
            const currentWarnings = warnings.slice(start, end);

            const embed = new EmbedBuilder()
                .setTitle(`${emojis.warn} تحذيرات ${user.tag} (${page}/${totalPages})`)
                .setColor(config.colors?.warning || '#FEE75C');

            const fields = currentWarnings.map(w => {
                const dateTimestamp = Math.floor(new Date(w.created_at).getTime() / 1000);
                return {
                    name: `${emojis.id} رقم التحذير: #${w.id}`,
                    value: `**${emojis.edit} السبب:** ${w.reason}\n**${emojis.mod} المشرف:** <@${w.moderator_id}>\n**${emojis.calendar} التاريخ:** <t:${dateTimestamp}:R>`,
                    inline: false
                };
            });

            embed.addFields(fields);
            return embed;
        };

        const getButtons = (page) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prev').setLabel('السابق').setEmoji(emojis.arrow_left).setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
                new ButtonBuilder().setCustomId('next').setLabel('التالي').setEmoji(emojis.arrow_right).setStyle(ButtonStyle.Primary).setDisabled(page === totalPages)
            );
        };

        const response = await interaction.reply({ embeds: [generateEmbed(currentPage)], components: totalPages > 1 ? [getButtons(currentPage)] : [], fetchReply: true });

        if (totalPages > 1) {
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) return i.reply({ content: `${emojis.error} لا يمكنك استخدام هذه الأزرار.`, ephemeral: true });
                if (i.customId === 'prev') currentPage--;
                else if (i.customId === 'next') currentPage++;
                await i.update({ embeds: [generateEmbed(currentPage)], components: [getButtons(currentPage)] });
            });
            collector.on('end', () => {
                interaction.editReply({ components: [] }).catch(() => {});
            });
        }
    }
};
