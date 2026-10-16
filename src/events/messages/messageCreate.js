const { Events, EmbedBuilder } = require('discord.js');
const ms = require('ms');
const db = require('../../database/connect');
const { sendModLog } = require('../../utils/helpers');
const emojis = require('../../utils/emojis');
const configData = require('../../../config.json');

// Anti-spam map: userId -> [messageTimestamps]
const spamMap = new Map();
const SPAM_WINDOW = configData.automod?.spamInterval ?? configData.automod?.spamWindow ?? 5000;
const SPAM_MAX = configData.automod?.spamThreshold ?? configData.automod?.spamMax ?? 5;

// Cleanup spam map every SPAM_WINDOW ms
setInterval(() => {
    const now = Date.now();
    for (const [userId, timestamps] of spamMap.entries()) {
        const valid = timestamps.filter(t => now - t < SPAM_WINDOW);
        if (valid.length === 0) {
            spamMap.delete(userId);
        } else {
            spamMap.set(userId, valid);
        }
    }
}, SPAM_WINDOW).unref();

module.exports = {
    name: Events.MessageCreate,
    /**
     * @param {import('discord.js').Message} message
     * @param {boolean} [isEdit=false]
     */
    async execute(message, isEdit = false) {
        if (!message || message.author?.bot || !message.guild) return;

        // Privacy-respecting message counter (only counts per user/guild/day for new messages, not edits)
        if (!isEdit) {
            db.recordMemberActivity(message.guild.id, message.author.id, message.author.tag || message.author.username);
        }

        const config = db.getConfig(message.guild.id);
        const automodActive = config?.automodEnabled === 1 || config?.automod_enabled === 1 ||
            ((config?.automodEnabled === undefined || config?.automodEnabled === null) &&
             (config?.automod_enabled === undefined || config?.automod_enabled === null) &&
             configData.automod?.enabled);
        if (!automodActive) return;

        // Bypass for Administrators, Moderators, and Whitelisted Role
        if (message.member) {
            if (message.member.permissions.has('Administrator')) return;
            if (config?.bypassRoleId && message.member.roles.cache.has(config.bypassRoleId)) return;
            if (config?.modRoleId && message.member.roles.cache.has(config.modRoleId)) return;
        }

        let violation = null;
        const content = message.content ? message.content.toLowerCase() : '';

        // 1. فحص الكلمات والروابط المحظورة (Word Filter)
        const filteredList = [];
        if (config?.filteredWords) {
            try {
                const parsed = JSON.parse(config.filteredWords);
                if (Array.isArray(parsed)) filteredList.push(...parsed);
            } catch {
                if (typeof config.filteredWords === 'string') {
                    filteredList.push(...config.filteredWords.split(','));
                }
            }
        }
        if (filteredList.length === 0 && Array.isArray(configData.automod?.defaultFilteredWords)) {
            filteredList.push(...configData.automod.defaultFilteredWords);
        }

        if (filteredList.some(word => word.trim() && content.includes(word.trim().toLowerCase()))) {
            violation = 'ألفاظ / محتوى محظور (Filtered Content)';
        }

        // 2. كشف السبام وتكرار الرسائل السريع (Anti-Spam - applied to new messages only)
        if (!violation && !isEdit) {
            if (!spamMap.has(message.author.id)) spamMap.set(message.author.id, []);
            const userStamps = spamMap.get(message.author.id);
            userStamps.push(Date.now());
            if (userStamps.length >= SPAM_MAX) {
                violation = 'إرسال رسائل متكررة ومزعجة (Spamming)';
                spamMap.set(message.author.id, []); // إعادة الضبط بعد المخالفة
            }
        }

        // 3. المنشن الجماعي المفرط (Mass Mention)
        if (!violation) {
            const maxMentions = configData.automod?.maxMentions ?? 5;
            if (message.mentions?.users?.size > maxMentions) {
                violation = 'منشن جماعي مفرط (Mass Mention)';
            }
        }

        // 4. الحروف الكبيرة المفرطة (Excessive Caps)
        if (!violation && message.content && message.content.length > 10) {
            const letters = message.content.replace(/[^a-zA-Z]/g, '');
            if (letters.length > 0) {
                const upper = letters.replace(/[^A-Z]/g, '').length;
                if ((upper / letters.length) > 0.7) {
                    violation = 'حروف كبيرة مفرطة (Excessive Caps)';
                }
            }
        }

        // 5. الرموز التعبيرية المفرطة (Excessive Emojis)
        if (!violation && message.content) {
            const maxEmojis = configData.automod?.maxEmojis ?? 15;
            const emojiRegex = /(<a?:[a-zA-Z0-9_]+:[0-9]+>|\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;
            const emojiCount = (message.content.match(emojiRegex) || []).length;
            if (emojiCount > maxEmojis) {
                violation = 'رموز تعبيرية مفرطة (Excessive Emojis)';
            }
        }

        // 6. نشر الروابط غير المصرح بها (Link Spam)
        if (!violation && message.content) {
            const linkRegex = /(https?:\/\/[^\s]+)/g;
            const links = (message.content.match(linkRegex) || []).length;
            const maxLinks = configData.automod?.maxLinks ?? 3;
            if (links > maxLinks) {
                violation = 'نشر روابط مشبوهة / مفرطة (Link Spam)';
            }
        }

        // إذا وجدت مخالفة: تطبيق النظام التلقائي الشامل
        if (violation) {
            try {
                // 1. حذف الرسالة المخالفة فوراً
                await message.delete().catch(() => {});

                // 2. تسجيل تحذير في قاعدة البيانات وإنشاء Case
                const warnReason = `Automod: ${violation}`;
                db.addWarning(message.guild.id, message.author.id, message.client.user.id, warnReason);
                const warnCase = db.addCase(message.guild.id, 'automod', message.author.id, message.client.user.id, warnReason);

                // 3. جلب عدد التحذيرات النشطة الحالي
                const activeWarnings = db.getActiveWarnings(message.guild.id, message.author.id);
                const warnCount = activeWarnings.length;

                // 4. قراءة حدود الكتم والطرد من الإعدادات
                const muteThreshold = configData.moderation?.warnThresholdMute || 3;
                const kickThreshold = configData.moderation?.warnThresholdKick || 5;
                const muteDurationStr = configData.moderation?.defaultMuteDuration || '1h';
                const muteDurationMs = ms(muteDurationStr) || (60 * 60 * 1000);

                let actionTaken = null;

                // 5. تطبيق العقوبات التلقائية حسب مستوى التكرار:
                if (warnCount >= kickThreshold && message.member && message.member.kickable) {
                    // أ. الطرد التلقائي (Auto-Kick) لتجاوز الحد الأقصى
                    actionTaken = 'طرد تلقائي (Kick)';

                    const dmKick = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(`${emojis.ban} تم طردك من السيرفر`)
                        .setDescription(`تم طردك لتجاوزك حد التحذيرات المسموح بها (\`${warnCount}/${kickThreshold}\`).\n**المخالفة:** ${violation}`)
                        .setTimestamp();
                    await message.author.send({ embeds: [dmKick] }).catch(() => {});

                    await message.member.kick(`Automod: Exceeded warning limit (${warnCount} warnings)`);

                    const kickCase = db.addCase(message.guild.id, 'kick', message.author.id, message.client.user.id, `تجاوز الحد الأقصى للتحذيرات (${warnCount}/${kickThreshold})`);
                    await sendModLog(message.guild, 'kick', message.author, message.client.user, `تجاوز الحد الأقصى للتحذيرات (${warnCount}/${kickThreshold})`, kickCase);

                } else if (warnCount >= muteThreshold && message.member && message.member.moderatable) {
                    // ب. الكتم التلقائي (Auto-Mute / Timeout) عند الوصول لحد الكتم
                    actionTaken = `كتم مؤقت (${muteDurationStr})`;

                    // تنفيذ الكتم الفعلي على العضو عبر Discord Timeout
                    await message.member.timeout(muteDurationMs, `Automod: ${violation}`).catch(() => {});

                    // منح رتبة الكتم المخصصة إن كانت محددة في إعدادات السيرفر
                    if (config?.mute_role_id) {
                        await message.member.roles.add(config.mute_role_id, `Automod: ${violation}`).catch(() => {});
                    }

                    const dmMute = new EmbedBuilder()
                        .setColor('#FEE75C')
                        .setTitle(`${emojis.mute} تم كتمك مؤقتاً`)
                        .setDescription(`تم كتمك لمدة **${muteDurationStr}** لتراكم التحذيرات (\`${warnCount}/${kickThreshold}\`).\n**المخالفة:** ${violation}\n${emojis.warn} **تنبيه:** عند وصول تحذيراتك إلى \`${kickThreshold}\` سيتم طردك تلقائياً.`)
                        .setTimestamp();
                    await message.author.send({ embeds: [dmMute] }).catch(() => {});

                    const muteExpiresAt = new Date(Date.now() + muteDurationMs).toISOString();
                    const muteCase = db.addCase(message.guild.id, 'mute', message.author.id, message.client.user.id, `تراكم ${warnCount} تحذيرات (كتم تلقائي)`, muteDurationStr, muteExpiresAt);
                    await sendModLog(message.guild, 'mute', message.author, message.client.user, `تراكم ${warnCount} تحذيرات (كتم تلقائي)`, muteCase, muteDurationStr);

                } else {
                    // ج. تحذير عادي مع تنبيه بالمتبقي حتى الكتم والطرد
                    const dmWarn = new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle(`${emojis.warn} تحذير`)
                        .setDescription(`تم حذف رسالتك في **#${message.channel.name}** بسبب: **${violation}**.\n${emojis.chart} تحذيراتك الحالية: \`${warnCount}\` (كتم عند \`${muteThreshold}\` / طرد عند \`${kickThreshold}\`)`)
                        .setTimestamp();
                    await message.author.send({ embeds: [dmWarn] }).catch(() => {});
                }

                // 6. إرسال سجل تفصيلي في قناة الـ Mod Log
                const authorAvatar = typeof message.author?.displayAvatarURL === 'function' ? message.author.displayAvatarURL() : null;
                const authorOptions = { name: message.author?.tag || message.author?.username || 'User' };
                if (authorAvatar && typeof authorAvatar === 'string' && authorAvatar.trim().length > 0) {
                    authorOptions.iconURL = authorAvatar;
                }
                const logEmbed = new EmbedBuilder()
                    .setColor(actionTaken ? '#ED4245' : '#FEE75C')
                    .setTitle(`${emojis.shield} رصد مخالفة تلقائية: ${violation}`)
                    .setAuthor(authorOptions)
                    .addFields(
                        { name: `${emojis.user} العضو المخالف`, value: `${message.author} (\`${message.author.id}\`)`, inline: true },
                        { name: `${emojis.channel} القناة`, value: `${message.channel}`, inline: true },
                        { name: `${emojis.warn} رصيد التحذيرات`, value: `\`${warnCount}\` تحذير(ات) (قضية #${warnCase})`, inline: true },
                        { name: `${emojis.zap} الإجراء المتخذ`, value: actionTaken ? `${emojis.dot_red} **${actionTaken}**` : `${emojis.dot_yellow} **حذف الرسالة وتسجيل تحذير**`, inline: false },
                        { name: `${emojis.edit} المحتوى المحذوف`, value: `\`\`\`\n${message.content.substring(0, 950) || '[لا يوجد نص]'}\n\`\`\``, inline: false }
                    )
                    .setTimestamp();

                await sendModLog(message.guild, logEmbed);

            } catch (error) {
                console.error('[AutoMod] Error processing violation:', error);
            }
        }
    }
};
