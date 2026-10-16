const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { setConfig } = require('../../database/connect.js');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure server settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('logchannel')
                .setDescription('Set mod logs channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel for logs')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('modrole')
                .setDescription('Set moderator role')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Moderator role')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('whitelist')
                .setDescription('Set automod bypass role')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role that bypasses automod')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('messagelogs')
                .setDescription('Set dedicated message edit & delete logs channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel for message logs')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('welcome')
                .setDescription('Configure welcome channel and message template')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel for welcome notifications')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Template: {user}, {username}, {server}, {memberCount}, {joinDate}')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('farewell')
                .setDescription('Configure farewell channel and message template')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel for farewell notifications')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Template: {user}, {username}, {server}, {memberCount}, {joinDate}')
                        .setRequired(false)
                )
        ),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        const embed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle(`${emojis.settings} تم تحديث الإعدادات بنجاح`)
            .setTimestamp();

        if (subcommand === 'logchannel') {
            const channel = interaction.options.getChannel('channel');
            setConfig(guildId, 'logChannelId', channel.id);
            
            embed.setDescription(`تم تعيين قناة سجلات الإشراف إلى: ${channel}`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (subcommand === 'modrole') {
            const role = interaction.options.getRole('role');
            setConfig(guildId, 'modRoleId', role.id);
            
            embed.setDescription(`تم تعيين رتبة المشرفين المعتمدة إلى: ${role}`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (subcommand === 'whitelist') {
            const role = interaction.options.getRole('role');
            setConfig(guildId, 'bypassRoleId', role.id);

            embed.setDescription(`تم تعيين رتبة الاستثناء وتجاوز الأوتومود إلى: ${role}`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (subcommand === 'messagelogs') {
            const channel = interaction.options.getChannel('channel');
            setConfig(guildId, 'messageLogsChannelId', channel.id);

            embed.setDescription(`تم تعيين قناة سجلات الرسائل والتعديلات إلى: ${channel}`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (subcommand === 'welcome') {
            const channel = interaction.options.getChannel('channel');
            const message = interaction.options.getString('message');
            setConfig(guildId, 'welcomeChannelId', channel.id);
            if (message) {
                setConfig(guildId, 'welcomeMessage', message);
            }

            embed.setDescription(`تم تعيين قناة الترحيب إلى: ${channel}${message ? `\n**قالب الترحيب:**\n\`\`\`\n${message}\n\`\`\`` : ''}`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (subcommand === 'farewell') {
            const channel = interaction.options.getChannel('channel');
            const message = interaction.options.getString('message');
            setConfig(guildId, 'farewellChannelId', channel.id);
            if (message) {
                setConfig(guildId, 'farewellMessage', message);
            }

            embed.setDescription(`تم تعيين قناة الوداع إلى: ${channel}${message ? `\n**قالب الوداع:**\n\`\`\`\n${message}\n\`\`\`` : ''}`);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    },
};
