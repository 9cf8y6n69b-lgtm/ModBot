/**
 * Centralized Dynamic Custom Emoji & Icon Manager for ModBot
 * Strict Requirement: ZERO standard Unicode emojis across all Discord messages, embeds, and components.
 * 
 * Emojis are dynamically loaded from `emojis.json` (synced as Application Emojis via Developer Portal).
 * Optional overrides can be provided in `config.json` under `emojis`.
 * No hardcoded emoji IDs exist in this file.
 */

const fs = require('fs');
const path = require('path');

const EMOJIS_FILE = path.resolve(__dirname, '../../emojis.json');
const CONFIG_FILE = path.resolve(__dirname, '../../config.json');

let emojiStore = {};

/**
 * Loads emojis from emojis.json and optional config.json overrides
 */
function loadEmojis() {
    let registry = {};

    // 1. Load from emojis.json (Application emojis synced from Developer Portal)
    try {
        if (fs.existsSync(EMOJIS_FILE)) {
            const raw = fs.readFileSync(EMOJIS_FILE, 'utf8');
            registry = JSON.parse(raw);
        }
    } catch (err) {
        console.error('[Emojis] Error reading emojis.json:', err.message);
    }

    // 2. Load optional overrides from config.json
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (config && config.emojis && typeof config.emojis === 'object') {
                Object.assign(registry, config.emojis);
            }
        }
    } catch (err) {
        // config.json may not have emojis, ignore
    }

    emojiStore = registry;
    return emojiStore;
}

// Initial load
loadEmojis();

/**
 * Returns the custom emoji string formatted as `<:name:id>`
 * @param {string} key - Name of the emoji
 * @returns {string} Custom emoji string
 */
function getEmoji(key) {
    if (!key) return emojiStore.info || '';
    return emojiStore[key] || emojiStore.info || '';
}

/**
 * Converts a custom emoji string or key into a Discord component emoji object
 * { id: string, name: string, animated?: boolean }
 * @param {string} keyOrString - Emoji key or custom emoji string
 * @returns {Object|string}
 */
function toComponentEmoji(keyOrString) {
    const raw = (typeof keyOrString === 'string' && emojiStore[keyOrString]) ? emojiStore[keyOrString] : keyOrString;
    if (typeof raw !== 'string') return raw;

    const match = raw.match(/<(?<animated>a)?:(?<name>[a-zA-Z0-9_]+):(?<id>[0-9]+)>/);
    if (match && match.groups) {
        return {
            id: match.groups.id,
            name: match.groups.name,
            animated: Boolean(match.groups.animated)
        };
    }
    return raw;
}

/**
 * Formats a custom emoji with a specific name and ID
 * @param {string} name 
 * @param {string} id 
 * @param {boolean} [animated=false] 
 * @returns {string}
 */
function customEmoji(name, id, animated = false) {
    return `<${animated ? 'a' : ''}:${name}:${id}>`;
}

/**
 * Hot-reloads emojis from disk without restarting the process
 */
function reloadEmojis() {
    return loadEmojis();
}

const baseExport = {
    getEmoji,
    toComponentEmoji,
    customEmoji,
    reloadEmojis
};

// Create a Proxy so properties can be accessed directly: emojis.shield, emojis.ban, etc.
// Also preserves `emojis.emojis` for backwards compatibility with `const { emojis } = require('./emojis')`
const proxyExport = new Proxy(baseExport, {
    get(target, prop, receiver) {
        if (prop in target) {
            return target[prop];
        }
        if (prop === 'emojis') {
            return receiver;
        }
        if (typeof prop === 'string') {
            return emojiStore[prop] || emojiStore.info || '';
        }
        return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
        return (prop in target) || (prop in emojiStore) || prop === 'emojis';
    },
    ownKeys(target) {
        return Array.from(new Set([...Reflect.ownKeys(target), ...Object.keys(emojiStore), 'emojis']));
    },
    getOwnPropertyDescriptor(target, prop) {
        if (prop in target) {
            return Reflect.getOwnPropertyDescriptor(target, prop);
        }
        if (prop in emojiStore || prop === 'emojis') {
            return {
                value: this.get(target, prop, target),
                writable: false,
                enumerable: true,
                configurable: true
            };
        }
        return undefined;
    }
});

module.exports = proxyExport;
