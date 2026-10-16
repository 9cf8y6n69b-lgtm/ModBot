/**
 * @file src/dashboard/middleware/auth.js
 * @description Production Dual-Layer Authentication & Multi-Guild Authorization Guard for ModBot.
 */

const ADMIN_PERMISSION = 0x8n;
const MANAGE_GUILD_PERMISSION = 0x20n;

/**
 * Resolves target guild ID following strict precedence:
 * 1. Header: x-guild-id
 * 2. Query param: ?guildId=...
 * 3. Body param: { guildId: ... }
 * 4. Session: req.session.activeGuildId
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function resolveTargetGuildId(req) {
    const rawId = req.headers['x-guild-id']
        || req.query?.guildId
        || req.body?.guildId
        || req.session?.activeGuildId;

    if (!rawId) return null;
    if (typeof rawId !== 'string' && typeof rawId !== 'number') return null;

    const cleanId = String(rawId).trim();
    if (!cleanId || cleanId === '__proto__' || cleanId === 'constructor' || cleanId === 'prototype') {
        return null;
    }

    return cleanId;
}

/**
 * Validates administrative permissions for the user on a specific guild.
 *
 * @param {Object} sessionUser - req.session.user
 * @param {Array} sessionGuilds - req.session.guilds
 * @param {import('discord.js').Guild} guild - Discord.js guild instance
 * @returns {boolean}
 */
function hasGuildAdminPermissions(sessionUser, sessionGuilds, guild) {
    if (!sessionUser || !guild) return false;

    // 1. Direct guild owner check against Discord Guild
    if (guild.ownerId && String(guild.ownerId) === String(sessionUser.id)) {
        return true;
    }

    // 2. Check session authorized guilds (populated during OAuth2 callback)
    if (Array.isArray(sessionGuilds)) {
        const cachedGuild = sessionGuilds.find(g => String(g.id) === String(guild.id));
        if (cachedGuild) {
            if (cachedGuild.owner === true) return true;
            if (cachedGuild.permissions !== undefined) {
                try {
                    const perms = BigInt(cachedGuild.permissions);
                    if ((perms & ADMIN_PERMISSION) === ADMIN_PERMISSION ||
                        (perms & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION) {
                        return true;
                    }
                } catch {
                    return false;
                }
            } else {
                // If pre-filtered during OAuth2 callback, presence implies authorization
                return true;
            }
        }
    }

    // 3. Fallback: Check cached Discord.js member permissions
    if (guild.members?.cache) {
        const member = guild.members.cache.get(sessionUser.id);
        if (member && member.permissions) {
            if (typeof member.permissions.has === 'function') {
                if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) {
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * Factory function creating middleware bound to a Discord client instance.
 *
 * @param {import('../structures/ExtendedClient')} [discordClient]
 * @returns {{ requireAuth: Function, requireGuildAccess: Function, resolveTargetGuildId: Function, hasGuildAdminPermissions: Function }}
 */
function createAuthMiddleware(discordClient) {

    /**
     * Layer 1: Authentication Guard
     * Ensures request originates from an active authenticated Discord session.
     */
    function requireAuth(req, res, next) {
        const isTestBypass = process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-auth'];

        if (req.session?.user || isTestBypass) {
            if (isTestBypass && !req.session?.user) {
                req.user = {
                    id: 'test_admin_user',
                    username: 'TestAdmin',
                    discriminator: '0001',
                    avatar: null
                };
            } else {
                req.user = req.session.user;
            }
            return next();
        }

        return res.status(401).json({
            error: 'Unauthorized',
            message: 'تسجيل الدخول عبر ديسكورد مطلوب'
        });
    }

    /**
     * Layer 2: Multi-Guild Tenant Authorization Guard
     * Ensures target guild exists, bot is present, and user has administrative rank.
     */
    function requireGuildAccess(req, res, next) {
        const client = discordClient || req.discordClient || req.app?.get('discordClient') || req.client;
        const isTestBypass = process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-auth'];

        const targetGuildId = resolveTargetGuildId(req);

        if (!targetGuildId) {
            return res.status(400).json({
                error: 'BadRequest',
                message: 'لم يتم تحديد معرّف السيرفر (guildId)'
            });
        }

        // Check if Discord client is available and bot is in target guild
        if (!client || !client.guilds?.cache.has(targetGuildId)) {
            return res.status(404).json({
                error: 'GuildNotFound',
                message: 'البوت غير متواجد في هذا السيرفر'
            });
        }

        const guild = client.guilds.cache.get(targetGuildId);

        // Test runner bypass (only active in test environment)
        if (isTestBypass) {
            req.guildId = targetGuildId;
            req.guild = guild;
            return next();
        }

        // Validate session user
        if (!req.session?.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'تسجيل الدخول عبر ديسكورد مطلوب'
            });
        }

        // Check user administrative authorization
        const isAuthorized = hasGuildAdminPermissions(req.session.user, req.session.guilds, guild);

        if (!isAuthorized) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحيات إدارية في هذا السيرفر'
            });
        }

        // Authorization confirmed: populate request context
        req.guildId = targetGuildId;
        req.guild = guild;
        return next();
    }

    return {
        requireAuth,
        requireGuildAccess,
        resolveTargetGuildId,
        hasGuildAdminPermissions
    };
}

const defaultMiddleware = createAuthMiddleware();

module.exports = {
    createAuthMiddleware,
    requireAuth: defaultMiddleware.requireAuth,
    requireGuildAccess: defaultMiddleware.requireGuildAccess,
    resolveTargetGuildId,
    hasGuildAdminPermissions
};
