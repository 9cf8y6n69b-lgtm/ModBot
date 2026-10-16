const { Events, EmbedBuilder } = require('discord.js');
const { sendModLog } = require('../../utils/helpers');
const db = require('../../database/connect');
const emojis = require('../../utils/emojis');

// guildId -> [timestamps]
const recentJoins = new Map();
const JOIN_WINDOW_MS = 10000; // 10 ثوانٍ
const JOIN_THRESHOLD = 5; // 5 أعضاء خلال 10 ثوانٍ

// Cleanup interval
setInterval(() => {
    const now = Date.now();
    for (const [guildId, joins] of recentJoins.entries()) {
        const filtered = joins.filter(time => now - time < JOIN_WINDOW_MS);
        if (filtered.length === 0) {
            recentJoins.delete(guildId);
        } else {
            recentJoins.set(guildId, filtered);
        }
    }
}, JOIN_WINDOW_MS).unref();

module.exports = {
    name: Events.GuildMemberAdd,
    /**
     * @param {import('discord.js').GuildMember} member
     */
    async execute(member) {
        const guildId = member.guild.id;
        const config = db.getConfig(guildId);
        
        // 1. فحص هجوم الدخول السريع (Anti-Raid)
        if (!recentJoins.has(guildId)) {
            recentJoins.set(guildId, []);
        }
        
        const joins = recentJoins.get(guildId);
        joins.push(Date.now());
        
        if (joins.length >= JOIN_THRESHOLD) {
            const embed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle(`${emojis.alert} اشتباه في هجوم دخول مكثف (Anti-Raid Alert)`)
                .setDescription(`تم رصد انضمام عدد كبير من الحسابات خلال فترة وجيزة جداً!\n**المعدل:** \`${joins.length}\` أعضاء خلال \`${JOIN_WINDOW_MS / 1000}\` ثوانٍ.\n${emojis.warn} يرجى من المشرفين الانتباه وتفعيل قفل القنوات (/lockdown) إن لزم الأمر.`)
                .setTimestamp();
                
            await sendModLog(member.guild, embed);
            recentJoins.set(guildId, []);
        }

        // 2. فحص وعزل النصابين والسكامرز والحسابات المشبوهة (Alt-Account Quarantine)
        let isQuarantined = false;
        if (!member.user.bot && config.alt_quarantine_enabled) {
            const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
            const minAgeDays = Number(config.alt_min_age_days) || 3;
            if (accountAgeDays < minAgeDays) {
                isQuarantined = true;
                const reason = `عمر الحساب (${accountAgeDays.toFixed(1)} يوم) أقل من الحد الأدنى المطلوب (${minAgeDays} أيام)`;
                db.addQuarantineUser(guildId, member.id, reason);

                if (config.quarantine_role_id) {
                    await member.roles.add(config.quarantine_role_id).catch(() => {});
                }

                const quarantineEmbed = new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setTitle(`${emojis.warn} حجر حساب جديد مشبوه (Alt Quarantine Alert)`)
                    .setDescription(`تم رصد دخول حساب حديث الإنشاء:\n` +
                        `${emojis.user} **العضو:** ${member} (\`${member.user.tag}\` - \`${member.id}\`)\n` +
                        `${emojis.calendar} **عمر الحساب:** \`${accountAgeDays.toFixed(1)}\` يوم (تاريخ الإنشاء: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>)\n` +
                        `${emojis.shield} **الإجراء:** ${config.quarantine_role_id ? 'تم منح رتبة الحجر تلقائياً' : 'تم تنبيه المشرفين'}`)
                const quarantineAvatar = typeof member.user?.displayAvatarURL === 'function' ? member.user.displayAvatarURL() : null;
                if (quarantineAvatar && typeof quarantineAvatar === 'string' && quarantineAvatar.trim().length > 0) {
                    quarantineEmbed.setThumbnail(quarantineAvatar);
                }
                quarantineEmbed.setTimestamp();

                await sendModLog(member.guild, quarantineEmbed);
            }
        }

        // 3. الرتب التلقائية للأعضاء والبوتات (Autoroles)
        if (!isQuarantined) {
            if (member.user.bot && config.autorole_bot_id) {
                await member.roles.add(config.autorole_bot_id).catch(() => {});
            } else if (!member.user.bot && config.autorole_human_id) {
                await member.roles.add(config.autorole_human_id).catch(() => {});
            }

            // 4. إرسال رسالة ترحيب في القناة المحددة (Welcome Message)
            if (config.welcome_channel_id) {
                try {
                    const welcomeChannel = member.guild.channels.cache.get(config.welcome_channel_id)
                        || await member.guild.channels.fetch(config.welcome_channel_id).catch(() => null);
                    if (welcomeChannel && welcomeChannel.isTextBased()) {
                        const { formatTemplate } = require('../../utils/helpers');
                        const defaultDesc = `أهلاً بك يا ${member} في السيرفر! يسعدنا انضمامك إلينا.\nنرجو منك قراءة القوانين والالتزام بها.`;
                        const description = config.welcome_message 
                            ? formatTemplate(config.welcome_message, member) 
                            : defaultDesc;

                        const welcomeEmbed = new EmbedBuilder()
                            .setColor('#5865F2')
                            .setTitle(`${emojis.wave} مرحباً بك في ${member.guild.name}!`)
                            .setDescription(description);

                        const welcomeAvatar = typeof member.user?.displayAvatarURL === 'function' ? member.user.displayAvatarURL({ dynamic: true }) : null;
                        if (welcomeAvatar && typeof welcomeAvatar === 'string' && welcomeAvatar.trim().length > 0) {
                            welcomeEmbed.setThumbnail(welcomeAvatar);
                        }

                        welcomeEmbed.addFields(
                            { name: `${emojis.user} العضو`, value: `${member.user?.tag || member.user?.username || 'User'} (\`${member.id}\`)`, inline: true },
                            { name: `${emojis.chart} ترتيب العضو`, value: `#${member.guild.memberCount}`, inline: true }
                        )
                        .setTimestamp();
                        await welcomeChannel.send({ embeds: [welcomeEmbed] }).catch(() => {});
                    }
                } catch (welcomeErr) {
                    console.error('[Welcome Message] Error sending welcome embed:', welcomeErr);
                }
            }
        }
    }
};
