const { Events, EmbedBuilder } = require('discord.js');
const { sendMessageLog } = require('../../utils/helpers');
const db = require('../../database/connect');
const emojis = require('../../utils/emojis');

module.exports = {
    name: Events.MessageDelete,
    /**
     * @param {import('discord.js').Message} message
     */
    async execute(message) {
        if (!message.guild || message.author?.bot) return;

        const config = db.getConfig(message.guild.id);
        const targetChannelId = config?.message_logs_channel_id || config?.messageLogsChannelId || config?.log_channel_id || config?.logChannelId;
        if (!targetChannelId) return;

        const embed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle(`${emojis.trash} تم حذف رسالة`)
            .addFields({ name: `${emojis.channel} القناة`, value: `${message.channel}`, inline: true })
            .setTimestamp();

        const authorAvatar = typeof message.author?.displayAvatarURL === 'function' ? message.author.displayAvatarURL() : null;
        const authorOptions = { name: message.author?.tag || message.author?.username || 'User' };
        if (authorAvatar && typeof authorAvatar === 'string' && authorAvatar.trim().length > 0) {
            authorOptions.iconURL = authorAvatar;
        }
        embed.setAuthor(authorOptions);
        if (message.author) {
            embed.addFields({ name: `${emojis.user} صاحب الرسالة`, value: `${message.author} (\`${message.author?.id}\`)`, inline: true });
        }

        if (message.partial) {
            embed.addFields({ name: `${emojis.edit} المحتوى`, value: '*الرسالة غير مخزنة في الذاكرة المؤقتة (محتوى غير متوفر)*' });
        } else {
            embed.addFields(
                { name: `${emojis.edit} المحتوى المحذوف`, value: message.content ? `\`\`\`\n${message.content.substring(0, 1000)}\n\`\`\`` : '*لا يوجد نص (صورة أو إمبد)*' }
            );
        }

        await sendMessageLog(message.guild, embed);
    }
};
