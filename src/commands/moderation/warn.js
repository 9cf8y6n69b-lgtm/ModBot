const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addCase, addWarning, getActiveWarnings } = require('../../database/connect.js');
const { createModEmbed, sendModLog, checkHierarchy, hasModPermission, formatDuration } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');
const ms = require('ms');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a member')
        .addUserOption(option => option.setName('user').setDescription('User to warn').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({ content: `${emojis.error} ليس لديك الصلاحية لاستخدام هذا الأمر.`, ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        if (user.id === interaction.client.user.id) return interaction.reply({ content: `${emojis.error} لا يمكنك تحذير البوت!`, ephemeral: true });
        if (user.id === interaction.user.id) return interaction.reply({ content: `${emojis.error} لا يمكنك تحذير نفسك!`, ephemeral: true });

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member && !checkHierarchy(interaction.member, member)) {
            return interaction.reply({ content: `${emojis.error} لا يمكنك تحذير عضو رتبته متساوية أو أعلى من رتبتك.`, ephemeral: true });
        }

        try {
            const warningId = addWarning(interaction.guild.id, user.id, interaction.user.id, reason);
            const caseId = addCase(interaction.guild.id, 'warn', user.id, interaction.user.id, reason);
            
            try {
                const dmEmbed = createModEmbed(`${emojis.warn} تم إعطاؤك تحذيراً`, `**السيرفر:** ${interaction.guild.name}\n**السبب:** ${reason}`, config.colors?.warning || '#FEE75C');
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {}

            await sendModLog(interaction.guild, 'warn', user, interaction.user, reason, caseId);

            const activeWarnings = getActiveWarnings(interaction.guild.id, user.id);
            const warnCount = activeWarnings.length;
            const muteThreshold = config.moderation?.warnThresholdMute || 3;
            const kickThreshold = config.moderation?.warnThresholdKick || 5;
            const muteDurationStr = config.moderation?.defaultMuteDuration || '1h';

            let extraInfo = '';
            if (warnCount >= kickThreshold && member && member.kickable) {
                await user.send(`${emojis.ban} تم طردك تلقائياً من **${interaction.guild.name}** لتجاوزك الحد الأقصى من التحذيرات (${warnCount}/${kickThreshold}).`).catch(() => {});
                await member.kick(`تجاوز حد التحذيرات (${warnCount}/${kickThreshold})`);
                const kickCase = addCase(interaction.guild.id, 'kick', user.id, interaction.client.user.id, `تجاوز حد التحذيرات (${warnCount}/${kickThreshold}) (طرد تلقائي)`);
                await sendModLog(interaction.guild, 'kick', user, interaction.client.user, `تجاوز حد التحذيرات (${warnCount}/${kickThreshold})`, kickCase);
                extraInfo = `\n${emojis.ban} **تم طرد العضو تلقائياً لوصوله إلى ${kickThreshold} تحذيرات.**`;
            } else if (warnCount >= muteThreshold && member && member.moderatable) {
                const muteDuration = ms(muteDurationStr) || (60 * 60 * 1000);
                await member.timeout(muteDuration, `تجاوز حد التحذيرات (${warnCount}/${muteThreshold})`);
                const formattedTime = formatDuration(muteDuration);
                const automuteCase = addCase(interaction.guild.id, 'mute', user.id, interaction.client.user.id, `تجاوز حد التحذيرات (${warnCount}/${muteThreshold}) (كتم تلقائي)`, formattedTime);
                await sendModLog(interaction.guild, 'mute', user, interaction.client.user, `تجاوز حد التحذيرات (${warnCount}/${muteThreshold})`, automuteCase, formattedTime);
                extraInfo = `\n${emojis.mute} **تم كتم العضو تلقائياً لمدة ${formattedTime} لوصوله إلى ${muteThreshold} تحذيرات.**`;
            }
            
            const replyEmbed = createModEmbed(`${emojis.success} تم التحذير بنجاح`, `تم تحذير ${user} (\`${user.tag}\`) بنجاح.\n**السبب:** ${reason}\n${emojis.chart} **إجمالي التحذيرات النشطة:** \`${warnCount}\`${extraInfo}`, config.colors?.success || '#57F287');
            await interaction.reply({ embeds: [replyEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء محاولة تحذير العضو.`, ephemeral: true });
        }
    }
};
