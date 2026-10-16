/**
 * @file src/dashboard/routes/auth.js
 * @description Discord OAuth2 Authentication Engine for ModBot Web Dashboard.
 */

const express = require('express');
const crypto = require('crypto');

// Discord Permission Bitflags (BigInt 64-bit safe)
const PERMS = {
    ADMINISTRATOR: 0x8n,   // 1n << 3n
    MANAGE_GUILD:  0x20n   // 1n << 5n
};

// Discord API v10 Endpoints
const DISCORD_API = 'https://discord.com/api/v10';
const OAUTH_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const OAUTH_TOKEN_URL = `${DISCORD_API}/oauth2/token`;
const OAUTH_USER_URL = `${DISCORD_API}/users/@me`;
const OAUTH_GUILDS_URL = `${DISCORD_API}/users/@me/guilds`;

/**
 * Creates and configures the OAuth2 Express Router
 * @param {import('../../structures/ExtendedClient')} client Discord bot client instance
 * @returns {express.Router}
 */
function createAuthRouter(client) {
    const router = express.Router();

    /**
     * Helper to resolve callback URL dynamically or from environment
     */
    function getRedirectUri(req) {
        if (process.env.DISCORD_REDIRECT_URI) {
            return process.env.DISCORD_REDIRECT_URI;
        }
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.get('host');
        return `${protocol}://${host}/auth/discord/callback`;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. GET /auth/discord — Authorization Redirect
    // ─────────────────────────────────────────────────────────────────────────────
    router.get('/discord', (req, res) => {
        const clientId = process.env.CLIENT_ID;
        if (!clientId) {
            console.error('[OAuth2] CLIENT_ID is missing in environment variables');
            return res.redirect('/?error=server_misconfigured');
        }

        // Generate cryptographically random state to protect against CSRF
        const state = crypto.randomBytes(16).toString('hex');
        if (req.session) {
            req.session.oauthState = state;
            const returnTo = req.query.returnTo;
            if (typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
                req.session.returnTo = returnTo;
            }
        }

        const redirectUri = getRedirectUri(req);
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'identify guilds',
            state: state,
            prompt: 'consent'
        });

        if (req.session) {
            req.session.save((err) => {
                if (err) console.error('[OAuth2] Error saving session state:', err);
                res.redirect(`${OAUTH_AUTHORIZE_URL}?${params.toString()}`);
            });
        } else {
            res.redirect(`${OAUTH_AUTHORIZE_URL}?${params.toString()}`);
        }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. GET /auth/discord/callback — Token Exchange & Session Initialization
    // ─────────────────────────────────────────────────────────────────────────────
    router.get('/discord/callback', async (req, res) => {
        try {
            const { code, state, error, error_description } = req.query;

            // Handle user denial or OAuth provider errors
            if (error) {
                console.warn(`[OAuth2] Authorization denied or failed: ${error} (${error_description})`);
                return res.redirect(`/?error=oauth_denied&message=${encodeURIComponent(error_description || error)}`);
            }

            if (!code) {
                return res.redirect('/?error=missing_code');
            }

            // Anti-CSRF state validation
            if (!req.session || !req.session.oauthState || req.session.oauthState !== state) {
                console.warn('[OAuth2] State mismatch or expired session state');
                if (req.session) delete req.session.oauthState;
                return res.redirect('/?error=invalid_state');
            }
            // State is single-use: clear immediately
            delete req.session.oauthState;

            const clientId = process.env.CLIENT_ID;
            const clientSecret = process.env.CLIENT_SECRET;
            const redirectUri = getRedirectUri(req);

            if (!clientSecret) {
                console.error('[OAuth2] CLIENT_SECRET is missing in environment variables');
                return res.redirect('/?error=server_misconfigured');
            }

            // A. Exchange authorization code for OAuth2 tokens
            const tokenResponse = await fetch(OAUTH_TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'authorization_code',
                    code: String(code),
                    redirect_uri: redirectUri
                })
            });

            if (!tokenResponse.ok) {
                const errorData = await tokenResponse.text();
                console.error(`[OAuth2] Token exchange error (${tokenResponse.status}):`, errorData);
                return res.redirect('/?error=token_exchange_failed');
            }

            const tokenData = await tokenResponse.json();
            const accessToken = tokenData.access_token;

            // B. Fetch authenticated user profile (/users/@me)
            const userResponse = await fetch(OAUTH_USER_URL, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            });

            if (!userResponse.ok) {
                console.error(`[OAuth2] Failed to fetch user profile (${userResponse.status})`);
                return res.redirect('/?error=user_fetch_failed');
            }

            const userData = await userResponse.json();

            // C. Fetch user guilds (/users/@me/guilds)
            const guildsResponse = await fetch(OAUTH_GUILDS_URL, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            });

            if (!guildsResponse.ok) {
                console.error(`[OAuth2] Failed to fetch user guilds (${guildsResponse.status})`);
                return res.redirect('/?error=guilds_fetch_failed');
            }

            const userGuilds = await guildsResponse.json();

            // D. BigInt permission filtering: ADMINISTRATOR (0x8n) or MANAGE_GUILD (0x20n) or owner === true
            const authorizedGuilds = (Array.isArray(userGuilds) ? userGuilds : []).filter(guild => {
                if (guild.owner === true) return true;
                try {
                    const permissions = BigInt(guild.permissions || '0');
                    return (permissions & PERMS.ADMINISTRATOR) === PERMS.ADMINISTRATOR ||
                           (permissions & PERMS.MANAGE_GUILD) === PERMS.MANAGE_GUILD;
                } catch {
                    return false;
                }
            }).map(guild => {
                const isBotPresent = client?.guilds?.cache ? client.guilds.cache.has(guild.id) : false;
                return {
                    id: guild.id,
                    name: guild.name,
                    icon: guild.icon,
                    iconUrl: guild.icon
                        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
                        : null,
                    owner: Boolean(guild.owner),
                    permissions: guild.permissions,
                    botPresent: isBotPresent
                };
            });

            // E. Determine activeGuildId: prioritize first authorized guild where bot is present
            let activeGuildId = null;
            const primaryGuild = authorizedGuilds.find(g => g.botPresent);
            if (primaryGuild) {
                activeGuildId = primaryGuild.id;
            } else if (authorizedGuilds.length > 0) {
                activeGuildId = authorizedGuilds[0].id;
            }

            // F. Build sanitized user object
            let avatarUrl;
            if (userData.avatar) {
                avatarUrl = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=128`;
            } else {
                try {
                    const defaultIndex = (BigInt(userData.id || '0') >> 22n) % 6n;
                    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
                } catch {
                    avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
                }
            }

            const sessionUser = {
                id: userData.id,
                username: userData.username,
                discriminator: userData.discriminator,
                globalName: userData.global_name || userData.username,
                avatar: userData.avatar,
                avatarUrl: avatarUrl
            };

            // G. Save to session
            req.session.user = sessionUser;
            req.session.guilds = authorizedGuilds;
            req.session.activeGuildId = activeGuildId;

            const destination = req.session.returnTo || '/';
            delete req.session.returnTo;

            req.session.save((err) => {
                if (err) {
                    console.error('[OAuth2] Error committing session:', err);
                    return res.redirect('/?error=session_save_failed');
                }
                return res.redirect(destination);
            });

        } catch (error) {
            console.error('[OAuth2] Unhandled exception in callback:', error);
            return res.redirect('/?error=oauth_internal_error');
        }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. GET /auth/me — Current User Status & Managed Guilds
    // ─────────────────────────────────────────────────────────────────────────────
    router.get('/me', (req, res) => {
        if (!req.session || !req.session.user) {
            return res.status(200).json({
                authenticated: false,
                user: null,
                guilds: [],
                activeGuildId: null
            });
        }

        // Dynamically re-verify botPresent status in case bot joined/left servers
        const currentGuilds = (req.session.guilds || []).map(guild => ({
            ...guild,
            botPresent: client?.guilds?.cache ? client.guilds.cache.has(guild.id) : false
        }));

        return res.status(200).json({
            authenticated: true,
            user: req.session.user,
            guilds: currentGuilds,
            activeGuildId: req.session.activeGuildId || null
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. GET /auth/logout — Destroy Session & Clear Cookie
    // ─────────────────────────────────────────────────────────────────────────────
    router.get('/logout', (req, res) => {
        if (!req.session) {
            return res.redirect('/');
        }

        const cookieName = process.env.SESSION_COOKIE_NAME || 'modbot.sid';

        req.session.destroy((err) => {
            if (err) {
                console.error('[OAuth2] Error destroying session on logout:', err);
            }
            res.clearCookie(cookieName, { path: '/' });
            return res.redirect('/');
        });
    });

    return router;
}

module.exports = createAuthRouter;
module.exports.createAuthRouter = createAuthRouter;
