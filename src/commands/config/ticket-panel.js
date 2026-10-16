const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket-panel')
        .setDescription('إرسال لوحة فتح تكتات الدعم الفني والبلاغات')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('القناة التي سيتم إرسال اللوحة فيها (افتراضياً: القناة الحالية)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('title')
                .setDescription('عنوان لوحة التكتات')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('description')
                .setDescription('نص الوصف في لوحة التكتات')
                .setRequired(false)
        ),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        const customTitle = interaction.options.getString('title') || `${emojis.ticket} مركز الدعم الفني والمساعدة`;
        const customDesc = interaction.options.getString('description') || 'إذا كنت بحاجة إلى مساعدة، استفسار، أو ترغب في تقديم بلاغ لإدارة السيرفر، يرجى الضغط على الزر أدناه لفتح تكت خاص بك.';

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(customTitle)
            .setDescription(customDesc)
            .addFields(
                { name: `${emojis.lock} خصوصية تامة`, value: 'يتم إنشاء روم خاص بك يراه المشرفون فقط.', inline: true },
                { name: `${emojis.zap} استجابة فورية`, value: 'سيتواجد أحد المشرفين للرد على استفسارك في أقرب وقت.', inline: true }
            )
            .setFooter({ text: 'ModBot Support System • نظام التكتات المتكامل' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_create')
                .setLabel('فتح تكت دعم / بلاغ')
                .setEmoji(emojis.ticket)
                .setStyle(ButtonStyle.Primary)
        );

        try {
            await targetChannel.send({ embeds: [embed], components: [row] });
            await interaction.reply({
                content: `${emojis.success} تم إرسال لوحة التكتات بنجاح إلى القناة ${targetChannel}!`,
                ephemeral: true
            });
        } catch (error) {
            console.error('[Ticket Panel] Error sending panel:', error);
            await interaction.reply({
                content: `${emojis.error} فشل إرسال لوحة التكتات. تأكد من صلاحيات البوت في القناة المحددة.`,
                ephemeral: true
            });
        }
    }
};
