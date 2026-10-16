const { Events, EmbedBuilder } = require('discord.js');
const { sendMessageLog } = require('../../utils/helpers');
const db = require('../../database/connect');
const emojis = require('../../utils/emojis');
const messageCreate = require('./messageCreate');

module.exports = {
    name: Events.MessageUpdate,
    /**
     * @param {import('discord.js').Message} oldMessage
     * @param {import('discord.js').Message} newMessage
     */
    async execute(oldMessage, newMessage) {
        if (!newMessage.guild || newMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return; // Embed updates etc

        // إعادة تشغيل فحص الأوتومود على الرسالة بعد تعديلها بأمان دون احتسابها كرسالة جديدة في النشاط أو السبام
        try {
            await messageCreate.execute(newMessage, true);
        } catch (automodErr) {
            console.error('[MessageUpdate] Automod check error:', automodErr);
        }

        const config = db.getConfig(newMessage.guild.id);
        const targetChannelId = config?.message_logs_channel_id || config?.messageLogsChannelId || config?.log_channel_id || config?.logChannelId;
        if (!targetChannelId) return;

        const authorAvatar = typeof newMessage.author?.displayAvatarURL === 'function' ? newMessage.author.displayAvatarURL() : null;
        const authorOptions = { name: newMessage.author?.tag || newMessage.author?.username || 'User' };
        if (authorAvatar && typeof authorAvatar === 'string' && authorAvatar.trim().length > 0) {
            authorOptions.iconURL = authorAvatar;
        }

        const embed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle(`${emojis.edit} تم تعديل رسالة`)
            .setAuthor(authorOptions)
            .setDescription(`**القناة:** ${newMessage.channel} — [الانتقال إلى الرسالة](${newMessage.url})`)
            .setTimestamp();

        if (oldMessage.partial) {
            embed.addFields({ name: `${emojis.arrow_left} قبل التعديل`, value: '*الرسالة الأصلية غير مخزنة في الذاكرة المؤقتة*' });
        } else {
            embed.addFields({ name: `${emojis.arrow_left} قبل التعديل`, value: oldMessage.content ? `\`\`\`\n${oldMessage.content.substring(0, 1000)}\n\`\`\`` : '*لا يوجد نص*' });
        }
        
        embed.addFields({ name: `${emojis.arrow_right} بعد التعديل`, value: newMessage.content ? `\`\`\`\n${newMessage.content.substring(0, 1000)}\n\`\`\`` : '*لا يوجد نص*' });

        await sendMessageLog(newMessage.guild, embed);
    }
};
