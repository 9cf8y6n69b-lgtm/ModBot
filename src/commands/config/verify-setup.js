const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { setConfig } = require('../../database/connect.js');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify-setup')
        .setDescription('إرسال لوحة التحقق وتأكيد العضوية الذاتي (Self-Verification)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('الرتبة التي ستُمنح للعضو بعد تأكيد هويته')
                .setRequired(true)
        )
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('القناة التي سيتم إرسال اللوحة فيها (افتراضياً: القناة الحالية)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('title')
                .setDescription('عنوان رسالة التحقق')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('description')
                .setDescription('نص رسالة التحقق')
                .setRequired(false)
        ),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const verifyRole = interaction.options.getRole('role');
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        const customTitle = interaction.options.getString('title') || `${emojis.verify} التحقق وتأكيد العضوية في السيرفر`;
        const customDesc = interaction.options.getString('description') ||
            `مرحباً بك في السيرفر! للحصول على حق الدخول والاطلاع على كافة القنوات والمحادثات، يرجى قراءة القوانين ثم النقر على الزر أدناه لتأكيد هويتك.\n\n${emojis.shield} عند النقر ستحصل تلقائياً على رتبة ${verifyRole}.`;

        // Save verify role in database
        setConfig(interaction.guildId, 'verifyRoleId', verifyRole.id);

        const embed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle(customTitle)
            .setDescription(customDesc)
            .addFields(
                { name: `${emojis.scroll} الشروط والتعليمات`, value: 'بالضغط على الزر، أنت توافق على الالتزام بقواعد السيرفر وشروط خدمة الديسكورد.' },
                { name: `${emojis.badge} الرتبة المكتسبة`, value: `${verifyRole}`, inline: true }
            )
            .setFooter({ text: 'ModBot Verification System • التحقق الآمن' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_member')
                .setLabel('تأكيد العضوية (Verify)')
                .setEmoji(emojis.verify)
                .setStyle(ButtonStyle.Success)
        );

        try {
            await targetChannel.send({ embeds: [embed], components: [row] });
            await interaction.reply({
                content: `${emojis.success} تم إرسال رسالة التحقق بنجاح إلى القناة ${targetChannel} وحفظ رتبة التوثيق: ${verifyRole}!`,
                ephemeral: true
            });
        } catch (error) {
            console.error('[Verify Setup] Error sending panel:', error);
            await interaction.reply({
                content: `${emojis.error} فشل إرسال لوحة التحقق. تأكد من صلاحيات البوت في القناة المحددة وموقع رتبته مقارنة بالرتبة الممنوحة.`,
                ephemeral: true
            });
        }
    }
};
