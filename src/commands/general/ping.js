const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency'),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const sent = await interaction.deferReply({ fetchReply: true });
        const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;
        const websocketLatency = interaction.client.ws.ping;

        let color = '#57F287';
        if (roundtripLatency > 500 || websocketLatency > 500) color = '#ED4245';
        else if (roundtripLatency > 200 || websocketLatency > 200) color = '#FEE75C';

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`${emojis.ping} Pong`)
            .addFields(
                { name: 'WebSocket', value: `\`${websocketLatency}ms\``, inline: true },
                { name: 'Roundtrip', value: `\`${roundtripLatency}ms\``, inline: true }
            );

        await interaction.editReply({ embeds: [embed] });
    },
};
