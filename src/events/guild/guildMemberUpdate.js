const { Events, EmbedBuilder } = require('discord.js');
const db = require('../../database/connect');
const { sendModLog } = require('../../utils/helpers');
const emojis = require('../../utils/emojis');

module.exports = {
    name: Events.GuildMemberUpdate,
    /**
     * @param {import('discord.js').GuildMember} oldMember
     * @param {import('discord.js').GuildMember} newMember
     * @param {import('discord.js').Client} client
     */
    async execute(oldMember, newMember, client) {
        if (!newMember || !newMember.guild) return;

        // Detect new Server Boost
        const wasBoosting = Boolean(oldMember.premiumSince);
        const isBoosting = Boolean(newMember.premiumSince);

        if (!wasBoosting && isBoosting) {
            const guild = newMember.guild;
            const config = db.getConfig(guild.id);

            const boostEmbed = new EmbedBuilder()
                .setColor('#F47FFF')
                .setTitle(`${emojis.boost} تعزيز جديد للسيرفر! (Server Boost)`)
                .setDescription(`قام العضو الرائع ${newMember} (\`${newMember.user.tag}\`) بتعزيز سيرفر **${guild.name}**!\n\n` +
                    `${emojis.heart} نشكرك جزيل الشكر على دعمك وتطويرك للسيرفر.\n` +
                    `${emojis.diamond} **المستوى الحالي:** Level ${guild.premiumTier} (${guild.premiumSubscriptionCount} بوستات)`)
                .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: 'ModBot Boost Notification • شكراً لدعمك' })
                .setTimestamp();

            // 1. Send announcement to welcome channel if configured
            if (config.welcome_channel_id) {
                try {
                    const welcomeChannel = guild.channels.cache.get(config.welcome_channel_id)
                        || await guild.channels.fetch(config.welcome_channel_id).catch(() => null);
                    if (welcomeChannel && welcomeChannel.isTextBased()) {
                        await welcomeChannel.send({ embeds: [boostEmbed] }).catch(() => {});
                    }
                } catch (err) {
                    console.error('[GuildMemberUpdate] Error sending boost welcome:', err);
                }
            } else if (config.log_channel_id) {
                // Otherwise log to mod logs
                await sendModLog(guild, boostEmbed).catch(() => {});
            }
        }
    }
};
