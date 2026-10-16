const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const emojis = require('../../utils/emojis');

const TIER_TARGETS = {
    0: { next: 1, required: 2, name: 'المستوى 0 (Level 0)' },
    1: { next: 2, required: 7, name: 'المستوى 1 (Level 1)' },
    2: { next: 3, required: 14, name: 'المستوى 2 (Level 2)' },
    3: { next: null, required: 14, name: 'المستوى 3 الأقصى (Max Level 3)' }
};

const TIER_PERKS = {
    0: '• لا توجد مميزات إضافية بعد',
    1: '• 100 إيموجي مخصص + 15 ستيكر\n• جودة صوت 128 Kbps\n• خلفية مخصصة لروابط الدعوة (Invite Splash)\n• بث فيديو بجودة 720p 60fps',
    2: '• 150 إيموجي مخصص + 30 ستيكر\n• جودة صوت 256 Kbps\n• سعة رفع ملفات 50MB لجميع الأعضاء\n• بنر ثابت للسيرفر (Server Banner)\n• بث فيديو بجودة 1080p 60fps',
    3: '• 250 إيموجي مخصص + 60 ستيكر\n• جودة صوت 384 Kbps\n• سعة رفع ملفات 100MB لجميع الأعضاء\n• رابط مخصص للسيرفر (Vanity URL)\n• بنر متحرك للسيرفر (Animated Banner)'
};

function createProgressBar(current, target, totalBars = 10) {
    if (!target || target <= 0) return '`[██████████]` 100%';
    const progress = Math.min(Math.max(current / target, 0), 1);
    const filledBars = Math.round(progress * totalBars);
    const emptyBars = totalBars - filledBars;
    const barStr = '█'.repeat(filledBars) + '░'.repeat(emptyBars);
    const percent = Math.round(progress * 100);
    return `\`[${barStr}]\` **${percent}%** (${current}/${target})`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('boost')
        .setDescription('عرض تفاصيل مستوى البوست (Server Boosts) وقائمة الأعضاء الداعمين')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('فحص حالة الدعم لعضو محدد')
                .setRequired(false)
        ),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const { guild } = interaction;
        const targetUser = interaction.options.getUser('user');

        // Case 1: Check a specific user's booster status
        if (targetUser) {
            const member = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return interaction.reply({
                    content: `${emojis.error} لم يتم العثور على هذا العضو في السيرفر.`,
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setColor('#F47FFF')
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

            if (member.premiumSince) {
                const sinceTimestamp = Math.floor(member.premiumSinceTimestamp / 1000);
                embed
                    .setTitle(`${emojis.boost} حالة دعم السيرفر: ${targetUser.tag}`)
                    .setDescription(`هذا العضو يدعم سيرفر **${guild.name}** حالياً! شكراً لمساهمته الرائعة ${emojis.heart}`)
                    .addFields(
                        { name: `${emojis.calendar} تاريخ بدء التعزيز`, value: `<t:${sinceTimestamp}:F> (<t:${sinceTimestamp}:R>)`, inline: false },
                        { name: `${emojis.verify} رتبة الدعم`, value: guild.roles.premiumSubscriberRole ? `<@&${guild.roles.premiumSubscriberRole.id}>` : 'داعَم السيرفر', inline: true }
                    );
            } else {
                embed
                    .setTitle(`${emojis.info} حالة دعم السيرفر: ${targetUser.tag}`)
                    .setDescription(`هذا العضو **لا يدعم** السيرفر حالياً.`);
            }

            return interaction.reply({ embeds: [embed] });
        }

        // Case 2: Server-wide boost statistics
        await guild.fetch().catch(() => {});
        const tier = guild.premiumTier || 0;
        const count = guild.premiumSubscriptionCount || 0;
        const tierInfo = TIER_TARGETS[tier] || TIER_TARGETS[0];

        let nextTargetStr = '';
        let progressBar = '';
        if (tier < 3 && tierInfo.next) {
            const targetReq = TIER_TARGETS[tier].required;
            const needed = Math.max(targetReq - count, 0);
            progressBar = createProgressBar(count, targetReq);
            nextTargetStr = `متبقي **${needed}** بوست للوصول إلى **المستوى ${tierInfo.next}**`;
        } else {
            progressBar = '`[██████████]` **100%** (الحد الأقصى)';
            nextTargetStr = `${emojis.party} تم تحقيق أعلى مستوى تعزيز للسيرفر!`;
        }

        // Fetch boosters
        const boosters = guild.members.cache.filter(m => m.premiumSince);
        let boostersList = 'لا يوجد داعمون حالياً.';
        if (boosters.size > 0) {
            const topBoosters = Array.from(boosters.values())
                .sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp)
                .slice(0, 10);

            boostersList = topBoosters.map((m, idx) => {
                const time = Math.floor(m.premiumSinceTimestamp / 1000);
                return `**${idx + 1}.** ${m} — منذ <t:${time}:R>`;
            }).join('\n');

            if (boosters.size > 10) {
                boostersList += `\n*... و ${boosters.size - 10} داعمين إضافيين.*`;
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#F47FFF')
            .setTitle(`${emojis.boost} حالة تعزيز السيرفر: ${guild.name}`)
            .setThumbnail(guild.iconURL({ dynamic: true }) || null)
            .setDescription(`**المستوى الحالي:** ${tierInfo.name}\n` +
                `**إجمالي البوستات:** \`${count}\` بوست ${emojis.diamond}\n\n` +
                `${emojis.chart} **شريط التقدم نحو المستوى التالي:**\n${progressBar}\n${nextTargetStr}`)
            .addFields(
                { name: `${emojis.gift} مميزات المستوى الحالي`, value: TIER_PERKS[tier] || '—', inline: false },
                { name: `${emojis.heart} قائمة الداعمين النشطين (${boosters.size})`, value: boostersList, inline: false }
            )
            .setFooter({ text: 'ModBot Server Boost Analytics • تعزيز السيرفر' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};
