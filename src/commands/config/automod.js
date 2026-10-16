const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getConfig, setConfig } = require('../../database/connect.js');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Configure automod settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('Toggle automod on/off')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('antispam')
                .setDescription('Toggle anti-spam')
                .addStringOption(option =>
                    option.setName('state')
                        .setDescription('State (on/off)')
                        .setRequired(true)
                        .addChoices(
                            { name: 'On', value: 'on' },
                            { name: 'Off', value: 'off' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('antiraid')
                .setDescription('Toggle anti-raid')
                .addStringOption(option =>
                    option.setName('state')
                        .setDescription('State (on/off)')
                        .setRequired(true)
                        .addChoices(
                            { name: 'On', value: 'on' },
                            { name: 'Off', value: 'off' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('addword')
                .setDescription('Add word to filter')
                .addStringOption(option =>
                    option.setName('word')
                        .setDescription('Word to block')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('removeword')
                .setDescription('Remove word from filter')
                .addStringOption(option =>
                    option.setName('word')
                        .setDescription('Word to unblock')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('wordlist')
                .setDescription('View filtered words')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('settings')
                .setDescription('View automod settings')
        ),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const config = getConfig(guildId) || {};

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTimestamp();

        switch (subcommand) {
            case 'toggle': {
                const currentState = config.automodEnabled === 1;
                setConfig(guildId, 'automodEnabled', currentState ? 0 : 1);
                embed.setDescription(`${emojis.shield} تم **${currentState ? 'تعطيل' : 'تفعيل'}** نظام المراقبة التلقائية (AutoMod) بنجاح.`);
                break;
            }
            case 'antispam': {
                const state = interaction.options.getString('state') === 'on' ? 1 : 0;
                setConfig(guildId, 'antiSpam', state);
                embed.setDescription(`${emojis.ban} تم **${state ? 'تفعيل' : 'تعطيل'}** مكافحة السبام (Anti-Spam) بنجاح.`);
                break;
            }
            case 'antiraid': {
                const state = interaction.options.getString('state') === 'on' ? 1 : 0;
                setConfig(guildId, 'antiRaid', state);
                embed.setDescription(`${emojis.sword} تم **${state ? 'تفعيل' : 'تعطيل'}** مكافحة الريد والهجمات (Anti-Raid) بنجاح.`);
                break;
            }
            case 'addword': {
                const word = interaction.options.getString('word').toLowerCase();
                let words = config.filteredWords ? JSON.parse(config.filteredWords) : [];
                if (!words.includes(word)) {
                    words.push(word);
                    setConfig(guildId, 'filteredWords', JSON.stringify(words));
                    embed.setDescription(`${emojis.success} تمت إضافة الكلمة \`${word}\` إلى قائمة الكلمات المحظورة بنجاح.`);
                } else {
                    embed.setDescription(`${emojis.warn} الكلمة \`${word}\` موجودة بالفعل في قائمة الحظر.`).setColor('#ED4245');
                }
                break;
            }
            case 'removeword': {
                const word = interaction.options.getString('word').toLowerCase();
                let words = config.filteredWords ? JSON.parse(config.filteredWords) : [];
                if (words.includes(word)) {
                    words = words.filter(w => w !== word);
                    setConfig(guildId, 'filteredWords', JSON.stringify(words));
                    embed.setDescription(`${emojis.success} تم حذف الكلمة \`${word}\` من قائمة الكلمات المحظورة.`);
                } else {
                    embed.setDescription(`${emojis.error} لم يتم العثور على الكلمة \`${word}\` في قائمة الحظر.`).setColor('#ED4245');
                }
                break;
            }
            case 'wordlist': {
                const words = config.filteredWords ? JSON.parse(config.filteredWords) : [];
                embed.setTitle(`${emojis.case} قائمة الكلمات المحظورة بالسيرفر`)
                    .setDescription(words.length > 0 ? words.map(w => `\`${w}\``).join(' • ') : 'لا توجد أي كلمات محظورة مضافة حالياً.');
                break;
            }
            case 'settings': {
                const words = config.filteredWords ? JSON.parse(config.filteredWords) : [];
                embed.setTitle(`${emojis.shield} حالة إعدادات الحماية التلقائية (AutoMod)`)
                    .addFields(
                        { name: 'نظام المراقبة التلقائية', value: config.automodEnabled === 1 ? `${emojis.success} مفعّل` : `${emojis.error} معطّل`, inline: true },
                        { name: 'مكافحة السبام (Anti-Spam)', value: config.antiSpam === 1 ? `${emojis.success} شغال` : `${emojis.error} متوقف`, inline: true },
                        { name: 'مكافحة الهجمات (Anti-Raid)', value: config.antiRaid === 1 ? `${emojis.success} شغال` : `${emojis.error} متوقف`, inline: true },
                        { name: 'الكلمات المحظورة', value: `\`${words.length}\` كلمة`, inline: true },
                        { name: 'قناة السجلات', value: config.logChannelId ? `<#${config.logChannelId}>` : 'غير محددة', inline: true },
                        { name: 'رتبة المشرفين', value: config.modRoleId ? `<@&${config.modRoleId}>` : 'غير محددة', inline: true }
                    );
                break;
            }
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
