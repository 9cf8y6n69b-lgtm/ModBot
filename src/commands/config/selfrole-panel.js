const {
    SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType
} = require('discord.js');
const db = require('../../database/connect.js');
const config = require('../../../config.json');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('selfrole-panel')
        .setDescription('Manage self-assignable reaction roles and deploy interactive panels')
        .addSubcommand(sub =>
            sub.setName('send')
                .setDescription('Deploy interactive self-roles button panel in a channel')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('The channel to send the panel in')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('title')
                        .setDescription('Panel embed title')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Panel embed description')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a new self-assignable role to the server list')
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('The role to make self-assignable')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('label')
                        .setDescription('Display name on the button')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('emoji')
                        .setDescription('Emoji for the button (optional)')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Brief role description')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a self-assignable role from the list')
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('The role to remove')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all configured self-assignable roles'))
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: `${emojis.error} لا يمكن استخدام هذا الأمر إلا داخل السيرفرات.`, ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'add') {
            const role = interaction.options.getRole('role');
            const label = interaction.options.getString('label');
            const emoji = interaction.options.getString('emoji') || null;
            const description = interaction.options.getString('description') || null;

            // Check if role is higher than bot
            const me = interaction.guild.members.me;
            if (me && role.position >= me.roles.highest.position) {
                return interaction.reply({
                    content: `${emojis.warn} رتبة البوت أقل من أو مساوية لهذه الرتبة! يرجى رفع رتبة البوت فوق هذه الرتبة ليتمكن من منحها للأعضاء.`,
                    ephemeral: true
                });
            }

            db.addSelfRole(guildId, role.id, label, emoji, description);

            const embed = new EmbedBuilder()
                .setColor(config.colors?.success || '#57F287')
                .setTitle(`${emojis.success} تمت إضافة الرتبة التفاعلية`)
                .setDescription(`تمت إضافة ${role} إلى قائمة الرتب الذاتية بنجاح.\n**الاسم على الزر:** \`${label}\`${emoji ? `\n**الإيموجي:** ${emoji}` : ''}`)
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === 'remove') {
            const role = interaction.options.getRole('role');
            const removed = db.removeSelfRole(guildId, role.id);
            if (removed > 0) {
                return interaction.reply({
                    content: `${emojis.success} تم حذف الرتبة ${role} من قائمة الرتب الذاتية بنجاح.`,
                    ephemeral: true
                });
            } else {
                return interaction.reply({
                    content: `${emojis.error} لم تكن هذه الرتبة مسجلة في قائمة الرتب الذاتية.`,
                    ephemeral: true
                });
            }
        }

        if (sub === 'list') {
            const roles = db.getSelfRoles(guildId);
            if (!roles || roles.length === 0) {
                return interaction.reply({
                    content: `${emojis.info} لا توجد رتب تفاعلية مضافة بعد. أضف بعض الرتب أولاً باستخدام \`/selfrole-panel add\`.`,
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setColor(config.colors?.primary || '#5865F2')
                .setTitle(`${emojis.mask} قائمة الرتب التفاعلية الذاتية (${roles.length})`)
                .setDescription(roles.map((r, i) => `${i + 1}. <@&${r.role_id}> — **${r.label}** ${r.emoji ? `(${r.emoji})` : ''}`).join('\n'))
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === 'send') {
            const channel = interaction.options.getChannel('channel');
            const title = interaction.options.getString('title') || `${emojis.mask} لوحة اختيار الرتب التفاعلية`;
            const description = interaction.options.getString('description') ||
                'اضغط على الأزرار بالأسفل للحصول على الرتبة أو إزالتها من حسابك بكل سهولة.';

            const roles = db.getSelfRoles(guildId);
            if (!roles || roles.length === 0) {
                return interaction.reply({
                    content: `${emojis.error} لا توجد أي رتب مسجلة في قائمة السيرفر بعد! أضف بعض الرتب أولاً عبر \`/selfrole-panel add\`.`,
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setColor(config.colors?.primary || '#5865F2')
                .setTitle(title)
                .setDescription(description)
                .setFooter({ text: 'النظام يدعم التبديل (اضغط مرة للحصول على الرتبة، واضغط مجدداً لإزالتها)' })
                .setTimestamp();

            // Build ActionRows (maximum 5 buttons per row, up to 25 buttons)
            const rows = [];
            let currentRow = new ActionRowBuilder();

            roles.slice(0, 25).forEach((r, idx) => {
                if (idx > 0 && idx % 5 === 0) {
                    rows.push(currentRow);
                    currentRow = new ActionRowBuilder();
                }

                const btn = new ButtonBuilder()
                    .setCustomId(`selfrole_toggle_${r.role_id}`)
                    .setLabel(r.label)
                    .setStyle(ButtonStyle.Secondary);

                if (r.emoji) {
                    try {
                        btn.setEmoji(r.emoji);
                    } catch {}
                }

                currentRow.addComponents(btn);
            });

            if (currentRow.components.length > 0) {
                rows.push(currentRow);
            }

            try {
                await channel.send({ embeds: [embed], components: rows });
                return interaction.reply({
                    content: `${emojis.success} تم نشر لوحة الرتب التفاعلية بنجاح في القناة ${channel}!`,
                    ephemeral: true
                });
            } catch (err) {
                console.error('[SelfRole Panel] Error sending panel:', err);
                return interaction.reply({
                    content: `${emojis.error} حدث خطأ أثناء إرسال اللوحة. تأكد من امتلاك البوت لصلاحيات الإرسال في تلك القناة.`,
                    ephemeral: true
                });
            }
        }
    }
};
