const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addCase } = require('../../database/connect.js');
const { createModEmbed, sendModLog, checkHierarchy, formatDuration } = require('../../utils/helpers.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');
const ms = require('ms');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout a member')
        .addUserOption(option => option.setName('user').setDescription('User to timeout').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Duration (e.g. 10m, 1h, 1d)').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false))
        .addBooleanOption(option => option.setName('silent').setDescription('Do not send DM').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'لم يُحدد سبب';
        const silent = interaction.options.getBoolean('silent') || false;

        const durationMs = ms(durationStr);
        if (!durationMs) return interaction.reply({ content: `${emojis.error} صيغة الوقت غير صحيحة. استخدم: \`10m\`, \`1h\`, \`1d\` وغيرها.`, ephemeral: true });
        if (durationMs > ms('28d')) return interaction.reply({ content: `${emojis.error} لا يمكن أن تتجاوز مدة الكتم 28 يوماً (حد ديسكورد الأقصى).`, ephemeral: true });

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply({ content: `${emojis.error} العضو ليس موجوداً في هذا السيرفر.`, ephemeral: true });

        if (user.id === interaction.client.user.id) return interaction.reply({ content: `${emojis.error} لا يمكنك كتم البوت!`, ephemeral: true });
        if (user.id === interaction.user.id) return interaction.reply({ content: `${emojis.error} لا يمكنك كتم نفسك!`, ephemeral: true });

        if (!checkHierarchy(interaction.member, member)) {
            return interaction.reply({ content: `${emojis.error} لا تملك صلاحية لكتم هذا العضو لأن رتبته متساوية أو أعلى من رتبتك.`, ephemeral: true });
        }
        if (!member.moderatable) {
            return interaction.reply({ content: `${emojis.error} ليس لدي الصلاحيات الكافية لكتم هذا العضو (رتبتي أقل منه).`, ephemeral: true });
        }

        const formattedTime = formatDuration(durationMs);

        if (!silent) {
            try {
                const dmEmbed = createModEmbed(`${emojis.mute} تم كتمك مؤقتاً`, `**السيرفر:** ${interaction.guild.name}\n**المدة:** ${formattedTime}\n**السبب:** ${reason}`, config.colors?.warning || '#FEE75C');
                await user.send({ embeds: [dmEmbed] });
            } catch (error) {}
        }

        try {
            await member.timeout(durationMs, reason);
            const expiresAt = new Date(Date.now() + durationMs).toISOString();
            const caseId = addCase(interaction.guild.id, 'mute', user.id, interaction.user.id, reason, formattedTime, expiresAt);
            await sendModLog(interaction.guild, 'mute', user, interaction.user, reason, caseId, formattedTime);
            
            const replyEmbed = createModEmbed(`${emojis.success} تم الكتم بنجاح`, `تم كتم ${user} (\`${user.tag}\`) لمدة **${formattedTime}** بنجاح.\n**السبب:** ${reason}`, config.colors?.success || '#57F287');
            await interaction.reply({ embeds: [replyEmbed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: `${emojis.error} حدث خطأ أثناء محاولة كتم العضو.`, ephemeral: true });
        }
    }
};
