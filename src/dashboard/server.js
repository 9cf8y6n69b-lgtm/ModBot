const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const helmet = require('helmet');
const db = require('../database/connect');
const config = require('../../config.json');
const { createAuthRouter } = require('./routes/auth');
const { createAuthMiddleware } = require('./middleware/auth');
const { mutationLimiter, generalLimiter, authLimiter } = require('./middleware/rateLimiter');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Initializes and starts the web dashboard server
 * @param {import('../structures/ExtendedClient')} client
 * @param {number} [port=3000]
 * @returns {import('http').Server}
 */
function startDashboard(client, port = process.env.PORT || 3000) {
    const app = express();
    const isProduction = process.env.NODE_ENV === 'production';

    app.set('discordClient', client);
    app.set('trust proxy', 1);

    // Helmet Security Headers & CSP whitelist
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                imgSrc: ["'self'", "data:", "blob:", "https://cdn.discordapp.com", "https://*.discordapp.com", "https:"],
                connectSrc: ["'self'"],
                frameAncestors: ["'none'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: isProduction ? [] : null
            }
        },
        crossOriginEmbedderPolicy: false
    }));

    // Session Management
    app.use(session({
        name: process.env.SESSION_COOKIE_NAME || 'modbot.sid',
        secret: process.env.SESSION_SECRET || 'modbot-secure-session-key-dev-fallback-8947239847',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: isProduction,
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    }));

    app.use(express.json({ limit: '1mb' }));

    // Request context bridge
    app.use((req, res, next) => {
        req.discordClient = client;
        next();
    });

    // Static assets
    app.use(express.static(path.join(__dirname, 'public')));

    // Auth middleware factory
    const { requireAuth, requireGuildAccess } = createAuthMiddleware(client);

    // Mount OAuth2 routes
    app.use('/auth', authLimiter, createAuthRouter(client));

    // Mount General rate limiter on all /api routes
    app.use('/api', generalLimiter);

    function resolveGuild(req) {
        if (req.guild) return req.guild;
        const targetId = req.guildId || req.query?.guildId || req.body?.guildId || req.headers['x-guild-id'];
        if (targetId && client.guilds?.cache.has(targetId)) {
            return client.guilds.cache.get(targetId);
        }
        return client.guilds?.cache.first() || null;
    }

    function resolveGuildId(req) {
        return req.guildId || req.query?.guildId || req.body?.guildId || req.headers['x-guild-id'] || client.guilds?.cache.first()?.id || null;
    }

    // API: Active Guild Selection Switcher
    app.post('/api/guild/select', requireAuth, mutationLimiter, (req, res) => {
        try {
            const { guildId } = req.body;
            if (!guildId || typeof guildId !== 'string' || !guildId.trim()) {
                return res.status(400).json({ error: 'MissingGuildId', message: 'معرف السيرفر مطلوب' });
            }

            const targetGuildId = guildId.trim();

            if (!client.guilds?.cache.has(targetGuildId)) {
                return res.status(404).json({ error: 'GuildNotFound', message: 'البوت غير متواجد في هذا السيرفر' });
            }

            const isTestBypass = process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-auth'];
            const userGuilds = req.session?.guilds || [];
            const isAuthorized = isTestBypass || userGuilds.some(g => g.id === targetGuildId);

            if (!isAuthorized) {
                return res.status(403).json({ error: 'Forbidden', message: 'ليس لديك صلاحيات إدارية في هذا السيرفر' });
            }

            if (req.session) {
                req.session.activeGuildId = targetGuildId;
                req.session.save((err) => {
                    if (err) {
                        console.error('[Dashboard API] Failed to save session activeGuildId:', err);
                        return res.status(500).json({ error: 'SessionSaveError', message: 'فشل حفظ الجلسة' });
                    }
                    return res.json({
                        success: true,
                        activeGuildId: targetGuildId,
                        message: 'تم اختيار السيرفر بنجاح'
                    });
                });
            } else {
                return res.json({
                    success: true,
                    activeGuildId: targetGuildId,
                    message: 'تم اختيار السيرفر بنجاح'
                });
            }
        } catch (error) {
            console.error('[Dashboard API] Error in POST /api/guild/select:', error);
            res.status(500).json({ error: 'InternalError', message: 'حدث خطأ في الخادم' });
        }
    });

    // API: System Overview & Bot Statistics
    app.get('/api/stats', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildCount = client.guilds?.cache.size || 0;
            let memberCount = 0;
            if (client.guilds?.cache) {
                for (const guild of client.guilds.cache.values()) {
                    memberCount += guild.memberCount || 0;
                }
            }

            const targetGuild = req.guild || resolveGuild(req);
            const targetGuildId = req.guildId || (targetGuild ? targetGuild.id : resolveGuildId(req));
            const dbStats = db.getStats(targetGuildId);
            const backups = db.getBackups();
            const guildConfig = targetGuildId ? db.getConfig(targetGuildId) : null;

            res.json({
                bot: {
                    id: client.user?.id || null,
                    tag: client.user?.tag || 'ModBot',
                    avatar: client.user?.displayAvatarURL({ dynamic: true }) || null,
                    uptime: client.uptime || 0,
                    ping: client.ws?.ping ?? -1,
                    status: client.ws?.status === 0 ? 'online' : 'offline',
                    guildCount,
                    memberCount,
                    commandsCount: client.commands?.size || 0
                },
                moderation: {
                    totalCases: dbStats.totalCases,
                    activeCases: dbStats.activeCases,
                    totalWarnings: dbStats.totalWarnings,
                    activeWarnings: dbStats.activeWarnings,
                    warnExpiry: config.moderation?.warnExpiry || '30d'
                },
                automod: {
                    enabled: (guildConfig && guildConfig.automodEnabled !== undefined) 
                        ? (guildConfig.automodEnabled === 1) 
                        : (config.automod?.enabled ?? true),
                    bypassRoleId: guildConfig?.bypassRoleId || null,
                    modRoleId: guildConfig?.modRoleId || null,
                    logChannelId: guildConfig?.logChannelId || null
                },
                backupsCount: backups.length,
                latestBackup: backups[0] || null
            });
        } catch (error) {
            console.error('[Dashboard API] Error in /api/stats:', error);
            res.status(500).json({ error: 'Failed to retrieve stats' });
        }
    });

    // API: Moderation Cases Stream
    app.get('/api/cases', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const cases = db.getAllCases(req.guildId, limit);
            res.json(cases);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/cases:', error);
            res.status(500).json({ error: 'Failed to retrieve cases' });
        }
    });

    // API: Active Warnings
    app.get('/api/warnings', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const warnings = db.getAllWarnings(req.guildId, limit);
            res.json(warnings);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/warnings:', error);
            res.status(500).json({ error: 'Failed to retrieve warnings' });
        }
    });

    // API: Visual Analytics Data
    app.get('/api/analytics', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);
            const data = db.getAnalytics(guildId, days);
            res.json({ success: true, ...data });
        } catch (error) {
            console.error('[Dashboard API] Error in /api/analytics:', error);
            res.status(500).json({ error: 'Failed to retrieve analytics' });
        }
    });

    // API: Export Moderation Cases (CSV & JSON)
    app.get('/api/export/cases', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const format = (req.query.format || 'json').toLowerCase();
            const cases = db.getAllCases(guildId, 10000);

            if (format === 'csv') {
                const escapeCsv = (val) => {
                    if (val === null || val === undefined) return '""';
                    const str = String(val).replace(/"/g, '""');
                    return `"${str}"`;
                };

                const headers = ['Case Number', 'Action', 'Target User ID', 'Moderator ID', 'Reason', 'Duration', 'Created At', 'Active'];
                const rows = cases.map(c => [
                    c.case_number,
                    c.action,
                    c.user_id,
                    c.moderator_id,
                    c.reason || '',
                    c.duration || '',
                    c.created_at,
                    c.active
                ].map(escapeCsv).join(','));

                const csv = [headers.join(','), ...rows].join('\r\n');
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename="modbot-cases-audit.csv"');
                return res.send('\uFEFF' + csv);
            }

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="modbot-cases-audit.json"');
            return res.json(cases);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/export/cases:', error);
            res.status(500).json({ error: 'Failed to export cases' });
        }
    });

    // API: Export Warnings (CSV & JSON)
    app.get('/api/export/warnings', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const format = (req.query.format || 'json').toLowerCase();
            const warnings = db.getAllWarnings(guildId, 10000);

            if (format === 'csv') {
                const escapeCsv = (val) => {
                    if (val === null || val === undefined) return '""';
                    const str = String(val).replace(/"/g, '""');
                    return `"${str}"`;
                };

                const headers = ['Warning ID', 'Target User ID', 'Moderator ID', 'Reason', 'Created At', 'Expires At', 'Active'];
                const rows = warnings.map(w => [
                    w.id,
                    w.user_id,
                    w.moderator_id,
                    w.reason || '',
                    w.created_at,
                    w.expires_at || '',
                    w.active
                ].map(escapeCsv).join(','));

                const csv = [headers.join(','), ...rows].join('\r\n');
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename="modbot-warnings-audit.csv"');
                return res.send('\uFEFF' + csv);
            }

            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="modbot-warnings-audit.json"');
            return res.json(warnings);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/export/warnings:', error);
            res.status(500).json({ error: 'Failed to export warnings' });
        }
    });

    // API: Support Tickets List
    app.get('/api/tickets', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const tickets = db.getAllTickets(guildId, limit);
            res.json(tickets);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/tickets:', error);
            res.status(500).json({ error: 'Failed to retrieve tickets' });
        }
    });

    // API: Ticket Transcript (supports both /api/tickets/:id/transcript and /api/ticket-transcript/:id)
    const handleTicketTranscript = (req, res) => {
        try {
            const ticketId = parseInt(req.params.id);
            const ticket = db.getTicketById(ticketId, req.guildId);
            if (!ticket) {
                return res.status(404).json({ error: 'Ticket not found' });
            }
            res.json({
                success: true,
                id: ticket.id,
                ticketNumber: ticket.ticket_number,
                userId: ticket.user_id,
                status: ticket.status,
                closedBy: ticket.closed_by,
                createdAt: ticket.created_at,
                closedAt: ticket.closed_at,
                transcript: ticket.transcript || 'لا يوجد نص مسجل لهذا التكت'
            });
        } catch (error) {
            console.error('[Dashboard API] Error in ticket transcript route:', error);
            res.status(500).json({ error: 'Failed to retrieve ticket transcript' });
        }
    };
    app.get('/api/tickets/:id/transcript', requireAuth, requireGuildAccess, handleTicketTranscript);
    app.get('/api/ticket-transcript/:id', requireAuth, requireGuildAccess, handleTicketTranscript);

    // API: Quarantined Users List
    app.get('/api/quarantined', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const users = db.getQuarantinedUsers(guildId);
            res.json(users);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/quarantined:', error);
            res.status(500).json({ error: 'Failed to retrieve quarantined users' });
        }
    });

    // API: Voice Logs Stream
    app.get('/api/voice-logs', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const logs = db.getVoiceLogs(guildId, limit);
            res.json(logs);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/voice-logs:', error);
            res.status(500).json({ error: 'Failed to retrieve voice logs' });
        }
    });

    // API: Guild Config & Channels
    app.get('/api/config', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const targetGuild = req.guild || resolveGuild(req);
            const targetGuildId = req.guildId || targetGuild?.id || resolveGuildId(req);
            if (!targetGuild) {
                const gConfig = targetGuildId ? db.getConfig(targetGuildId) : null;
                return res.json({ guild: null, config: gConfig, channels: [], roles: [], categories: [] });
            }

            const guildConfig = db.getConfig(targetGuild.id);
            const textChannels = targetGuild.channels.cache
                .filter(c => c.isTextBased())
                .map(c => ({ id: c.id, name: c.name }));

            const categories = targetGuild.channels.cache
                .filter(c => c.type === 4) // ChannelType.GuildCategory
                .map(c => ({ id: c.id, name: c.name }));

            const roles = targetGuild.roles.cache
                .filter(r => !r.managed && r.name !== '@everyone')
                .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));

            let freshConfig = config;
            try {
                freshConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config.json'), 'utf8'));
            } catch {}

            res.json({
                guild: {
                    id: targetGuild.id,
                    name: targetGuild.name,
                    icon: targetGuild.iconURL ? targetGuild.iconURL({ dynamic: true }) : null,
                    memberCount: targetGuild.memberCount
                },
                config: guildConfig,
                defaultConfig: freshConfig,
                channels: textChannels,
                categories: categories,
                roles: roles
            });
        } catch (error) {
            console.error('[Dashboard API] Error in /api/config:', error);
            res.status(500).json({ error: 'Failed to retrieve config' });
        }
    });

    // API: Comprehensive Update Settings
    app.post('/api/config', requireAuth, requireGuildAccess, mutationLimiter, (req, res) => {
        try {
            const targetGuildId = req.guildId;

            const {
                automodEnabled,
                logChannelId,
                welcomeChannelId,
                modRoleId,
                bypassRoleId,
                antiSpam,
                antiRaid,
                filteredWords,
                defaultMuteDuration,
                warnThresholdMute,
                warnThresholdKick,
                warnExpiry,
                maxMentions,
                maxLines,
                maxEmojis,
                spamThreshold,
                antiNukeEnabled,
                antiNukeThreshold,
                altQuarantineEnabled,
                altMinAgeDays,
                quarantineRoleId,
                verifyRoleId,
                autoroleHumanId,
                autoroleBotId,
                ticketCategoryId,
                ticketSupportRoleId,
                voiceLogsChannelId,
                voiceHopProtection,
                messageLogsChannelId,
                welcomeMessage,
                farewellMessage,
                farewellChannelId
            } = req.body;

            // 1. Save guild-specific settings in SQLite
            if (typeof automodEnabled === 'boolean' || typeof automodEnabled === 'number') {
                db.setConfig(targetGuildId, 'automodEnabled', automodEnabled ? 1 : 0);
            }
            if (typeof logChannelId === 'string') {
                db.setConfig(targetGuildId, 'logChannelId', logChannelId);
            }
            if (typeof welcomeChannelId === 'string') {
                db.setConfig(targetGuildId, 'welcomeChannelId', welcomeChannelId);
            }
            if (typeof messageLogsChannelId === 'string') {
                db.setConfig(targetGuildId, 'messageLogsChannelId', messageLogsChannelId);
            }
            if (typeof welcomeMessage === 'string') {
                db.setConfig(targetGuildId, 'welcomeMessage', welcomeMessage);
            }
            if (typeof farewellMessage === 'string') {
                db.setConfig(targetGuildId, 'farewellMessage', farewellMessage);
            }
            if (typeof farewellChannelId === 'string') {
                db.setConfig(targetGuildId, 'farewellChannelId', farewellChannelId);
            }
            if (typeof modRoleId === 'string') {
                db.setConfig(targetGuildId, 'modRoleId', modRoleId);
            }
            if (typeof bypassRoleId === 'string') {
                db.setConfig(targetGuildId, 'bypassRoleId', bypassRoleId);
            }
            if (typeof antiSpam === 'boolean' || typeof antiSpam === 'number') {
                db.setConfig(targetGuildId, 'antiSpam', antiSpam ? 1 : 0);
            }
            if (typeof antiRaid === 'boolean' || typeof antiRaid === 'number') {
                db.setConfig(targetGuildId, 'antiRaid', antiRaid ? 1 : 0);
            }
            if (Array.isArray(filteredWords)) {
                db.setConfig(targetGuildId, 'filteredWords', JSON.stringify(filteredWords));
            }

            // Extended feature settings
            if (typeof antiNukeEnabled === 'boolean' || typeof antiNukeEnabled === 'number') {
                db.setConfig(targetGuildId, 'antiNukeEnabled', antiNukeEnabled ? 1 : 0);
            }
            if (antiNukeThreshold !== undefined) {
                db.setConfig(targetGuildId, 'antiNukeThreshold', Number(antiNukeThreshold) || 3);
            }
            if (typeof altQuarantineEnabled === 'boolean' || typeof altQuarantineEnabled === 'number') {
                db.setConfig(targetGuildId, 'altQuarantineEnabled', altQuarantineEnabled ? 1 : 0);
            }
            if (altMinAgeDays !== undefined) {
                db.setConfig(targetGuildId, 'altMinAgeDays', Number(altMinAgeDays) || 3);
            }
            if (typeof quarantineRoleId === 'string') {
                db.setConfig(targetGuildId, 'quarantineRoleId', quarantineRoleId);
            }
            if (typeof verifyRoleId === 'string') {
                db.setConfig(targetGuildId, 'verifyRoleId', verifyRoleId);
            }
            if (typeof autoroleHumanId === 'string') {
                db.setConfig(targetGuildId, 'autoroleHumanId', autoroleHumanId);
            }
            if (typeof autoroleBotId === 'string') {
                db.setConfig(targetGuildId, 'autoroleBotId', autoroleBotId);
            }
            if (typeof ticketCategoryId === 'string') {
                db.setConfig(targetGuildId, 'ticketCategoryId', ticketCategoryId);
            }
            if (typeof ticketSupportRoleId === 'string') {
                db.setConfig(targetGuildId, 'ticketSupportRoleId', ticketSupportRoleId);
            }
            if (typeof voiceLogsChannelId === 'string') {
                db.setConfig(targetGuildId, 'voiceLogsChannelId', voiceLogsChannelId);
            }
            if (typeof voiceHopProtection === 'boolean' || typeof voiceHopProtection === 'number') {
                db.setConfig(targetGuildId, 'voiceHopProtection', voiceHopProtection ? 1 : 0);
            }

            // 2. Persist multi-tenant thresholds into SQLite (zero disk write)
            if (defaultMuteDuration !== undefined && typeof defaultMuteDuration === 'string') {
                db.setConfig(targetGuildId, 'defaultMuteDuration', defaultMuteDuration.trim());
            }
            if (warnThresholdMute !== undefined) {
                db.setConfig(targetGuildId, 'warnThresholdMute', Number(warnThresholdMute));
            }
            if (warnThresholdKick !== undefined) {
                db.setConfig(targetGuildId, 'warnThresholdKick', Number(warnThresholdKick));
            }
            if (warnExpiry !== undefined && typeof warnExpiry === 'string') {
                db.setConfig(targetGuildId, 'warnExpiry', warnExpiry.trim());
            }
            if (maxMentions !== undefined) {
                db.setConfig(targetGuildId, 'maxMentions', Number(maxMentions));
            }
            if (maxLines !== undefined) {
                db.setConfig(targetGuildId, 'maxLines', Number(maxLines));
            }
            if (maxEmojis !== undefined) {
                db.setConfig(targetGuildId, 'maxEmojis', Number(maxEmojis));
            }
            if (spamThreshold !== undefined) {
                db.setConfig(targetGuildId, 'spamThreshold', Number(spamThreshold));
            }

            res.json({ success: true, message: 'تم حفظ كافة الإعدادات بنجاح' });
        } catch (error) {
            console.error('[Dashboard API] Error in POST /api/config:', error);
            res.status(500).json({ error: 'Failed to update config' });
        }
    });

    // API: Undo Action (Deactivate Case & Unmute target if applicable)
    app.post('/api/action/undo', requireAuth, requireGuildAccess, mutationLimiter, async (req, res) => {
        try {
            const { caseNumber, userId, action, warningId } = req.body;
            if (!caseNumber && !warningId) {
                return res.status(400).json({ error: 'Missing case number or warning ID' });
            }

            const primaryGuild = req.guild;
            const guildId = req.guildId;

            if (caseNumber) {
                const targetCase = db.getCaseByNumber(guildId, caseNumber);
                if (!targetCase) {
                    return res.status(404).json({ error: 'CaseNotFound', message: 'الحالة غير موجودة في هذا السيرفر' });
                }
                db.deactivateCase(caseNumber, guildId);
            }

            if (warningId) {
                const changed = db.deactivateWarning(warningId, guildId);
                if (!caseNumber && changed === 0) {
                    return res.status(404).json({ error: 'WarningNotFound', message: 'التحذير غير موجود في هذا السيرفر' });
                }
            } else if (action === 'warn') {
                if (caseNumber) {
                    db.deactivateWarning(caseNumber, guildId);
                }
                if (userId && !warningId) {
                    const activeWarns = db.getActiveWarnings(guildId, userId);
                    if (activeWarns.length > 0) {
                        db.deactivateWarning(activeWarns[0].id, guildId);
                    }
                }
            }

            if (action === 'mute' && userId && primaryGuild) {
                const member = await primaryGuild.members.fetch(userId).catch(() => null);
                if (member && member.isCommunicationDisabled()) {
                    await member.timeout(null, 'Undo via Dashboard');
                }
            }

            res.json({ success: true, message: 'تم التراجع عن الإجراء بنجاح' });
        } catch (error) {
            console.error('[Dashboard API] Error in /api/action/undo:', error);
            res.status(500).json({ error: 'Failed to execute undo' });
        }
    });

    // API: Trigger Immediate DB Backup
    app.post('/api/backup/now', requireAuth, mutationLimiter, (req, res) => {
        try {
            const result = db.backupDatabase();
            if (result) {
                res.json({ success: true, backup: result, message: 'تم إنشاء باك اب بنجاح' });
            } else {
                res.status(500).json({ error: 'فشل إنشاء الباك اب' });
            }
        } catch (err) {
            console.error('[Dashboard API] Error in /api/backup/now:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // API: List Backups
    app.get('/api/backups', requireAuth, (req, res) => {
        try {
            const backups = db.getBackups();
            res.json(backups);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/backups:', error);
            res.status(500).json({ error: 'Failed to list backups' });
        }
    });

    // API: Self Roles List
    app.get('/api/self-roles', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const roles = db.getSelfRoles(guildId);
            res.json(roles);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/self-roles:', error);
            res.status(500).json({ error: 'Failed to retrieve self roles' });
        }
    });

    // API: Add Self Role
    app.post('/api/self-roles', requireAuth, requireGuildAccess, mutationLimiter, (req, res) => {
        try {
            const guildId = req.guildId;
            const { roleId, label, emoji, description } = req.body;
            if (!roleId || !label) {
                return res.status(400).json({ error: 'Role ID and Label are required' });
            }
            const id = db.addSelfRole(guildId, roleId, label, emoji || null, description || null);
            res.json({ success: true, id, message: 'تمت إضافة الرتبة التفاعلية بنجاح' });
        } catch (error) {
            console.error('[Dashboard API] Error in POST /api/self-roles:', error);
            res.status(500).json({ error: 'Failed to add self role' });
        }
    });

    // API: Delete Self Role
    app.delete('/api/self-roles/:id', requireAuth, requireGuildAccess, mutationLimiter, (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            db.deleteSelfRoleById(id, req.guildId);
            res.json({ success: true, message: 'تم حذف الرتبة التفاعلية' });
        } catch (error) {
            console.error('[Dashboard API] Error in DELETE /api/self-roles:', error);
            res.status(500).json({ error: 'Failed to delete self role' });
        }
    });

    // API: Member Activity Leaderboard
    app.get('/api/leaderboard', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const days = parseInt(req.query.days, 10) || 7;
            const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
            const members = db.getTopMembers(guildId, days, limit);
            res.json(members);
        } catch (error) {
            console.error('[Dashboard API] Error in /api/leaderboard:', error);
            res.status(500).json({ error: 'Failed to retrieve leaderboard' });
        }
    });

    // API: User Moderation History Lookup
    app.get('/api/user-history/:userId', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const userId = req.params.userId;
            const cases = db.getCases(guildId, userId);
            const warnings = db.getWarnings(guildId, userId);
            const activeWarnings = db.getActiveWarnings(guildId, userId);
            const tickets = db.getUserTickets ? db.getUserTickets(guildId, userId) : db.getAllTickets(guildId, 1000).filter(t => t.user_id === userId);
            const quarantined = db.getQuarantinedUsers(guildId).some(q => q.user_id === userId && q.active === 1);
            const activity = db.getMemberActivityStats(guildId, userId);

            res.json({
                userId,
                cases,
                warnings,
                activeWarnings,
                tickets,
                quarantined,
                activity
            });
        } catch (error) {
            console.error('[Dashboard API] Error in /api/user-history:', error);
            res.status(500).json({ error: 'Failed to retrieve user history' });
        }
    });

    // API: Send Embed / Announcement to Channel
    app.post('/api/embed/send', requireAuth, requireGuildAccess, mutationLimiter, async (req, res) => {
        try {
            const { channelId, content, embed: embedData, buttons } = req.body;
            if (!channelId) {
                return res.status(400).json({ error: 'Please select a destination channel' });
            }

            let channel = client.channels?.cache.get(channelId);
            if (!channel && client.channels?.fetch) {
                try {
                    channel = await client.channels.fetch(channelId);
                } catch {}
            }

            if (!channel) {
                return res.status(404).json({ error: 'Target channel could not be found' });
            }

            // Verify channel belongs to authorized guild
            const channelGuildId = channel.guildId || channel.guild?.id;
            if (channelGuildId !== req.guildId) {
                return res.status(403).json({ error: 'ForbiddenChannel', message: 'القناة المحددة لا تنتمي إلى هذا السيرفر' });
            }

            if (!channel.isTextBased()) {
                return res.status(400).json({ error: 'Target channel must be a text-based channel' });
            }

            const me = channel.guild?.members?.me || channel.guild?.members?.cache.get(client.user?.id);
            if (me) {
                const perms = channel.permissionsFor(me);
                if (perms && !perms.has('SendMessages')) {
                    return res.status(403).json({ error: 'Bot lacks permission to send messages in that channel' });
                }
                if (embedData && perms && !perms.has('EmbedLinks')) {
                    return res.status(403).json({ error: 'Bot lacks permission to embed links in that channel' });
                }
            }

            const payload = {};
            if (content && typeof content === 'string' && content.trim()) {
                payload.content = content.trim();
            }

            if (embedData) {
                const eb = new EmbedBuilder();
                let hasEmbedContent = false;

                if (embedData.title && embedData.title.trim()) {
                    eb.setTitle(embedData.title.trim().slice(0, 256));
                    hasEmbedContent = true;
                    if (embedData.url && typeof embedData.url === 'string' && embedData.url.startsWith('http')) {
                        eb.setURL(embedData.url.trim());
                    }
                }

                if (embedData.description && embedData.description.trim()) {
                    eb.setDescription(embedData.description.trim().slice(0, 4096));
                    hasEmbedContent = true;
                }

                if (embedData.color) {
                    try {
                        const hex = embedData.color.replace('#', '');
                        eb.setColor(parseInt(hex, 16) || 0x5865F2);
                    } catch {
                        eb.setColor(0x5865F2);
                    }
                } else {
                    eb.setColor(0x5865F2);
                }

                if (embedData.author && embedData.author.name && embedData.author.name.trim()) {
                    const authorObj = { name: embedData.author.name.trim().slice(0, 256) };
                    if (embedData.author.iconURL && embedData.author.iconURL.startsWith('http')) {
                        authorObj.iconURL = embedData.author.iconURL.trim();
                    }
                    if (embedData.author.url && embedData.author.url.startsWith('http')) {
                        authorObj.url = embedData.author.url.trim();
                    }
                    eb.setAuthor(authorObj);
                    hasEmbedContent = true;
                }

                if (embedData.thumbnail && embedData.thumbnail.trim() && embedData.thumbnail.startsWith('http')) {
                    eb.setThumbnail(embedData.thumbnail.trim());
                    hasEmbedContent = true;
                }

                if (embedData.image && embedData.image.trim() && embedData.image.startsWith('http')) {
                    eb.setImage(embedData.image.trim());
                    hasEmbedContent = true;
                }

                if (embedData.footer && embedData.footer.text && embedData.footer.text.trim()) {
                    const footerObj = { text: embedData.footer.text.trim().slice(0, 2048) };
                    if (embedData.footer.iconURL && embedData.footer.iconURL.startsWith('http')) {
                        footerObj.iconURL = embedData.footer.iconURL.trim();
                    }
                    eb.setFooter(footerObj);
                    hasEmbedContent = true;
                }

                if (embedData.timestamp) {
                    eb.setTimestamp();
                    hasEmbedContent = true;
                }

                if (Array.isArray(embedData.fields)) {
                    for (const f of embedData.fields.slice(0, 25)) {
                        if (f && f.name && f.value) {
                            eb.addFields({
                                name: String(f.name).slice(0, 256),
                                value: String(f.value).slice(0, 1024),
                                inline: Boolean(f.inline)
                            });
                            hasEmbedContent = true;
                        }
                    }
                }

                if (hasEmbedContent) {
                    payload.embeds = [eb];
                }
            }

            if (Array.isArray(buttons) && buttons.length > 0) {
                const actionRow = new ActionRowBuilder();
                let buttonCount = 0;
                for (const b of buttons.slice(0, 5)) {
                    if (b && b.label && b.url) {
                        try {
                            const trimmedUrl = String(b.url).trim();
                            const parsed = new URL(trimmedUrl);
                            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                                actionRow.addComponents(
                                    new ButtonBuilder()
                                        .setStyle(ButtonStyle.Link)
                                        .setLabel(String(b.label).trim().slice(0, 80))
                                        .setURL(trimmedUrl)
                                );
                                buttonCount++;
                            }
                        } catch {}
                    }
                }
                if (buttonCount > 0) {
                    payload.components = [actionRow];
                }
            }

            if (!payload.content && (!payload.embeds || payload.embeds.length === 0)) {
                return res.status(400).json({ error: 'Cannot send an empty message or embed' });
            }

            const sentMessage = await channel.send(payload);
            res.json({
                success: true,
                messageId: sentMessage.id,
                channelId: channel.id,
                channelName: channel.name
            });
        } catch (error) {
            console.error('[Dashboard API] Error in /api/embed/send:', error);
            res.status(500).json({ error: error.message || 'Failed to dispatch embed message' });
        }
    });

    // API: Embed Templates
    app.get('/api/embeds/templates', requireAuth, requireGuildAccess, (req, res) => {
        try {
            const guildId = req.guildId;
            const templates = db.getEmbedTemplates(guildId);
            res.json(templates);
        } catch (error) {
            console.error('[Dashboard API] Error in GET /api/embeds/templates:', error);
            res.status(500).json({ error: 'Failed to retrieve templates' });
        }
    });

    app.post('/api/embeds/templates', requireAuth, requireGuildAccess, mutationLimiter, (req, res) => {
        try {
            const guildId = req.guildId;
            const { name, data } = req.body;
            if (!name || !name.trim()) {
                return res.status(400).json({ error: 'Template name is required' });
            }
            if (!data) {
                return res.status(400).json({ error: 'Template data is required' });
            }
            const id = db.saveEmbedTemplate(guildId, name.trim(), data);
            res.json({ success: true, id });
        } catch (error) {
            console.error('[Dashboard API] Error in POST /api/embeds/templates:', error);
            res.status(500).json({ error: 'Failed to save template' });
        }
    });

    app.delete('/api/embeds/templates/:id', requireAuth, requireGuildAccess, mutationLimiter, (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const success = db.deleteEmbedTemplate(id, req.guildId);
            res.json({ success });
        } catch (error) {
            console.error('[Dashboard API] Error in DELETE /api/embeds/templates/:id:', error);
            res.status(500).json({ error: 'Failed to delete template' });
        }
    });

    // Fallback: SPA routing to index.html
    app.use((req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    const server = app.listen(port, () => {
        console.log(`[Dashboard] ModBot Dashboard is running live at http://localhost:${port}`);
    });

    return server;
}

module.exports = { startDashboard };
