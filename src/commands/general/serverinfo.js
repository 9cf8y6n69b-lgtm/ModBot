const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const emojis = require('../../utils/emojis');

const VERIFICATION_LEVELS = {
    0: 'بدون (None)',
    1: 'منخفض (Low)',
    2: 'متوسط (Medium)',
    3: 'مرتفع (High)',
    4: 'الأعلى (Very High)'
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('View server info')
        .setDMPermission(false),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const { guild } = interaction;
        
        await guild.fetch();
        const owner = await guild.fetchOwner();
        
        const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
        const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
        const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(guild.name)
            .setThumbnail(guild.iconURL({ size: 256, dynamic: true }) || null)
            .addFields(
                { name: `${emojis.user} المالك`, value: `<@${owner.id}>`, inline: true },
                { name: `${emojis.user} الأعضاء`, value: `\`${guild.memberCount}\``, inline: true },
                { name: `${emojis.calendar} الإنشاء`, value: `<t:${createdTimestamp}:d>`, inline: true },
                { name: `${emojis.channel} القنوات`, value: `${emojis.channel} ${textChannels} | ${emojis.voice} ${voiceChannels}`, inline: true },
                { name: `${emojis.role} الرتب`, value: `\`${guild.roles.cache.size}\``, inline: true },
                { name: `${emojis.boost} البوستات`, value: `Lvl ${guild.premiumTier} (${guild.premiumSubscriptionCount})`, inline: true }
            );

        await interaction.reply({ embeds: [embed] });
    },
};
