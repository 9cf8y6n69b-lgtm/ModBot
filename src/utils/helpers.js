const ms = require('ms');
const { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/connect');
const config = require('../../config.json');
const emojis = require('./emojis');

const ACTION_LABELS = {
    ban: 'حظر نهائي (Ban)',
    softban: 'حظر خفيف وحذف رسائل (Softban)',
    unban: 'إلغاء الحظر (Unban)',
    kick: 'طرد (Kick)',
    mute: 'كتم مؤقت (Timeout)',
    unmute: 'إلغاء الكتم (Unmute)',
    warn: 'تحذير (Warn)',
    lockdown: 'إغلاق القناة (Lockdown)',
    unlock: 'فتح القناة (Unlock)',
    slowmode: 'الوضع البطيء (Slowmode)'
};

/**
 * Helper Utilities
 */
module.exports = {
    emojis,
    ACTION_LABELS,

    /**
     * Replaces template variables in welcome/farewell messages
     * @param {string} template
     * @param {import('discord.js').GuildMember} member
     * @returns {string}
     */
    formatTemplate(template, member) {
        if (!template || typeof template !== 'string') return '';
        const joinDate = member.joinedAt 
            ? member.joinedAt.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
            : new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
        const memberCount = member.guild?.memberCount || 0;
        const serverName = member.guild?.name || 'السيرفر';
        const username = member.user?.username || member.displayName || '';

        return template
            .replace(/{user}/g, `${member}`)
            .replace(/{username}/g, username)
            .replace(/{server}/g, serverName)
            .replace(/{memberCount}/g, String(memberCount))
            .replace(/{joinDate}/g, joinDate);
    },
    /**
     * Converts a duration string to milliseconds
     * @param {string} str - Duration string (e.g. '1h', '7d')
     * @returns {number|null} Milliseconds or null if invalid
     */
    parseDuration(str) {
        if (!str) return null;
        try {
            return ms(str);
        } catch (e) {
            return null;
        }
    },

    /**
     * Converts ms to human-readable string in Arabic
     * @param {number} duration - Milliseconds
     * @returns {string} Human readable duration
     */
    formatDuration(duration) {
        if (!duration) return 'دائم';
        const raw = ms(duration, { long: true });
        return raw
            .replace(/days?/g, 'يوم')
            .replace(/hours?/g, 'ساعة')
            .replace(/minutes?/g, 'دقيقة')
            .replace(/seconds?/g, 'ثانية');
    },

    /**
     * Truncates a string with ellipsis if it exceeds max length
     * @param {string} str - String to truncate
     * @param {number} max - Max length
     * @returns {string} Truncated string
     */
    truncate(str, max = 1024) {
        if (!str || str.length <= max) return str;
        return str.substring(0, max - 3) + '...';
    },

    /**
     * Gets the next case number for a guild
     * @param {string} guildId - The guild ID
     * @returns {number} Next case number
     */
    generateCaseId(guildId) {
        return db.getNextCaseNumber(guildId);
    },

    /**
     * Creates a standard mod embed.
     * Supports two calling conventions:
     *   1. createModEmbed(title, description, color)  — used by commands
     *   2. createModEmbed({ action, user, moderator, reason, caseNumber, duration, color }) — object form
     * @returns {EmbedBuilder}
     */
    createModEmbed(titleOrOpts, description, color) {
        // Positional form: createModEmbed('العنوان', 'الوصف', '#color')
        if (typeof titleOrOpts === 'string') {
            return new EmbedBuilder()
                .setTitle(titleOrOpts)
                .setDescription(description || null)
                .setColor(color || config.colors?.primary || '#5865F2')
                .setTimestamp();
        }

        // Object form
        const { action, user, moderator, reason, caseNumber, duration, color: objColor } = titleOrOpts;
        const actionText = ACTION_LABELS[action?.toLowerCase()] || action || 'إجراء إشرافي';
        const embed = new EmbedBuilder()
            .setTitle(`${emojis.shield} ${actionText} | قضية #${caseNumber || '?'}`)
            .setColor(objColor || config.colors?.primary || '#5865F2')
            .setTimestamp();

        if (user) {
            const avatar = typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ dynamic: true }) : null;
            if (avatar && typeof avatar === 'string' && avatar.trim().length > 0) {
                embed.setThumbnail(avatar);
            }
            embed.addFields({ name: `${emojis.user} العضو المستهدف`, value: `${user} (\`${user.id}\`)`, inline: true });
        }
        if (moderator) {
            embed.addFields({ name: `${emojis.mod} المشرف المسؤول`, value: `${moderator} (\`${moderator.id}\`)`, inline: true });
        }
        if (reason) embed.addFields({ name: `${emojis.notes} السبب`, value: this.truncate(reason) });
        if (duration) embed.addFields({ name: `${emojis.slowmode} المدة`, value: String(duration), inline: true });

        return embed;
    },

    /**
     * Sends a mod log to the guild's configured log channel.
     * Supports two calling conventions:
     *   1. sendModLog(guild, embed)  — direct embed
     *   2. sendModLog(guild, action, user, moderator, reason, caseNumber, duration?) — builds embed
     * @returns {Promise<Message|null>}
     */
    async sendModLog(guild, actionOrEmbed, user, moderator, reason, caseNumber, duration) {
        const guildConfig = db.getConfig(guild.id);
        if (!guildConfig || !guildConfig.log_channel_id) return null;

        let embed;
        if (actionOrEmbed instanceof EmbedBuilder) {
            // Direct embed form
            embed = actionOrEmbed;
        } else {
            // Positional form — build embed
            const actionText = ACTION_LABELS[actionOrEmbed?.toLowerCase()] || actionOrEmbed?.toUpperCase() || 'إشراف';
            embed = new EmbedBuilder()
                .setTitle(`${emojis.shield} ${actionText} | قضية #${caseNumber || '?'}`)
                .setColor(config.colors?.primary || '#5865F2')
                .setTimestamp();

            if (user) {
                const avatar = typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ dynamic: true }) : null;
                if (avatar && typeof avatar === 'string' && avatar.trim().length > 0) {
                    embed.setThumbnail(avatar);
                }
                embed.addFields({ name: `${emojis.user} العضو`, value: `${user.tag || user.username} (\`${user.id}\`)`, inline: true });
            }
            if (moderator) {
                embed.addFields({ name: `${emojis.mod} المشرف`, value: `${moderator.tag || moderator.username} (\`${moderator.id}\`)`, inline: true });
            }
            if (reason) embed.addFields({ name: `${emojis.notes} السبب`, value: this.truncate(reason) });
            if (duration) embed.addFields({ name: `${emojis.slowmode} المدة`, value: String(duration), inline: true });
        }

        let components = [];
        if (typeof actionOrEmbed === 'string' && ['mute', 'warn'].includes(actionOrEmbed.toLowerCase()) && user && caseNumber) {
            components = [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`undo_${actionOrEmbed.toLowerCase()}_${caseNumber}_${user.id}`)
                        .setLabel('تراجع (Undo)')
                        .setStyle(ButtonStyle.Secondary)
                )
            ];
        }

        try {
            const channel = guild.channels.cache.get(guildConfig.log_channel_id)
                || await guild.channels.fetch(guildConfig.log_channel_id).catch(() => null);
            if (!channel || !channel.isTextBased()) return null;
            return await channel.send({ embeds: [embed], components });
        } catch (error) {
            console.error(`Failed to send mod log in guild ${guild.id}:`, error);
            return null;
        }
    },

    /**
     * Sends a message log to the guild's configured message_logs_channel_id or fallback log_channel_id
     * @param {import('discord.js').Guild} guild
     * @param {import('discord.js').EmbedBuilder|Object} payload
     * @returns {Promise<import('discord.js').Message|null>}
     */
    async sendMessageLog(guild, payload) {
        if (!guild) return null;
        const guildConfig = db.getConfig(guild.id);
        const targetChannelId = guildConfig?.message_logs_channel_id || guildConfig?.messageLogsChannelId || guildConfig?.log_channel_id;
        if (!targetChannelId) return null;

        try {
            const channel = guild.channels.cache.get(targetChannelId)
                || (guild.channels.fetch ? await guild.channels.fetch(targetChannelId).catch(() => null) : null);
            if (!channel || !channel.isTextBased()) return null;

            if (payload instanceof EmbedBuilder) {
                return await channel.send({ embeds: [payload] });
            }
            return await channel.send(payload);
        } catch (error) {
            console.error(`Failed to send message log in guild ${guild.id}:`, error);
            return null;
        }
    },

    /**
     * Checks if member has a higher role than target
     * @param {import('discord.js').GuildMember} member - Moderator GuildMember
     * @param {import('discord.js').GuildMember} target - Target GuildMember
     * @returns {boolean} True if member has higher role
     */
    checkHierarchy(member, target) {
        if (!member || !target) return false;
        if (member.id === target.guild.ownerId) return true;
        if (target.id === target.guild.ownerId) return false;
        return member.roles.highest.position > target.roles.highest.position;
    },

    /**
     * Checks if member has mod permissions
     * @param {import('discord.js').GuildMember} member - GuildMember
     * @returns {boolean} True if they have perms
     */
    hasModPermission(member) {
        if (!member) return false;
        if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

        const guildConfig = db.getConfig(member.guild.id);
        if (guildConfig && guildConfig.mod_role_id) {
            return member.roles.cache.has(guildConfig.mod_role_id);
        }

        return member.permissions.has(PermissionFlagsBits.ManageMessages); // fallback
    }
};
