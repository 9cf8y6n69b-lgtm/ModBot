const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/connect.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

const MEDALS = [emojis.medal1, emojis.medal2, emojis.medal3, '`#4`', '`#5`', '`#6`', '`#7`', '`#8`', '`#9`', '`#10`'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('top-members')
        .setDescription('Display server most active members leaderboard')
        .setDMPermission(false)
        .addStringOption(option =>
            option.setName('timeframe')
                .setDescription('Leaderboard timeframe')
                .setRequired(false)
                .addChoices(
                    { name: 'اليوم (Today)', value: '1' },
                    { name: 'هذا الأسبوع (This Week - 7 Days)', value: '7' },
                    { name: 'هذا الشهر (This Month - 30 Days)', value: '30' },
                    { name: 'طوال الوقت (All-Time)', value: '0' }
                )),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} لا يمكن استخدام هذا الأمر إلا داخل السيرفرات.`, ephemeral: true });
        }

        const timeframeVal = interaction.options.getString('timeframe') || '7';
        const days = parseInt(timeframeVal, 10);
        const guildId = interaction.guild.id;

        const timeframeLabels = {
            '1': 'اليوم (آخر 24 ساعة)',
            '7': 'هذا الأسبوع (آخر 7 أيام)',
            '30': 'هذا الشهر (آخر 30 يوماً)',
            '0': 'طوال الوقت (All-Time)'
        };

        const topMembers = db.getTopMembers(guildId, days, 10);

        if (!topMembers || topMembers.length === 0) {
            return interaction.reply({
                content: `${emojis.info} لم يتم تسجيل أي نشاط رسائل في السيرفر لفترة **${timeframeLabels[timeframeVal]}** بعد. ابدأوا المحادثة لتظهروا في لوحة الصدارة!`,
                ephemeral: true
            });
        }

        const totalMessages = topMembers.reduce((acc, m) => acc + Number(m.total_messages || 0), 0);

        const lines = topMembers.map((m, idx) => {
            const medal = MEDALS[idx] || `\`#${idx + 1}\``;
            const count = Number(m.total_messages || 0).toLocaleString('ar-EG');
            const percent = totalMessages > 0 ? ((Number(m.total_messages) / totalMessages) * 100).toFixed(1) : 0;
            return `${medal} <@${m.user_id}> — **${count}** رسالة \`(${percent}%)\``;
        });

        const embed = new EmbedBuilder()
            .setColor(config.colors?.primary || '#5865F2')
            .setTitle(`${emojis.trophy} لوحة صدارة الأعضاء الأكثر تفاعلاً`)
            .setDescription(`**الفترة:** ${timeframeLabels[timeframeVal]}\n**إجمالي رسائل المتصدرين:** \`${totalMessages.toLocaleString('ar-EG')}\` رسالة\n\n${lines.join('\n\n')}`)
            .setFooter({ text: 'يتم احتساب الرسائل تلقائياً وبأمان تام دون تخزين أي نصوص حفاظاً على الخصوصية' })
            .setTimestamp();

        if (typeof interaction.guild.iconURL === 'function') {
            const icon = interaction.guild.iconURL({ dynamic: true });
            if (icon && typeof icon === 'string' && icon.trim().length > 0) {
                embed.setThumbnail(icon);
            }
        }

        return interaction.reply({ embeds: [embed] });
    }
};
