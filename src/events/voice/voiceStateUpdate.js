const { Events, EmbedBuilder } = require('discord.js');
const db = require('../../database/connect');
const { sendModLog } = require('../../utils/helpers');
const emojis = require('../../utils/emojis');

// User Voice Hop Sliding Window: userId -> [timestamp]
const voiceHops = new Map();
const HOP_WINDOW_MS = 15000; // 15 ثانية
const HOP_THRESHOLD = 4; // أكثر من 4 تنقلات في 15 ثانية

// Periodic memory cleanup
setInterval(() => {
    const now = Date.now();
    for (const [userId, hops] of voiceHops.entries()) {
        const valid = hops.filter(t => now - t < HOP_WINDOW_MS);
        if (valid.length === 0) {
            voiceHops.delete(userId);
        } else {
            voiceHops.set(userId, valid);
        }
    }
}, HOP_WINDOW_MS).unref();

module.exports = {
    name: Events.VoiceStateUpdate,
    /**
     * @param {import('discord.js').VoiceState} oldState
     * @param {import('discord.js').VoiceState} newState
     * @param {import('discord.js').Client} client
     */
    async execute(oldState, newState, client) {
        const member = newState.member || oldState.member;
        if (!member || member.user.bot) return;

        const guild = newState.guild || oldState.guild;
        if (!guild) return;

        const guildConfig = db.getConfig(guild.id);

        let action = null;
        let channelId = null;

        if (!oldState.channelId && newState.channelId) {
            action = 'join';
            channelId = newState.channelId;
        } else if (oldState.channelId && !newState.channelId) {
            action = 'leave';
            channelId = oldState.channelId;
        } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            action = 'move';
            channelId = newState.channelId;
        }

        if (!action) return;

        // Record in SQLite
        db.addVoiceLog(guild.id, member.id, action, channelId);

        // 1. Voice Hop Protection (كشف التنقل المزعج السريع)
        const hopProtectionEnabled = guildConfig.voice_hop_protection !== undefined ? guildConfig.voice_hop_protection === 1 : true;
        if (hopProtectionEnabled && (action === 'move' || action === 'join')) {
            const now = Date.now();
            if (!voiceHops.has(member.id)) {
                voiceHops.set(member.id, []);
            }
            const hops = voiceHops.get(member.id);
            hops.push(now);

            const recentHops = hops.filter(t => now - t < HOP_WINDOW_MS);
            voiceHops.set(member.id, recentHops);

            if (recentHops.length >= HOP_THRESHOLD) {
                voiceHops.delete(member.id); // Reset to prevent double punishment

                try {
                    // Disconnect and apply timeout
                    await member.voice.disconnect('Voice Hop Spam').catch(() => {});
                    if (member.moderatable) {
                        await member.timeout(5 * 60 * 1000, 'Voice Hop Spam Protection').catch(() => {});
                    }

                    const caseNumber = db.addCase(
                        guild.id,
                        'mute',
                        member.id,
                        client.user.id,
                        `كشف إزعاج الرومات الصوتية (Voice Hop Spam): تنقل ${recentHops.length} مرات في 15 ثانية`,
                        '5m'
                    );

                    const alertEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle(`${emojis.alert} كشف إزعاج الرومات الصوتية (Voice Hop Protection)`)
                        .setDescription(`قام العضو ${member} (\`${member.user.tag}\`) بالتنقل المزعج السريع بين الرومات الصوتية أكثر من **${recentHops.length}** مرات خلال أقل من 15 ثانية!\n\n` +
                            `${emojis.shield} **الإجراء المتخذ:** تم فصل العضو وتطبيق الكتم المؤقت لمدة 5 دقائق تلقائياً لحماية أعضاء الرومات الصوتية.`)
                        .addFields(
                            { name: 'رقم القضية', value: `#${caseNumber}`, inline: true },
                            { name: 'القناة الأخيرة', value: `<#${channelId}>`, inline: true }
                        )
                        .setTimestamp();

                    await sendModLog(guild, alertEmbed);
                } catch (err) {
                    console.error('[Voice Hop Protection] Error applying moderation:', err);
                }
            }
        }

        // 2. Voice Activity Logs (إرسال سجلات النشاط الصوتي إن كانت محددة)
        if (guildConfig.voice_logs_channel_id) {
            const logChannel = guild.channels.cache.get(guildConfig.voice_logs_channel_id)
                || await guild.channels.fetch(guildConfig.voice_logs_channel_id).catch(() => null);
            if (logChannel && logChannel.isTextBased()) {
                const logEmbed = new EmbedBuilder().setTimestamp();

                if (action === 'join') {
                    logEmbed
                        .setColor('#57F287')
                        .setTitle(`${emojis.voice} انضمام إلى روم صوتي`)
                        .setDescription(`انضم العضو ${member} (\`${member.user.tag}\`) إلى القناة الصوتية <#${channelId}>.`);
                } else if (action === 'leave') {
                    logEmbed
                        .setColor('#ED4245')
                        .setTitle(`${emojis.mute} مغادرة الروم الصوتي`)
                        .setDescription(`غادر العضو ${member} (\`${member.user.tag}\`) القناة الصوتية <#${channelId}>.`);
                } else if (action === 'move') {
                    logEmbed
                        .setColor('#5865F2')
                        .setTitle(`${emojis.switch} انتقال بين الرومات الصوتية`)
                        .setDescription(`انتقل العضو ${member} (\`${member.user.tag}\`)\n**من:** <#${oldState.channelId}>\n**إلى:** <#${newState.channelId}>`);
                }

                await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }
    }
};
