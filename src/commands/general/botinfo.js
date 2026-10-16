const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');
const os = require('os');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('View bot statistics'),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const { client } = interaction;
        
        const uptime = process.uptime();
        const days = Math.floor(uptime / 86400);
        const hours = Math.floor(uptime / 3600) % 24;
        const minutes = Math.floor(uptime / 60) % 60;
        const uptimeString = `${days}d ${hours}h ${minutes}m`;
        
        const memoryUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`${emojis.bot} ${client.user.username}`)
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: 'السيرفرات', value: `\`${client.guilds.cache.size}\``, inline: true },
                { name: 'المستخدمين', value: `\`${client.users.cache.size}\``, inline: true },
                { name: 'التشغيل', value: `\`${uptimeString}\``, inline: true },
                { name: 'الذاكرة', value: `\`${memoryUsed} MB\``, inline: true },
                { name: 'Discord.js', value: `\`v${version}\``, inline: true },
                { name: 'Node.js', value: `\`${process.version}\``, inline: true }
            );

        await interaction.reply({ embeds: [embed] });
    },
};
