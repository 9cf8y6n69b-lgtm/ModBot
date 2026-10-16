const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getActiveWarnings } = require('../../database/connect.js');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('View Warnings')
        .setType(ApplicationCommandType.User)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').UserContextMenuCommandInteraction} interaction
     */
    async execute(interaction) {
        const targetUser = interaction.targetUser;
        const warnings = getActiveWarnings(interaction.guild.id, targetUser.id);

        if (!warnings || warnings.length === 0) {
            return interaction.reply({
                content: `${emojis.success} العضو **${targetUser.tag}** ليس لديه أي تحذيرات نشطة.`,
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle(`${emojis.warn} تحذيرات ${targetUser.tag} (${warnings.length})`);

        warnings.slice(0, 5).forEach(w => {
            const dateTimestamp = Math.floor(new Date(w.created_at).getTime() / 1000);
            embed.addFields({
                name: `تحذير #${w.id}`,
                value: `**السبب:** ${w.reason}\n**المشرف:** <@${w.moderator_id}>\n**التاريخ:** <t:${dateTimestamp}:R>`,
                inline: false
            });
        });

        if (warnings.length > 5) {
            embed.addFields({ name: 'المزيد', value: `... و ${warnings.length - 5} تحذيرات أخرى (استخدم \`/warnings\` لعرض الكل)` });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
