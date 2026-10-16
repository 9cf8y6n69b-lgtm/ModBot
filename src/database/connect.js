const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');
const configData = require('../../config.json');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'modbot.db');
const dataDir = path.dirname(DB_PATH);
const backupsDir = path.join(dataDir, 'backups');

/** @type {import('sql.js').Database} */
let db = null;

/**
 * Saves the database to disk
 */
function save() {
    if (!db) return;
    try {
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (err) {
        console.error('Failed to save database:', err);
    }
}

/**
 * Creates an automated rolling backup of the database
 * @returns {string|null} Path to backup file
 */
function backupDatabase() {
    if (!db) return null;
    try {
        if (!fs.existsSync(backupsDir)) {
            fs.mkdirSync(backupsDir, { recursive: true });
        }

        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupsDir, `modbot-backup-${timestamp}.db`);

        const data = db.export();
        fs.writeFileSync(backupFile, Buffer.from(data));

        // Retention policy: Keep the latest 7 backups, delete older ones
        const existing = fs.readdirSync(backupsDir)
            .filter(file => file.startsWith('modbot-backup-') && file.endsWith('.db'))
            .map(file => ({
                file,
                fullPath: path.join(backupsDir, file),
                mtime: fs.statSync(path.join(backupsDir, file)).mtimeMs
            }))
            .sort((a, b) => b.mtime - a.mtime);

        if (existing.length > 7) {
            for (const old of existing.slice(7)) {
                try { fs.unlinkSync(old.fullPath); } catch {}
            }
        }

        return backupFile;
    } catch (err) {
        console.error('[Backup] Failed to backup database:', err);
        return null;
    }
}

/**
 * Runs a query that returns rows as an array of objects
 * @param {string} sql - SQL query
 * @param {Array} params - Bind parameters
 * @returns {Array<Object>} Array of row objects
 */
function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

/**
 * Runs a query that returns a single row as an object
 * @param {string} sql - SQL query
 * @param {Array} params - Bind parameters
 * @returns {Object|null} Row object or null
 */
function queryOne(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

/**
 * Runs a statement (INSERT/UPDATE/DELETE) and returns result info
 * @param {string} sql - SQL statement
 * @param {Array} params - Bind parameters
 * @returns {{ changes: number, lastId: number }}
 */
function run(sql, params = []) {
    db.run(sql, params);
    const changes = db.getRowsModified();
    const idRow = db.exec('SELECT last_insert_rowid() AS id');
    const lastId = (idRow.length > 0 && idRow[0].values.length > 0) ? idRow[0].values[0][0] : 0;
    save();
    return { changes, lastId };
}

/**
 * Checks and expires old warnings based on configData.moderation.warnExpiry
 * @returns {number} Expired warnings count
 */
function checkAndExpireWarnings() {
    if (!db) return 0;
    try {
        const expiryStr = configData.moderation?.warnExpiry || '30d';
        const expiryMs = ms(expiryStr) || (30 * 24 * 60 * 60 * 1000);
        const cutoff = new Date(Date.now() - expiryMs).toISOString();

        const result = run(
            'UPDATE warnings SET active = 0 WHERE active = 1 AND (created_at < ? OR (expires_at IS NOT NULL AND expires_at < datetime(\'now\')))',
            [cutoff]
        );
        return result.changes;
    } catch (e) {
        console.error('[Database] Failed to expire warnings:', e);
        return 0;
    }
}

/**
 * Initializes the database. Must be called before any other function.
 * @returns {Promise<void>}
 */
async function initDatabase() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS guild_config (
            guild_id TEXT PRIMARY KEY,
            log_channel_id TEXT,
            mute_role_id TEXT,
            mod_role_id TEXT,
            bypass_role_id TEXT,
            automod_enabled INTEGER DEFAULT 0,
            word_filter TEXT DEFAULT '[]',
            anti_spam INTEGER DEFAULT 0,
            anti_raid INTEGER DEFAULT 0,
            welcome_channel_id TEXT,
            anti_nuke_enabled INTEGER DEFAULT 1,
            anti_nuke_threshold INTEGER DEFAULT 3,
            alt_quarantine_enabled INTEGER DEFAULT 0,
            alt_min_age_days INTEGER DEFAULT 3,
            quarantine_role_id TEXT,
            verify_role_id TEXT,
            autorole_human_id TEXT,
            autorole_bot_id TEXT,
            ticket_category_id TEXT,
            ticket_support_role_id TEXT,
            voice_logs_channel_id TEXT,
            voice_hop_protection INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            case_number INTEGER,
            user_id TEXT,
            moderator_id TEXT,
            action TEXT,
            reason TEXT,
            duration TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS warnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            user_id TEXT,
            moderator_id TEXT,
            reason TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT,
            active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS quarantined_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            user_id TEXT,
            reason TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            channel_id TEXT,
            ticket_number INTEGER,
            user_id TEXT,
            closed_by TEXT,
            transcript TEXT,
            status TEXT DEFAULT 'open',
            created_at TEXT DEFAULT (datetime('now')),
            closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS voice_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            user_id TEXT,
            action TEXT,
            channel_id TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS self_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            role_id TEXT,
            label TEXT,
            emoji TEXT,
            description TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS member_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            user_id TEXT,
            username TEXT,
            date TEXT,
            message_count INTEGER DEFAULT 1,
            last_active TEXT DEFAULT (datetime('now')),
            UNIQUE(guild_id, user_id, date)
        );

        CREATE TABLE IF NOT EXISTS embed_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);

    // Ensure backwards compatibility for newly added columns
    const columnsToAdd = [
        'bypass_role_id TEXT',
        'anti_nuke_enabled INTEGER DEFAULT 1',
        'anti_nuke_threshold INTEGER DEFAULT 3',
        'alt_quarantine_enabled INTEGER DEFAULT 0',
        'alt_min_age_days INTEGER DEFAULT 3',
        'quarantine_role_id TEXT',
        'verify_role_id TEXT',
        'autorole_human_id TEXT',
        'autorole_bot_id TEXT',
        'ticket_category_id TEXT',
        'ticket_support_role_id TEXT',
        'voice_logs_channel_id TEXT',
        'voice_hop_protection INTEGER DEFAULT 1',
        'message_logs_channel_id TEXT',
        'welcome_message TEXT',
        'farewell_message TEXT',
        'farewell_channel_id TEXT',
        'default_mute_duration TEXT',
        'warn_threshold_mute INTEGER',
        'warn_threshold_kick INTEGER',
        'warn_expiry TEXT',
        'max_mentions INTEGER',
        'max_lines INTEGER',
        'max_emojis INTEGER',
        'spam_threshold INTEGER'
    ];
    for (const col of columnsToAdd) {
        try {
            db.run(`ALTER TABLE guild_config ADD COLUMN ${col};`);
        } catch {}
    }

    try {
        db.run('ALTER TABLE cases ADD COLUMN expires_at TEXT;');
    } catch {}

    try {
        db.run('ALTER TABLE member_activity ADD COLUMN username TEXT;');
    } catch {}
    try {
        db.run('ALTER TABLE member_activity ADD COLUMN last_active TEXT;');
    } catch {}

    save();
    console.log('[Database] SQLite initialized via sql.js (WASM)');

    // Run initial warning expiry check and backup
    checkAndExpireWarnings();
    backupDatabase();

    // Auto-save every 30 seconds
    setInterval(save, 30000).unref();

    // Warning expiry check every hour
    setInterval(checkAndExpireWarnings, 60 * 60 * 1000).unref();

    // Auto-backup every 24 hours
    setInterval(backupDatabase, 24 * 60 * 60 * 1000).unref();

    // Save on exit
    process.on('exit', save);
    process.on('SIGINT', () => { save(); process.exit(0); });
    process.on('SIGTERM', () => { save(); process.exit(0); });
}

// ─── Exported API ────────────────────────────────────────────────

/**
 * Gets guild configuration
 * @param {string} guildId
 * @returns {Object} Guild config object (with defaults if not found)
 */
function getConfig(guildId) {
    const row = queryOne('SELECT * FROM guild_config WHERE guild_id = ?', [guildId]);
    if (row) {
        return {
            guild_id: row.guild_id,
            log_channel_id: row.log_channel_id,
            logChannelId: row.log_channel_id,
            mute_role_id: row.mute_role_id,
            muteRoleId: row.mute_role_id,
            mod_role_id: row.mod_role_id,
            modRoleId: row.mod_role_id,
            bypass_role_id: row.bypass_role_id,
            bypassRoleId: row.bypass_role_id,
            automod_enabled: row.automod_enabled,
            automodEnabled: row.automod_enabled,
            word_filter: row.word_filter,
            filteredWords: row.word_filter,
            anti_spam: row.anti_spam,
            antiSpam: row.anti_spam,
            anti_raid: row.anti_raid,
            antiRaid: row.anti_raid,
            welcome_channel_id: row.welcome_channel_id,
            welcomeChannelId: row.welcome_channel_id,
            anti_nuke_enabled: row.anti_nuke_enabled !== undefined ? row.anti_nuke_enabled : 1,
            antiNukeEnabled: row.anti_nuke_enabled !== undefined ? row.anti_nuke_enabled : 1,
            anti_nuke_threshold: row.anti_nuke_threshold || 3,
            antiNukeThreshold: row.anti_nuke_threshold || 3,
            alt_quarantine_enabled: row.alt_quarantine_enabled || 0,
            altQuarantineEnabled: row.alt_quarantine_enabled || 0,
            alt_min_age_days: row.alt_min_age_days || 3,
            altMinAgeDays: row.alt_min_age_days || 3,
            quarantine_role_id: row.quarantine_role_id || null,
            quarantineRoleId: row.quarantine_role_id || null,
            verify_role_id: row.verify_role_id || null,
            verifyRoleId: row.verify_role_id || null,
            autorole_human_id: row.autorole_human_id || null,
            autoroleHumanId: row.autorole_human_id || null,
            autorole_bot_id: row.autorole_bot_id || null,
            autoroleBotId: row.autorole_bot_id || null,
            ticket_category_id: row.ticket_category_id || null,
            ticketCategoryId: row.ticket_category_id || null,
            ticket_support_role_id: row.ticket_support_role_id || null,
            ticketSupportRoleId: row.ticket_support_role_id || null,
            voice_logs_channel_id: row.voice_logs_channel_id || null,
            voiceLogsChannelId: row.voice_logs_channel_id || null,
            voice_hop_protection: row.voice_hop_protection !== undefined ? row.voice_hop_protection : 1,
            voiceHopProtection: row.voice_hop_protection !== undefined ? row.voice_hop_protection : 1,
            message_logs_channel_id: row.message_logs_channel_id || null,
            messageLogsChannelId: row.message_logs_channel_id || null,
            welcome_message: row.welcome_message || null,
            welcomeMessage: row.welcome_message || null,
            farewell_message: row.farewell_message || null,
            farewellMessage: row.farewell_message || null,
            farewell_channel_id: row.farewell_channel_id || null,
            farewellChannelId: row.farewell_channel_id || null,
            default_mute_duration: row.default_mute_duration || configData.moderation?.defaultMuteDuration || '10m',
            defaultMuteDuration: row.default_mute_duration || configData.moderation?.defaultMuteDuration || '10m',
            warn_threshold_mute: (row.warn_threshold_mute !== null && row.warn_threshold_mute !== undefined)
                ? row.warn_threshold_mute
                : (configData.moderation?.warnThresholdMute ?? 3),
            warnThresholdMute: (row.warn_threshold_mute !== null && row.warn_threshold_mute !== undefined)
                ? row.warn_threshold_mute
                : (configData.moderation?.warnThresholdMute ?? 3),
            warn_threshold_kick: (row.warn_threshold_kick !== null && row.warn_threshold_kick !== undefined)
                ? row.warn_threshold_kick
                : (configData.moderation?.warnThresholdKick ?? 5),
            warnThresholdKick: (row.warn_threshold_kick !== null && row.warn_threshold_kick !== undefined)
                ? row.warn_threshold_kick
                : (configData.moderation?.warnThresholdKick ?? 5),
            warn_expiry: row.warn_expiry || configData.moderation?.warnExpiry || '30d',
            warnExpiry: row.warn_expiry || configData.moderation?.warnExpiry || '30d',
            max_mentions: (row.max_mentions !== null && row.max_mentions !== undefined)
                ? row.max_mentions
                : (configData.automod?.maxMentions ?? 5),
            maxMentions: (row.max_mentions !== null && row.max_mentions !== undefined)
                ? row.max_mentions
                : (configData.automod?.maxMentions ?? 5),
            max_lines: (row.max_lines !== null && row.max_lines !== undefined)
                ? row.max_lines
                : (configData.automod?.maxLines ?? 10),
            maxLines: (row.max_lines !== null && row.max_lines !== undefined)
                ? row.max_lines
                : (configData.automod?.maxLines ?? 10),
            max_emojis: (row.max_emojis !== null && row.max_emojis !== undefined)
                ? row.max_emojis
                : (configData.automod?.maxEmojis ?? 6),
            maxEmojis: (row.max_emojis !== null && row.max_emojis !== undefined)
                ? row.max_emojis
                : (configData.automod?.maxEmojis ?? 6),
            spam_threshold: (row.spam_threshold !== null && row.spam_threshold !== undefined)
                ? row.spam_threshold
                : (configData.automod?.spamThreshold ?? 5),
            spamThreshold: (row.spam_threshold !== null && row.spam_threshold !== undefined)
                ? row.spam_threshold
                : (configData.automod?.spamThreshold ?? 5)
        };
    }
    return {
        guild_id: guildId,
        anti_nuke_enabled: 1,
        antiNukeEnabled: 1,
        anti_nuke_threshold: 3,
        antiNukeThreshold: 3,
        alt_quarantine_enabled: 0,
        altQuarantineEnabled: 0,
        alt_min_age_days: 3,
        altMinAgeDays: 3,
        voice_hop_protection: 1,
        voiceHopProtection: 1,
        message_logs_channel_id: null,
        messageLogsChannelId: null,
        welcome_message: null,
        welcomeMessage: null,
        farewell_message: null,
        farewellMessage: null,
        farewell_channel_id: null,
        farewellChannelId: null,
        default_mute_duration: configData.moderation?.defaultMuteDuration || '10m',
        defaultMuteDuration: configData.moderation?.defaultMuteDuration || '10m',
        warn_threshold_mute: configData.moderation?.warnThresholdMute ?? 3,
        warnThresholdMute: configData.moderation?.warnThresholdMute ?? 3,
        warn_threshold_kick: configData.moderation?.warnThresholdKick ?? 5,
        warnThresholdKick: configData.moderation?.warnThresholdKick ?? 5,
        warn_expiry: configData.moderation?.warnExpiry || '30d',
        warnExpiry: configData.moderation?.warnExpiry || '30d',
        max_mentions: configData.automod?.maxMentions ?? 5,
        maxMentions: configData.automod?.maxMentions ?? 5,
        max_lines: configData.automod?.maxLines ?? 10,
        maxLines: configData.automod?.maxLines ?? 10,
        max_emojis: configData.automod?.maxEmojis ?? 6,
        maxEmojis: configData.automod?.maxEmojis ?? 6,
        spam_threshold: configData.automod?.spamThreshold ?? 5,
        spamThreshold: configData.automod?.spamThreshold ?? 5
    };
}

/**
 * Sets a specific config field for a guild (upserts)
 * @param {string} guildId
 * @param {string} field - camelCase or snake_case field name
 * @param {*} value
 */
function setConfig(guildId, field, value) {
    const fieldMap = {
        logChannelId: 'log_channel_id',
        log_channel_id: 'log_channel_id',
        muteRoleId: 'mute_role_id',
        mute_role_id: 'mute_role_id',
        modRoleId: 'mod_role_id',
        mod_role_id: 'mod_role_id',
        bypassRoleId: 'bypass_role_id',
        bypass_role_id: 'bypass_role_id',
        automodEnabled: 'automod_enabled',
        automod_enabled: 'automod_enabled',
        filteredWords: 'word_filter',
        word_filter: 'word_filter',
        antiSpam: 'anti_spam',
        anti_spam: 'anti_spam',
        antiRaid: 'anti_raid',
        anti_raid: 'anti_raid',
        welcomeChannelId: 'welcome_channel_id',
        welcome_channel_id: 'welcome_channel_id',
        antiNukeEnabled: 'anti_nuke_enabled',
        anti_nuke_enabled: 'anti_nuke_enabled',
        antiNukeThreshold: 'anti_nuke_threshold',
        anti_nuke_threshold: 'anti_nuke_threshold',
        altQuarantineEnabled: 'alt_quarantine_enabled',
        alt_quarantine_enabled: 'alt_quarantine_enabled',
        altMinAgeDays: 'alt_min_age_days',
        alt_min_age_days: 'alt_min_age_days',
        quarantineRoleId: 'quarantine_role_id',
        quarantine_role_id: 'quarantine_role_id',
        verifyRoleId: 'verify_role_id',
        verify_role_id: 'verify_role_id',
        autoroleHumanId: 'autorole_human_id',
        autorole_human_id: 'autorole_human_id',
        autoroleBotId: 'autorole_bot_id',
        autorole_bot_id: 'autorole_bot_id',
        ticketCategoryId: 'ticket_category_id',
        ticket_category_id: 'ticket_category_id',
        ticketSupportRoleId: 'ticket_support_role_id',
        ticket_support_role_id: 'ticket_support_role_id',
        voiceLogsChannelId: 'voice_logs_channel_id',
        voice_logs_channel_id: 'voice_logs_channel_id',
        voiceHopProtection: 'voice_hop_protection',
        voice_hop_protection: 'voice_hop_protection',
        messageLogsChannelId: 'message_logs_channel_id',
        message_logs_channel_id: 'message_logs_channel_id',
        welcomeMessage: 'welcome_message',
        welcome_message: 'welcome_message',
        farewellMessage: 'farewell_message',
        farewell_message: 'farewell_message',
        farewellChannelId: 'farewell_channel_id',
        farewell_channel_id: 'farewell_channel_id',
        defaultMuteDuration: 'default_mute_duration',
        default_mute_duration: 'default_mute_duration',
        warnThresholdMute: 'warn_threshold_mute',
        warn_threshold_mute: 'warn_threshold_mute',
        warnThresholdKick: 'warn_threshold_kick',
        warn_threshold_kick: 'warn_threshold_kick',
        warnExpiry: 'warn_expiry',
        warn_expiry: 'warn_expiry',
        maxMentions: 'max_mentions',
        max_mentions: 'max_mentions',
        maxLines: 'max_lines',
        max_lines: 'max_lines',
        maxEmojis: 'max_emojis',
        max_emojis: 'max_emojis',
        spamThreshold: 'spam_threshold',
        spam_threshold: 'spam_threshold'
    };

    const column = fieldMap[field];
    if (!column) {
        console.error(`[Database] Unknown config field: ${field}`);
        return;
    }

    run('INSERT OR IGNORE INTO guild_config (guild_id) VALUES (?)', [guildId]);
    run(`UPDATE guild_config SET ${column} = ? WHERE guild_id = ?`, [value, guildId]);
}

/**
 * Updates multiple config fields for a guild
 * @param {string} guildId
 * @param {Object} configObj
 */
function updateConfig(guildId, configObj) {
    if (!configObj || typeof configObj !== 'object') return;
    for (const [key, value] of Object.entries(configObj)) {
        setConfig(guildId, key, value);
    }
}

/**
 * Gets the next case number for a guild
 * @param {string} guildId
 * @returns {number}
 */
function getNextCaseNumber(guildId) {
    const row = queryOne(
        'SELECT MAX(case_number) AS max_num FROM cases WHERE guild_id = ?',
        [guildId]
    );
    return (row && row.max_num) ? row.max_num + 1 : 1;
}

/**
 * Enriches a case record with remaining mute duration
 * @param {Object} c
 * @returns {Object}
 */
function enrichCase(c) {
    if (!c) return c;
    if (c.action === 'mute' && c.active === 1 && c.expires_at) {
        const expiryMs = new Date(c.expires_at).getTime();
        const remainingMs = expiryMs - Date.now();
        if (remainingMs > 0) {
            c.remaining_ms = remainingMs;
            const secs = Math.floor(remainingMs / 1000);
            const mins = Math.floor(secs / 60);
            const hours = Math.floor(mins / 60);
            const days = Math.floor(hours / 24);
            if (days > 0) c.remaining_duration = `${days} يوم و ${hours % 24} ساعة`;
            else if (hours > 0) c.remaining_duration = `${hours} ساعة و ${mins % 60} دقيقة`;
            else if (mins > 0) c.remaining_duration = `${mins} دقيقة و ${secs % 60} ثانية`;
            else c.remaining_duration = `${secs} ثانية`;
        } else {
            c.remaining_ms = 0;
            c.remaining_duration = 'منتهي الصلاحية';
        }
    }
    return c;
}

/**
 * Adds a new moderation case
 * @param {string} guildId
 * @param {string} action
 * @param {string} userId
 * @param {string} moderatorId
 * @param {string} reason
 * @param {string} [duration=null]
 * @param {string} [expiresAt=null]
 * @returns {number} Case number
 */
function addCase(guildId, action, userId, moderatorId, reason, duration = null, expiresAt = null) {
    const caseNumber = getNextCaseNumber(guildId);
    let resolvedExpiresAt = expiresAt;
    if (!resolvedExpiresAt && action === 'mute' && duration) {
        try {
            const parsedMs = ms(duration);
            if (parsedMs && !isNaN(parsedMs)) {
                resolvedExpiresAt = new Date(Date.now() + parsedMs).toISOString();
            }
        } catch {}
    }
    run(
        'INSERT INTO cases (guild_id, case_number, user_id, moderator_id, action, reason, duration, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [guildId, caseNumber, userId, moderatorId, action, reason, duration, resolvedExpiresAt]
    );
    return caseNumber;
}

/**
 * Gets all cases for a user in a guild
 * @param {string} guildId
 * @param {string} userId
 * @returns {Array<Object>}
 */
function getCases(guildId, userId) {
    const rows = queryAll(
        'SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
        [guildId, userId]
    );
    return rows.map(enrichCase);
}

/**
 * Gets a specific case by number
 * @param {string} guildId
 * @param {number} caseNumber
 * @returns {Object|null}
 */
function getCaseByNumber(guildId, caseNumber) {
    const row = queryOne(
        'SELECT * FROM cases WHERE guild_id = ? AND case_number = ?',
        [guildId, caseNumber]
    );
    return enrichCase(row);
}

/**
 * Adds a warning
 * @param {string} guildId
 * @param {string} userId
 * @param {string} moderatorId
 * @param {string} reason
 * @param {string} [expiresAt=null]
 * @returns {number} Warning ID
 */
function addWarning(guildId, userId, moderatorId, reason, expiresAt = null) {
    const result = run(
        'INSERT INTO warnings (guild_id, user_id, moderator_id, reason, expires_at) VALUES (?, ?, ?, ?, ?)',
        [guildId, userId, moderatorId, reason, expiresAt]
    );
    return result.lastId;
}

/**
 * Gets all warnings for a user
 * @param {string} guildId
 * @param {string} userId
 * @returns {Array<Object>}
 */
function getWarnings(guildId, userId) {
    return queryAll(
        'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
        [guildId, userId]
    );
}

/**
 * Gets only active warnings for a user (filters out expired ones)
 * @param {string} guildId
 * @param {string} userId
 * @returns {Array<Object>}
 */
function getActiveWarnings(guildId, userId) {
    checkAndExpireWarnings();
    return queryAll(
        'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1 ORDER BY created_at DESC',
        [guildId, userId]
    );
}

/**
 * Deactivates a warning
 * @param {number} warningId
 * @param {string} guildId
 * @returns {number} Number of rows changed
 */
function deactivateWarning(warningId, guildId) {
    const result = run(
        'UPDATE warnings SET active = 0 WHERE id = ? AND guild_id = ?',
        [warningId, guildId]
    );
    return result.changes;
}

/**
 * Deactivates a case
 * @param {number} caseNumber
 * @param {string} guildId
 * @returns {number} Number of rows changed
 */
function deactivateCase(caseNumber, guildId) {
    const result = run(
        'UPDATE cases SET active = 0 WHERE (case_number = ? OR id = ?) AND guild_id = ?',
        [caseNumber, caseNumber, guildId]
    );
    return result.changes;
}

/**
 * Gets recent cases for a specific guild (strictly required for multi-tenant isolation)
 * @param {string} guildId
 * @param {number} [limit=50]
 * @returns {Array<Object>}
 */
function getAllCases(guildId, limit = 50) {
    if (!guildId || typeof guildId !== 'string' || !guildId.trim()) {
        console.warn('[Database Security] getAllCases invoked without valid guildId — request rejected to prevent cross-tenant leak');
        return [];
    }
    const cleanGuildId = guildId.trim();
    const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 10000));
    return queryAll('SELECT * FROM cases WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', [cleanGuildId, lim]).map(enrichCase);
}

/**
 * Gets recent warnings for a specific guild
 * @param {string} guildId
 * @param {number} [limit=50]
 * @returns {Array<Object>}
 */
function getAllWarnings(guildId, limit = 50) {
    checkAndExpireWarnings();
    if (!guildId || typeof guildId !== 'string' || !guildId.trim()) {
        console.warn('[Database Security] getAllWarnings invoked without valid guildId — request rejected to prevent cross-tenant leak');
        return [];
    }
    const cleanGuildId = guildId.trim();
    const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 10000));
    return queryAll('SELECT * FROM warnings WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', [cleanGuildId, lim]);
}

/**
 * Gets aggregated moderation stats
 * @param {string|null} guildId
 * @returns {Object}
 */
function getStats(guildId = null) {
    checkAndExpireWarnings();
    const casesSql = guildId 
        ? 'SELECT COUNT(*) as total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active FROM cases WHERE guild_id = ?'
        : 'SELECT COUNT(*) as total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active FROM cases';
    const warningsSql = guildId 
        ? 'SELECT COUNT(*) as total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active FROM warnings WHERE guild_id = ?'
        : 'SELECT COUNT(*) as total, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active FROM warnings';
    
    const casesRow = queryOne(casesSql, guildId ? [guildId] : []) || { total: 0, active: 0 };
    const warnsRow = queryOne(warningsSql, guildId ? [guildId] : []) || { total: 0, active: 0 };

    return {
        totalCases: Number(casesRow.total || 0),
        activeCases: Number(casesRow.active || 0),
        totalWarnings: Number(warnsRow.total || 0),
        activeWarnings: Number(warnsRow.active || 0)
    };
}

/**
 * Gets list of database backups
 * @returns {Array<{ name: string, size: number, time: number }>}
 */
function getBackups() {
    try {
        if (!fs.existsSync(backupsDir)) return [];
        return fs.readdirSync(backupsDir)
            .filter(f => f.endsWith('.db'))
            .map(file => {
                const stat = fs.statSync(path.join(backupsDir, file));
                return {
                    name: file,
                    size: stat.size,
                    time: stat.mtimeMs
                };
            })
            .sort((a, b) => b.time - a.time);
    } catch {
        return [];
    }
}

/**
 * Gets analytics data for moderation actions over a given number of days
 * @param {string|null} guildId
 * @param {number} days
 * @returns {{ daily: Array<Object>, breakdown: Array<Object>, topMods: Array<Object>, days: number }}
 */
function getAnalytics(guildId = null, days = 30) {
    const params = [days];
    let guildFilter = '';
    if (guildId) {
        guildFilter = ' AND guild_id = ?';
        params.push(guildId);
    }

    const dailySql = `
        SELECT date(created_at) AS date, 
               CASE 
                   WHEN action = 'automod' OR reason LIKE 'Automod%' OR reason LIKE 'AutoMod%' THEN 'automod'
                   ELSE action 
               END AS action, 
               COUNT(*) AS count
        FROM cases
        WHERE created_at >= datetime('now', '-' || ? || ' days')
        ${guildFilter}
        GROUP BY date(created_at), 
                 CASE 
                     WHEN action = 'automod' OR reason LIKE 'Automod%' OR reason LIKE 'AutoMod%' THEN 'automod'
                     ELSE action 
                 END
        ORDER BY date ASC
    `;

    const breakdownSql = `
        SELECT CASE 
                   WHEN action = 'automod' OR reason LIKE 'Automod%' OR reason LIKE 'AutoMod%' THEN 'automod'
                   ELSE action 
               END AS action, 
               COUNT(*) AS count
        FROM cases
        WHERE created_at >= datetime('now', '-' || ? || ' days')
        ${guildFilter}
        GROUP BY CASE 
                     WHEN action = 'automod' OR reason LIKE 'Automod%' OR reason LIKE 'AutoMod%' THEN 'automod'
                     ELSE action 
                 END
        ORDER BY count DESC
    `;

    const topModsSql = `
        SELECT moderator_id, COUNT(*) AS count
        FROM cases
        WHERE created_at >= datetime('now', '-' || ? || ' days')
        ${guildFilter}
        GROUP BY moderator_id
        ORDER BY count DESC
        LIMIT 5
    `;

    const daily = queryAll(dailySql, params);
    const breakdown = queryAll(breakdownSql, params);
    const topMods = queryAll(topModsSql, params);

    return {
        daily,
        breakdown,
        topMods,
        days
    };
}

/**
 * Creates a new support ticket
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} userId
 * @returns {{ id: number, ticketNumber: number }}
 */
function createTicket(guildId, channelId, userId) {
    const row = queryOne('SELECT MAX(ticket_number) AS max_num FROM tickets WHERE guild_id = ?', [guildId]);
    const ticketNumber = (row && row.max_num) ? row.max_num + 1 : 1;
    const result = run(
        'INSERT INTO tickets (guild_id, channel_id, ticket_number, user_id, status) VALUES (?, ?, ?, ?, ?)',
        [guildId, channelId, ticketNumber, userId, 'open']
    );
    return { id: result.lastId, ticketNumber };
}

/**
 * Closes a support ticket and saves transcript
 * @param {string} channelId
 * @param {string} closedBy
 * @param {string} transcript
 * @returns {number}
 */
function closeTicket(channelId, closedBy, transcript = '') {
    const result = run(
        'UPDATE tickets SET status = ?, closed_by = ?, transcript = ?, closed_at = datetime(\'now\') WHERE channel_id = ?',
        ['closed', closedBy, transcript, channelId]
    );
    return result.changes;
}

/**
 * Gets a ticket by channel ID
 * @param {string} channelId
 * @returns {Object|null}
 */
function getTicketByChannel(channelId) {
    return queryOne('SELECT * FROM tickets WHERE channel_id = ?', [channelId]);
}

/**
 * Gets a ticket by primary ID, optionally scoped to a specific guild
 * @param {number} ticketId
 * @param {string|null} [guildId=null]
 * @returns {Object|null}
 */
function getTicketById(ticketId, guildId = null) {
    if (!ticketId) return null;
    const id = parseInt(ticketId, 10);
    if (isNaN(id)) return null;

    if (guildId && typeof guildId === 'string' && guildId.trim()) {
        return queryOne('SELECT * FROM tickets WHERE id = ? AND guild_id = ?', [id, guildId.trim()]);
    }
    return queryOne('SELECT * FROM tickets WHERE id = ?', [id]);
}

/**
 * Gets all tickets for a guild
 * @param {string} guildId
 * @param {number} [limit=50]
 * @returns {Array<Object>}
 */
function getAllTickets(guildId, limit = 50) {
    if (!guildId || typeof guildId !== 'string' || !guildId.trim()) return [];
    const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 10000));
    return queryAll('SELECT * FROM tickets WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', [guildId.trim(), lim]);
}

/**
 * Gets all tickets created by a specific user in a guild
 * @param {string} guildId
 * @param {string} userId
 * @returns {Array<Object>}
 */
function getUserTickets(guildId, userId) {
    if (!db) return [];
    try {
        return queryAll('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC', [guildId, userId]);
    } catch (e) {
        console.error('[Database] Failed to get user tickets:', e);
        return [];
    }
}

/**
 * Adds an alt account to quarantine
 * @param {string} guildId
 * @param {string} userId
 * @param {string} reason
 * @returns {number}
 */
function addQuarantineUser(guildId, userId, reason) {
    const result = run(
        'INSERT INTO quarantined_users (guild_id, user_id, reason) VALUES (?, ?, ?)',
        [guildId, userId, reason]
    );
    return result.lastId;
}

/**
 * Gets all quarantined users for a guild
 * @param {string} guildId
 * @returns {Array<Object>}
 */
function getQuarantinedUsers(guildId) {
    if (!guildId || typeof guildId !== 'string' || !guildId.trim()) return [];
    return queryAll('SELECT * FROM quarantined_users WHERE guild_id = ? AND active = 1 ORDER BY created_at DESC', [guildId.trim()]);
}

/**
 * Removes a user from quarantine
 * @param {string} guildId
 * @param {string} userId
 * @returns {number}
 */
function removeQuarantineUser(guildId, userId) {
    const result = run(
        'UPDATE quarantined_users SET active = 0 WHERE guild_id = ? AND user_id = ?',
        [guildId, userId]
    );
    return result.changes;
}

/**
 * Adds a voice activity log
 * @param {string} guildId
 * @param {string} userId
 * @param {string} action - 'join', 'leave', 'move', 'hop_warning'
 * @param {string} channelId
 * @returns {number}
 */
function addVoiceLog(guildId, userId, action, channelId) {
    const result = run(
        'INSERT INTO voice_logs (guild_id, user_id, action, channel_id) VALUES (?, ?, ?, ?)',
        [guildId, userId, action, channelId]
    );
    return result.lastId;
}

/**
 * Gets voice logs for a guild
 * @param {string} guildId
 * @param {number} [limit=50]
 * @returns {Array<Object>}
 */
function getVoiceLogs(guildId, limit = 50) {
    if (!guildId || typeof guildId !== 'string' || !guildId.trim()) return [];
    const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 10000));
    return queryAll('SELECT * FROM voice_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', [guildId.trim(), lim]);
}

/**
 * Gets active mute cases that have reached their expiration timestamp
 * @returns {Array<Object>}
 */
function getExpiredMutes() {
    if (!db) return [];
    try {
        const rows = queryAll(
            "SELECT * FROM cases WHERE action = 'mute' AND active = 1 AND expires_at IS NOT NULL"
        );
        const now = Date.now();
        return rows.filter(r => {
            if (!r.expires_at) return false;
            // Parse as date (handles ISO 8601 strings e.g. 2026-10-14T14:00:00.000Z or 2026-10-14 14:00:00)
            const iso = String(r.expires_at);
            const formattedIso = iso.includes('T') ? (iso.endsWith('Z') ? iso : iso + 'Z') : iso.replace(' ', 'T') + 'Z';
            const exp = new Date(formattedIso).getTime();
            if (!isNaN(exp)) return exp <= now;

            // Fallback for numeric epoch (seconds or ms)
            const num = Number(iso);
            if (!isNaN(num) && num > 0) {
                const msTime = num < 10000000000 ? num * 1000 : num;
                return msTime <= now;
            }
            return false;
        });
    } catch (e) {
        console.error('[Database] Error fetching expired mutes:', e);
        return [];
    }
}

/**
 * Marks an expired mute case as resolved
 * @param {number} caseNumber
 * @param {string} guildId
 * @returns {number}
 */
function resolveExpiredMute(caseNumber, guildId) {
    if (!db) return 0;
    try {
        const result = run(
            "UPDATE cases SET active = 0 WHERE (case_number = ? OR id = ?) AND guild_id = ?",
            [caseNumber, caseNumber, guildId]
        );
        return result.changes;
    } catch (e) {
        console.error('[Database] Error resolving expired mute:', e);
        return 0;
    }
}

/**
 * Deactivates all active mute cases for a user in a guild
 * @param {string} guildId
 * @param {string} userId
 * @returns {number}
 */
function deactivateUserMutes(guildId, userId) {
    if (!db || !guildId || !userId) return 0;
    try {
        const result = run(
            "UPDATE cases SET active = 0 WHERE guild_id = ? AND user_id = ? AND action = 'mute' AND active = 1",
            [guildId, userId]
        );
        return result.changes;
    } catch (e) {
        console.error('[Database] Error deactivating user mutes:', e);
        return 0;
    }
}

/**
 * Adds or updates a self-assignable role
 * @param {string} guildId
 * @param {string} roleId
 * @param {string} label
 * @param {string|null} [emoji=null]
 * @param {string|null} [description=null]
 * @returns {number}
 */
function addSelfRole(guildId, roleId, label, emoji = null, description = null) {
    const existing = queryOne('SELECT id FROM self_roles WHERE guild_id = ? AND role_id = ?', [guildId, roleId]);
    if (existing) {
        run('UPDATE self_roles SET label = ?, emoji = ?, description = ? WHERE id = ?', [label, emoji, description, existing.id]);
        return existing.id;
    }
    const result = run(
        'INSERT INTO self_roles (guild_id, role_id, label, emoji, description) VALUES (?, ?, ?, ?, ?)',
        [guildId, roleId, label, emoji, description]
    );
    return result.lastId;
}

/**
 * Removes a self-assignable role
 * @param {string} guildId
 * @param {string} roleIdOrId
 * @returns {number}
 */
function removeSelfRole(guildId, roleIdOrId) {
    const result = run('DELETE FROM self_roles WHERE guild_id = ? AND (role_id = ? OR id = ?)', [guildId, roleIdOrId, roleIdOrId]);
    return result.changes;
}

/**
 * Gets all self-assignable roles for a guild
 * @param {string} guildId
 * @returns {Array<Object>}
 */
function getSelfRoles(guildId) {
    return queryAll('SELECT * FROM self_roles WHERE guild_id = ? ORDER BY id ASC', [guildId]);
}

/**
 * Gets a self role by ID
 * @param {number} id
 * @returns {Object|null}
 */
function getSelfRoleById(id) {
    return queryOne('SELECT * FROM self_roles WHERE id = ?', [id]);
}

/**
 * Deletes a self role by ID
 * @param {number} id
 * @param {string|null} [guildId=null]
 * @returns {number}
 */
function deleteSelfRoleById(id, guildId = null) {
    if (!db || !id) return 0;
    const roleDbId = parseInt(id, 10);
    if (isNaN(roleDbId)) return 0;

    if (guildId && typeof guildId === 'string' && guildId.trim()) {
        const result = run('DELETE FROM self_roles WHERE id = ? AND guild_id = ?', [roleDbId, guildId.trim()]);
        return result.changes;
    }
    const result = run('DELETE FROM self_roles WHERE id = ?', [roleDbId]);
    return result.changes;
}

/**
 * Records daily message activity for a member (privacy-respecting, counts only)
 * @param {string} guildId
 * @param {string} userId
 * @param {string} [username=null]
 * @returns {number}
 */
function recordMemberActivity(guildId, userId, username = null) {
    if (!db || !guildId || !userId) return 0;
    try {
        const today = new Date().toISOString().split('T')[0];
        const existing = queryOne(
            'SELECT id, message_count FROM member_activity WHERE guild_id = ? AND user_id = ? AND date = ?',
            [guildId, userId, today]
        );
        if (existing) {
            run(
                'UPDATE member_activity SET message_count = message_count + 1, username = COALESCE(?, username), last_active = datetime(\'now\') WHERE id = ?',
                [username, existing.id]
            );
        } else {
            run(
                'INSERT INTO member_activity (guild_id, user_id, username, date, message_count, last_active) VALUES (?, ?, ?, ?, 1, datetime(\'now\'))',
                [guildId, userId, username, today]
            );
        }
        return 1;
    } catch (e) {
        console.error('[Database] Failed to record member activity:', e);
        return 0;
    }
}

/**
 * Gets top active members in a guild
 * @param {string} guildId
 * @param {number} [days=7]
 * @param {number} [limit=10]
 * @returns {Array<{ user_id: string, total_messages: number, message_count: number, username: string|null, last_active: string|null }>}
 */
function getTopMembers(guildId, days = 7, limit = 10) {
    if (!db) return [];
    try {
        const lim = Number(limit) || 10;
        const d = Number(days);
        if (d === 1) {
            return queryAll(`
                SELECT user_id,
                       MAX(username) AS username,
                       SUM(message_count) AS total_messages,
                       SUM(message_count) AS message_count,
                       MAX(last_active) AS last_active
                FROM member_activity
                WHERE guild_id = ? AND date >= date('now')
                GROUP BY user_id
                ORDER BY total_messages DESC
                LIMIT ?
            `, [guildId, lim]);
        } else if (d > 1) {
            return queryAll(`
                SELECT user_id,
                       MAX(username) AS username,
                       SUM(message_count) AS total_messages,
                       SUM(message_count) AS message_count,
                       MAX(last_active) AS last_active
                FROM member_activity
                WHERE guild_id = ? AND date >= date('now', '-' || ? || ' days')
                GROUP BY user_id
                ORDER BY total_messages DESC
                LIMIT ?
            `, [guildId, d, lim]);
        } else {
            return queryAll(`
                SELECT user_id,
                       MAX(username) AS username,
                       SUM(message_count) AS total_messages,
                       SUM(message_count) AS message_count,
                       MAX(last_active) AS last_active
                FROM member_activity
                WHERE guild_id = ?
                GROUP BY user_id
                ORDER BY total_messages DESC
                LIMIT ?
            `, [guildId, lim]);
        }
    } catch (e) {
        console.error('[Database] Failed to get top members:', e);
        return [];
    }
}

/**
 * Gets activity statistics for a specific member
 * @param {string} guildId
 * @param {string} userId
 * @returns {{ today: number, week: number, total: number, total_messages: number }}
 */
function getMemberActivityStats(guildId, userId) {
    if (!db) return { today: 0, week: 0, total: 0, total_messages: 0 };
    try {
        const today = new Date().toISOString().split('T')[0];
        const rowToday = queryOne(
            'SELECT message_count FROM member_activity WHERE guild_id = ? AND user_id = ? AND date = ?',
            [guildId, userId, today]
        );
        const rowWeek = queryOne(`
            SELECT SUM(message_count) AS cnt FROM member_activity
            WHERE guild_id = ? AND user_id = ? AND date >= date('now', '-7 days')
        `, [guildId, userId]);
        const rowTotal = queryOne(`
            SELECT SUM(message_count) AS cnt FROM member_activity
            WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        const totalCnt = Number(rowTotal?.cnt || 0);
        return {
            today: Number(rowToday?.message_count || 0),
            week: Number(rowWeek?.cnt || 0),
            total: totalCnt,
            total_messages: totalCnt
        };
    } catch (e) {
        return { today: 0, week: 0, total: 0, total_messages: 0 };
    }
}

/**
 * Saves an embed template
 * @param {string} guildId
 * @param {string} name
 * @param {Object|string} data
 * @returns {number|null}
 */
function saveEmbedTemplate(guildId, name, data) {
    if (!db) return null;
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
    const res = run('INSERT INTO embed_templates (guild_id, name, data) VALUES (?, ?, ?)', [guildId, name, jsonStr]);
    return res.lastId;
}

/**
 * Retrieves all saved embed templates for a guild
 * @param {string} [guildId]
 * @returns {Array<Object>}
 */
function getEmbedTemplates(guildId) {
    if (!db) return [];
    const sql = guildId 
        ? 'SELECT * FROM embed_templates WHERE guild_id = ? ORDER BY id DESC' 
        : 'SELECT * FROM embed_templates ORDER BY id DESC';
    const rows = queryAll(sql, guildId ? [guildId] : []);
    return rows.map(r => {
        try {
            return { ...r, data: JSON.parse(r.data) };
        } catch {
            return r;
        }
    });
}

/**
 * Deletes an embed template by id
 * @param {number} id
 * @param {string|null} [guildId=null]
 * @returns {boolean}
 */
function deleteEmbedTemplate(id, guildId = null) {
    if (!db || !id) return false;
    const templateId = parseInt(id, 10);
    if (isNaN(templateId)) return false;

    if (guildId && typeof guildId === 'string' && guildId.trim()) {
        const res = run('DELETE FROM embed_templates WHERE id = ? AND guild_id = ?', [templateId, guildId.trim()]);
        return res.changes > 0;
    }
    const res = run('DELETE FROM embed_templates WHERE id = ?', [templateId]);
    return res.changes > 0;
}

module.exports = {
    initDatabase,
    saveDatabase: save,
    backupDatabase,
    checkAndExpireWarnings,
    get db() {
        return {
            prepare(sql) {
                return {
                    run(...params) {
                        const result = run(sql, params);
                        return { changes: result.changes };
                    },
                    get(...params) {
                        return queryOne(sql, params);
                    },
                    all(...params) {
                        return queryAll(sql, params);
                    }
                };
            },
            run(sql, params) { return run(sql, params); }
        };
    },
    getConfig,
    setConfig,
    updateConfig,
    getNextCaseNumber,
    addCase,
    getCases,
    getCaseByNumber,
    getAllCases,
    addWarning,
    getWarnings,
    getActiveWarnings,
    getAllWarnings,
    deactivateWarning,
    deactivateCase,
    getStats,
    getBackups,
    getAnalytics,
    createTicket,
    closeTicket,
    getTicketByChannel,
    getTicketById,
    getAllTickets,
    getUserTickets,
    addQuarantineUser,
    getQuarantinedUsers,
    removeQuarantineUser,
    addVoiceLog,
    getVoiceLogs,
    getExpiredMutes,
    resolveExpiredMute,
    deactivateUserMutes,
    addSelfRole,
    removeSelfRole,
    getSelfRoles,
    getSelfRoleById,
    deleteSelfRoleById,
    recordMemberActivity,
    getTopMembers,
    getMemberActivityStats,
    saveEmbedTemplate,
    getEmbedTemplates,
    deleteEmbedTemplate
};
