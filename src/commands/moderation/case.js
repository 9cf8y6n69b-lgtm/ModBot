const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, PermissionFlagsBits } = require('discord.js');
const { getCaseByNumber, getCases, db } = require('../../database/connect.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

const ACTION_MAP = {
    ban: 'حظر نهائي (Ban)',
    unban: 'إلغاء حظر (Unban)',
    kick: 'طرد (Kick)',
    mute: 'كتم مؤقت (Timeout)',
    unmute: 'إلغاء كتم (Unmute)',
    warn: 'تحذير (Warn)',
    lockdown: 'إغلاق روم (Lockdown)',
    unlock: 'فتح روم (Unlock)',
    slowmode: 'وضع بطيء (Slowmode)'
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('case')
        .setDescription('Manage moderation cases')
        .addSubcommand(subcommand => subcommand
            .setName('view')
            .setDescription('View a specific case')
            .addIntegerOption(option => option.setName('case_number').setDescription('Case number').setRequired(true))
        )
        .addSubcommand(subcommand => subcommand
            .setName('history')
            .setDescription('View member case history')
            .addUserOption(option => option.setName('user').setDescription('Target user').setRequired(true))
        )
        .addSubcommand(subcommand => subcommand
            .setName('reason')
            .setDescription('Update a case reason')
            .addIntegerOption(option => option.setName('case_number').setDescription('Case number').setRequired(true))
            .addStringOption(option => option.setName('new_reason').setDescription('New reason').setRequired(true))
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            const caseNumber = interaction.options.getInteger('case_number');
            const caseData = getCaseByNumber(interaction.guild.id, caseNumber);
            if (!caseData) return interaction.reply({ content: `${emojis.error} لم يتم العثور على هذه القضية.`, ephemeral: true });

            const actionName = ACTION_MAP[caseData.action?.toLowerCase()] || caseData.action?.toUpperCase();
            const dateTimestamp = Math.floor(new Date(caseData.created_at).getTime() / 1000);

            const embed = new EmbedBuilder()
                .setTitle(`${emojis.case} تفاصيل القضية #${caseData.case_number} | ${actionName}`)
                .setColor(config.colors?.info || '#5865F2')
                .addFields(
                    { name: `${emojis.user} العضو المعني`, value: `<@${caseData.user_id}> (\`${caseData.user_id}\`)`, inline: true },
                    { name: `${emojis.mod} المشرف المسؤول`, value: `<@${caseData.moderator_id}> (\`${caseData.moderator_id}\`)`, inline: true },
                    { name: `${emojis.edit} السبب`, value: caseData.reason || 'لم يُحدد سبب', inline: false },
                    { name: `${emojis.calendar} التاريخ والوقت`, value: `<t:${dateTimestamp}:F> (<t:${dateTimestamp}:R>)`, inline: false }
                );
            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'history') {
            const user = interaction.options.getUser('user');
            const cases = getCases(interaction.guild.id, user.id);
            if (!cases || cases.length === 0) return interaction.reply({ content: `${emojis.success} لا توجد أي قضايا أو مخالفات مسجلة للعضو **${user.tag}**.`, ephemeral: true });

            const itemsPerPage = 5;
            const totalPages = Math.ceil(cases.length / itemsPerPage);
            let currentPage = 1;

            const generateEmbed = (page) => {
                const start = (page - 1) * itemsPerPage;
                const end = start + itemsPerPage;
                const currentCases = cases.slice(start, end);

                const embed = new EmbedBuilder()
                    .setTitle(`${emojis.case} سجل قضايا ${user.tag} (${page}/${totalPages})`)
                    .setColor(config.colors?.info || '#5865F2');

                currentCases.forEach(c => {
                    const actionName = ACTION_MAP[c.action?.toLowerCase()] || c.action?.toUpperCase();
                    const dateTimestamp = Math.floor(new Date(c.created_at).getTime() / 1000);
                    embed.addFields({
                        name: `قضية #${c.case_number} | ${actionName}`,
                        value: `**${emojis.mod} المشرف:** <@${c.moderator_id}>\n**${emojis.edit} السبب:** ${c.reason}\n**${emojis.calendar} التاريخ:** <t:${dateTimestamp}:d>`,
                        inline: false
                    });
                });
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

        if (subcommand === 'reason') {
            const caseNumber = interaction.options.getInteger('case_number');
            const newReason = interaction.options.getString('new_reason');

            const stmt = db.prepare('UPDATE cases SET reason = ? WHERE guild_id = ? AND case_number = ?');
            const result = stmt.run(newReason, interaction.guild.id, caseNumber);

            if (result.changes === 0) return interaction.reply({ content: `${emojis.error} لم يتم العثور على القضية المحددة.`, ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(`${emojis.success} تم تحديث سبب القضية`)
                .setDescription(`تم تحديث السبب للقضية رقم **#${caseNumber}** بنجاح.`)
                .setColor(config.colors?.success || '#57F287')
                .addFields({ name: `${emojis.edit} السبب الجديد`, value: newReason });
            return interaction.reply({ embeds: [embed] });
        }
    }
};
