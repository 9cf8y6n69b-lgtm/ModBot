/**
 * @file tools/test.js
 * @description Fast, self-contained smoke & integrity test suite for ModBot.
 * Can be safely run in CI/CD and by public GitHub contributors without requiring API keys.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

console.log('--- Starting ModBot Integrity & Verification Test Suite ---');

// 1. Syntax Validation across all JavaScript files
console.log('[Test 1] Verifying JavaScript syntax across src/ and tools/...');
function getJsFiles(dir) {
    let results = [];
    fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') {
                results = results.concat(getJsFiles(fullPath));
            }
        } else if (file.endsWith('.js')) {
            results.push(fullPath);
        }
    });
    return results;
}

const jsFiles = [...getJsFiles('./src'), ...getJsFiles('./tools')];
jsFiles.forEach(file => {
    try {
        execFileSync(process.execPath, ['-c', file]);
    } catch (err) {
        console.error(`Syntax error in ${file}:`, err.message);
        process.exit(1);
    }
});
console.log(`✓ All ${jsFiles.length} JavaScript files passed syntax verification.`);

// 2. Validate JSON configurations
console.log('[Test 2] Validating JSON configuration files...');
const configPath = path.resolve('config.json');
const emojisPath = path.resolve('emojis.json');

assert(fs.existsSync(configPath), 'config.json must exist');
assert(fs.existsSync(emojisPath), 'emojis.json must exist');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const emojis = JSON.parse(fs.readFileSync(emojisPath, 'utf8'));

assert(typeof config === 'object', 'config.json must be a valid JSON object');
assert(typeof emojis === 'object', 'emojis.json must be a valid JSON object');
assert(Object.keys(emojis).length >= 70, `emojis.json must have at least 70 custom emojis (found ${Object.keys(emojis).length})`);
console.log(`✓ Configuration and emojis.json verified (${Object.keys(emojis).length} custom emoji mappings active).`);

// 3. Test In-Memory Database Initialization
console.log('[Test 3] Testing SQLite (sql.js WASM) initialization & schema migrations...');
(async () => {
    try {
        process.env.NODE_ENV = 'test';
        const { initDatabase, db, getStats } = require('../src/database/connect');
        await initDatabase();
        assert(db !== null, 'Database instance should be initialized');

        // Verify key tables exist
        const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const tables = rows.map(r => r.name);
        const requiredTables = ['guild_config', 'cases', 'warnings', 'tickets', 'quarantined_users', 'voice_logs', 'self_roles', 'member_activity', 'embed_templates'];
        requiredTables.forEach(t => {
            assert(tables.includes(t), `Table ${t} must exist in database schema`);
        });
        console.log(`✓ Database schema verified with tables: ${requiredTables.join(', ')}.`);

        // 4. Test Emoji Dynamic Resolution
        console.log('[Test 4] Testing dynamic emoji manager proxy...');
        const emojisUtil = require('../src/utils/emojis');
        assert(typeof emojisUtil.getEmoji === 'function', 'getEmoji must be a function');
        assert(typeof emojisUtil.shield === 'string' && emojisUtil.shield.startsWith('<:'), 'emojis.shield must resolve custom emoji syntax');
        assert(typeof emojisUtil.ban === 'string' && emojisUtil.ban.startsWith('<:'), 'emojis.ban must resolve custom emoji syntax');
        console.log('✓ Dynamic emoji Proxy resolution verified.');

        console.log('\n=========================================');
        console.log('🎉 ALL INTEGRITY & VERIFICATION TESTS PASSED!');
        console.log('=========================================\n');
        process.exit(0);
    } catch (err) {
        console.error('Test failure:', err);
        process.exit(1);
    }
})();
