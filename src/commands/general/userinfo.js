const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const emojis = require('../../utils/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('View user info')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('Target user')
        )
        .setDMPermission(false),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        const createdTimestamp = Math.floor(targetUser.createdTimestamp / 1000);

        const embed = new EmbedBuilder()
            .setColor(member ? member.displayHexColor : '#5865F2')
            .setThumbnail(targetUser.displayAvatarURL({ size: 256, dynamic: true }))
            .setTitle(`${emojis.user} معلومات المستخدم — ${targetUser.username}`)
            .addFields(
                { name: `${emojis.user} اسم الحساب`, value: targetUser.tag, inline: true },
                { name: `${emojis.id} معرف الحساب (ID)`, value: `\`${targetUser.id}\``, inline: true },
                { name: `${emojis.calendar} تاريخ إنشاء الحساب`, value: `<t:${createdTimestamp}:D> (<t:${createdTimestamp}:R>)`, inline: true }
            );

        if (member) {
            const joinedTimestamp = Math.floor(member.joinedTimestamp / 1000);
            const roles = member.roles.cache
                .filter(r => r.id !== interaction.guild.id)
                .sort((a, b) => b.position - a.position)
                .map(r => `<@&${r.id}>`);
            
            const rolesDisplay = roles.length > 0 
                ? (roles.length > 10 ? roles.slice(0, 10).join(', ') + `... و ${roles.length - 10} رتب أخرى` : roles.join(', '))
                : 'لا توجد رتب';

            embed.addFields(
                { name: `${emojis.calendar} تاريخ الانضمام للسيرفر`, value: `<t:${joinedTimestamp}:D> (<t:${joinedTimestamp}:R>)`, inline: true },
                { name: `${emojis.star} أعلى رتبة`, value: member.roles.highest.id !== interaction.guild.id ? `<@&${member.roles.highest.id}>` : 'لا توجد', inline: true },
                { name: `${emojis.role} الرتب [${roles.length}]`, value: rolesDisplay, inline: false }
            );
        }

        await interaction.reply({ embeds: [embed] });
    },
};
