/**
 * @file src/utils/appEmojiSync.js
 * @description Automatically verifies and uploads high-resolution filled custom emojis
 * to the Discord Application Developer Portal whenever the bot token / application changes
 * or when emojis are missing from the current application.
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const emojisUtil = require('./emojis');

const EMOJIS_PATH = path.resolve(__dirname, '../../emojis.json');

// Master Dictionary of 72 Bespoke Filled Icons (No Background Box, 24x24 Vector Space)
const FILLED_ICONS = {
    // Moderation & Safety
    shield: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M12 2L4 5V11C4 16.5 7.5 21.2 12 22C16.5 21.2 20 16.5 20 11V5L12 2Z" fill="#5865F2"/>
  <path d="M12 2V22C16.5 21.2 20 16.5 20 11V5L12 2Z" fill="#4752C4" fill-opacity="0.35"/>
  <path d="M9 11.5L11 13.5L15 9.5" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    ban: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#ED4245"/>
  <path d="M12 2A10 10 0 0 1 22 12A10 10 0 0 1 12 22" fill="#C0392B" fill-opacity="0.3"/>
  <circle cx="12" cy="12" r="6.5" stroke="#FFFFFF" stroke-width="2.4" fill="none"/>
  <path d="M7.4 7.4L16.6 16.6" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/>
</svg>`,

    kick: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#FFAA00"/>
  <path d="M12 2A10 10 0 0 1 22 12A10 10 0 0 1 12 22" fill="#D68910" fill-opacity="0.3"/>
  <circle cx="10" cy="8.5" r="3" fill="#FFFFFF"/>
  <path d="M4 17.5C4 14.5 7 13 10 13C13 13 16 14.5 16 17.5" fill="#FFFFFF"/>
  <path d="M16 9L20 9" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/>
</svg>`,

    mute: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M11 5L6 9H3V15H6L11 19V5Z" fill="#FEE75C"/>
  <path d="M11 5V19L11 5Z" fill="#F39C12" fill-opacity="0.3"/>
  <path d="M15 9.5L20.5 15M20.5 9.5L15 15" stroke="#ED4245" stroke-width="2.4" stroke-linecap="round"/>
</svg>`,

    unmute: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M11 5L6 9H3V15H6L11 19V5Z" fill="#57F287"/>
  <path d="M14.5 8.5C15.8 9.8 15.8 14.2 14.5 15.5M17.5 6C19.8 8.3 19.8 15.7 17.5 18" stroke="#57F287" stroke-width="2.2" stroke-linecap="round"/>
</svg>`,

    unban: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#57F287"/>
  <path d="M12 2A10 10 0 0 1 22 12A10 10 0 0 1 12 22" fill="#2ECC71" fill-opacity="0.3"/>
  <circle cx="10" cy="8.5" r="3" fill="#FFFFFF"/>
  <path d="M4 17.5C4 14.5 7 13 10 13C13 13 16 14.5 16 17.5" fill="#FFFFFF"/>
  <path d="M15 9.5L17 11.5L20.5 8" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    warn: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M12 2.5L22 20H2L12 2.5Z" fill="#FEE75C"/>
  <path d="M12 2.5V20H22L12 2.5Z" fill="#F39C12" fill-opacity="0.3"/>
  <path d="M12 8.5V13.5M12 16.8V17" stroke="#2B2D31" stroke-width="2.5" stroke-linecap="round"/>
</svg>`,

    case: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M3 5C3 3.9 3.9 3 5 3H9L11 5H19C20.1 5 21 5.9 21 7V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5Z" fill="#5865F2"/>
  <path d="M3 8H21V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V8Z" fill="#7289DA" fill-opacity="0.35"/>
  <rect x="7" y="11" width="10" height="2" rx="1" fill="#FFFFFF"/>
  <rect x="7" y="15" width="6" height="2" rx="1" fill="#FFFFFF"/>
</svg>`,

    transcript: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#5865F2"/>
  <path d="M14 2V8H20" fill="#7289DA"/>
  <rect x="7" y="11" width="10" height="2" rx="1" fill="#FFFFFF"/>
  <rect x="7" y="15" width="10" height="2" rx="1" fill="#FFFFFF"/>
  <rect x="7" y="19" width="6" height="2" rx="1" fill="#FFFFFF"/>
</svg>`,

    lock: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M8 9V6C8 3.79 9.79 2 12 2C14.21 2 16 3.79 16 6V9" stroke="#FF7675" stroke-width="2.6" stroke-linecap="round" fill="none"/>
  <rect x="4" y="9" width="16" height="12" rx="3.5" fill="#ED4245"/>
  <path d="M12 9H20V21H12V9Z" fill="#C0392B" fill-opacity="0.3"/>
  <circle cx="12" cy="14" r="1.4" fill="#FFFFFF"/>
  <path d="M11.3 14.8L12.7 14.8L12.4 17.5L11.6 17.5Z" fill="#FFFFFF"/>
</svg>`,

    unlock: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M8 9V6C8 3.79 9.79 2 12 2C14.21 2 16 3.79 16 6V7.5" stroke="#A8E6CF" stroke-width="2.6" stroke-linecap="round" fill="none"/>
  <rect x="4" y="9" width="16" height="12" rx="3.5" fill="#57F287"/>
  <path d="M12 9H20V21H12V9Z" fill="#2ECC71" fill-opacity="0.3"/>
  <circle cx="12" cy="14" r="1.4" fill="#FFFFFF"/>
  <path d="M11.3 14.8L12.7 14.8L12.4 17.5L11.6 17.5Z" fill="#FFFFFF"/>
</svg>`,

    slowmode: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="13" r="8.5" fill="#FFAA00"/>
  <path d="M12 4.5A8.5 8.5 0 0 1 20.5 13A8.5 8.5 0 0 1 12 21.5" fill="#D68910" fill-opacity="0.3"/>
  <rect x="10" y="2" width="4" height="2" rx="1" fill="#FFAA00"/>
  <path d="M12 8.5V13L15.5 15" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    clock: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9.5" fill="#5865F2"/>
  <path d="M12 2.5A9.5 9.5 0 0 1 21.5 12A9.5 9.5 0 0 1 12 21.5" fill="#4752C4" fill-opacity="0.3"/>
  <path d="M12 7V12L15.5 14" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    purge: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M6 6L7.5 20C7.6 20.6 8 21 8.5 21H15.5C16 21 16.4 20.6 16.5 20L18 6H6Z" fill="#ED4245"/>
  <path d="M12 6V21H15.5C16 21 16.4 20.6 16.5 20L18 6H12Z" fill="#C0392B" fill-opacity="0.3"/>
  <rect x="9.5" y="9" width="1.5" height="8" rx="0.75" fill="#FFFFFF"/>
  <rect x="13" y="9" width="1.5" height="8" rx="0.75" fill="#FFFFFF"/>
  <rect x="4" y="5" width="16" height="2.5" rx="1" fill="#FF7675"/>
  <rect x="9.5" y="3" width="5" height="2" rx="1" fill="#FF7675"/>
</svg>`,

    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M6 6L7.5 20C7.6 20.6 8 21 8.5 21H15.5C16 21 16.4 20.6 16.5 20L18 6H6Z" fill="#ED4245"/>
  <path d="M12 6V21H15.5C16 21 16.4 20.6 16.5 20L18 6H12Z" fill="#C0392B" fill-opacity="0.3"/>
  <rect x="4" y="5" width="16" height="2.5" rx="1" fill="#FF7675"/>
  <rect x="9.5" y="3" width="5" height="2" rx="1" fill="#FF7675"/>
</svg>`,

    hammer: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M14 4L20 10L17.5 12.5L11.5 6.5L14 4Z" fill="#ED4245"/>
  <path d="M17 7L20 10L17.5 12.5L14.5 9.5L17 7Z" fill="#C0392B" fill-opacity="0.3"/>
  <path d="M13 8L5 16C4.4 16.6 4.4 17.6 5 18.2L5.8 19C6.4 19.6 7.4 19.6 8 19L16 11" stroke="#FFAA00" stroke-width="2.6" stroke-linecap="round"/>
</svg>`,

    sword: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M7 17L19 5L20 4L16 8L6 18H5V19L4 20L5 21L6 20V19H7V18Z" fill="#00D2FF"/>
  <path d="M7 17L19 5L20 4L18 6L7 17Z" fill="#74B9FF"/>
  <path d="M5 16L8 19" stroke="#FEE75C" stroke-width="3" stroke-linecap="round"/>
</svg>`,

    mask: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M3 10C3 7.8 4.8 6 7 6C8.8 6 10.3 7.2 10.8 8.9C11.1 8.7 11.5 8.5 12 8.5C12.5 8.5 12.9 8.7 13.2 8.9C13.7 7.2 15.2 6 17 6C19.2 6 21 7.8 21 10C21 12.2 19.2 14 17 14C15.1 14 13.5 12.7 13.1 10.9C12.8 11 12.4 11 12 11C11.6 11 11.2 11 10.9 10.9C10.5 12.7 8.9 14 7 14C4.8 14 3 12.2 3 10Z" fill="#747F8D"/>
  <circle cx="7" cy="10" r="2.2" fill="#FFFFFF"/>
  <circle cx="17" cy="10" r="2.2" fill="#FFFFFF"/>
</svg>`,

    zap: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M13 2L3.5 13.5H12L11 22L20.5 10.5H12L13 2Z" fill="#FEE75C"/>
  <path d="M12 2V10.5H20.5L11 22L12 13.5H3.5L13 2Z" fill="#F39C12" fill-opacity="0.3"/>
</svg>`,

    alert: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M7.8 2H16.2L22 7.8V16.2L16.2 22H7.8L2 16.2V7.8L7.8 2Z" fill="#FF6F00"/>
  <path d="M12 2H16.2L22 7.8V16.2L16.2 22H12V2Z" fill="#E65100" fill-opacity="0.3"/>
  <path d="M12 7V13M12 16.5V17" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>
</svg>`,

    raid: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M7.8 2H16.2L22 7.8V16.2L16.2 22H7.8L2 16.2V7.8L7.8 2Z" fill="#ED4245"/>
  <path d="M12 2H16.2L22 7.8V16.2L16.2 22H12V2Z" fill="#C0392B" fill-opacity="0.3"/>
  <path d="M12 7V13M12 16.5V17" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>
</svg>`,

    spam: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M3 11C3 6.03 7.03 2 12 2C16.97 2 21 6.03 21 11C21 15.97 16.97 20 12 20C10.3 20 8.7 19.5 7.4 18.7L3 20L4.3 15.8C3.5 14.4 3 12.8 3 11Z" fill="#ED4245"/>
  <path d="M12 2C16.97 2 21 6.03 21 11C21 15.97 16.97 20 12 20V2Z" fill="#C0392B" fill-opacity="0.3"/>
  <path d="M9.5 8.5L14.5 13.5M9.5 13.5L14.5 8.5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
</svg>`,

    // Status & System
    success: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#57F287"/>
  <path d="M12 2A10 10 0 0 1 22 12A10 10 0 0 1 12 22" fill="#2ECC71" fill-opacity="0.3"/>
  <path d="M7.5 12L10.5 15L16.5 9" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    error: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#ED4245"/>
  <path d="M12 2A10 10 0 0 1 22 12A10 10 0 0 1 12 22" fill="#C0392B" fill-opacity="0.3"/>
  <path d="M8.5 8.5L15.5 15.5M8.5 15.5L15.5 8.5" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"/>
</svg>`,

    info: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#00D2FF"/>
  <path d="M12 2A10 10 0 0 1 22 12A10 10 0 0 1 12 22" fill="#0984E3" fill-opacity="0.3"/>
  <path d="M12 11V16" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="12" cy="7.5" r="1.3" fill="#FFFFFF"/>
</svg>`,

    help: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#00D2FF"/>
  <path d="M12 2A10 10 0 0 1 22 12A10 10 0 0 1 12 22" fill="#0984E3" fill-opacity="0.3"/>
  <path d="M9.5 9C9.5 7.6 10.6 6.5 12 6.5C13.4 6.5 14.5 7.6 14.5 9C14.5 10.5 12 11.5 12 13" stroke="#FFFFFF" stroke-width="2.3" stroke-linecap="round"/>
  <circle cx="12" cy="16.5" r="1.3" fill="#FFFFFF"/>
</svg>`,

    settings: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M9.8 2.2C10.2 2 10.8 2 11.4 2H12.6C13.2 2 13.8 2 14.2 2.2C14.6 2.4 14.9 2.8 15.1 3.2L15.6 4.3C16 4.5 16.4 4.7 16.8 5L17.9 4.6C18.4 4.4 19 4.5 19.4 4.8C19.8 5.1 20.2 5.5 20.4 6C20.6 6.5 20.6 7.1 20.3 7.6L19.7 8.6C19.9 9 20 9.4 20.1 9.8L21.3 10.1C21.8 10.2 22.2 10.5 22.5 10.9C22.8 11.3 22.9 11.8 22.9 12.4C22.9 13 22.8 13.5 22.5 13.9C22.2 14.3 21.8 14.6 21.3 14.7L20.1 15C20 15.4 19.9 15.8 19.7 16.2L20.3 17.2C20.6 17.7 20.6 18.3 20.4 18.8C20.2 19.3 19.8 19.7 19.4 20C19 20.3 18.4 20.4 17.9 20.2L16.8 19.8C16.4 20.1 16 20.3 15.6 20.5L15.1 21.6C14.9 22 14.6 22.4 14.2 22.6C13.8 22.8 13.2 22.8 12.6 22.8H11.4C10.8 22.8 10.2 22.8 9.8 22.6C9.4 22.4 9.1 22 8.9 21.6L8.4 20.5C8 20.3 7.6 20.1 7.2 19.8L6.1 20.2C5.6 20.4 5 20.3 4.6 20C4.2 19.7 3.8 19.3 3.6 18.8C3.4 18.3 3.4 17.7 3.7 17.2L4.3 16.2C4.1 15.8 4 15.4 3.9 15L2.7 14.7C2.2 14.6 1.8 14.3 1.5 13.9C1.2 13.5 1.1 13 1.1 12.4C1.1 11.8 1.2 11.3 1.5 10.9C1.8 10.5 2.2 10.2 2.7 10.1L3.9 9.8C4 9.4 4.1 9 4.3 8.6L3.7 7.6C3.4 7.1 3.4 6.5 3.6 6C3.8 5.5 4.2 5.1 4.6 4.8C5 4.5 5.6 4.4 6.1 4.6L7.2 5C7.6 4.7 8 4.5 8.4 4.3L8.9 3.2C9.1 2.8 9.4 2.4 9.8 2.2ZM12 16.5C14.4853 16.5 16.5 14.4853 16.5 12C16.5 9.51472 14.4853 7.5 12 7.5C9.51472 7.5 7.5 9.51472 7.5 12C7.5 14.4853 9.51472 16.5 12 16.5Z" fill="#5865F2"/>
</svg>`,

    ping: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="3.5" fill="#57F287"/>
  <path d="M12 5C15.866 5 19 8.134 19 12M12 2C17.523 2 22 6.477 22 12" stroke="#57F287" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M12 5C8.134 5 5 8.134 5 12M12 2C6.477 2 2 6.477 2 12" stroke="#57F287" stroke-width="2.4" stroke-linecap="round"/>
</svg>`,

    refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M20 12A8 8 0 0 1 7.3 18.2L4 15M4 15V21M4 15H10" stroke="#5865F2" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4 12A8 8 0 0 1 16.7 5.8L20 9M20 9V3M20 9H14" stroke="#7289DA" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    switch_icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="2" y="6" width="20" height="12" rx="6" fill="#5865F2"/>
  <circle cx="16" cy="12" r="4.5" fill="#FFFFFF"/>
</svg>`,

    apps: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="8" height="8" rx="2" fill="#5865F2"/>
  <rect x="13" y="3" width="8" height="8" rx="2" fill="#7289DA"/>
  <rect x="3" y="13" width="8" height="8" rx="2" fill="#7289DA"/>
  <rect x="13" y="13" width="8" height="8" rx="2" fill="#5865F2"/>
</svg>`,

    home: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M3 10.5L12 3L21 10.5V20C21 20.6 20.6 21 20 21H4C3.4 21 3 20.6 3 20V10.5Z" fill="#5865F2"/>
  <path d="M12 3L21 10.5V21H12V3Z" fill="#4752C4" fill-opacity="0.3"/>
  <path d="M9 21V13H15V21" fill="#FFFFFF"/>
</svg>`,

    // Nitro, Boost & Community Rewards
    boost: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M12 2C12 2 7 6 7 13C7 15.5 8.5 17.5 10 18V21L12 20L14 21V18C15.5 17.5 17 15.5 17 13C17 6 12 2 12 2Z" fill="#EB459E"/>
  <path d="M7 13L4 16V18L7 17V13Z" fill="#FDA7DF"/>
  <path d="M17 13L20 16V18L17 17V13Z" fill="#C2185B"/>
  <path d="M12 2V20L14 21V18C15.5 17.5 17 15.5 17 13C17 6 12 2 12 2Z" fill="#C2185B" fill-opacity="0.25"/>
  <circle cx="12" cy="10" r="2.2" fill="#FFFFFF"/>
  <path d="M10.5 21L12 23.5L13.5 21Z" fill="#FEE75C"/>
</svg>`,

    diamond: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M6 3H18L22 9L12 22L2 9L6 3Z" fill="#00D2FF"/>
  <path d="M6 3H18L15.5 9H8.5L6 3Z" fill="#74B9FF"/>
  <path d="M8.5 9H15.5L12 22L8.5 9Z" fill="#0984E3"/>
  <path d="M15.5 9L22 9L12 22L15.5 9Z" fill="#00A8FF" fill-opacity="0.4"/>
</svg>`,

    heart: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M12 21.35L10.55 20.03C5.4 15.36 2 12.28 2 8.5C2 5.42 4.42 3 7.5 3C9.24 3 10.91 3.81 12 5.09C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.42 22 8.5C22 12.28 18.6 15.36 13.45 20.04L12 21.35Z" fill="#EB459E"/>
  <path d="M12 5.09V21.35L13.45 20.04C18.6 15.36 22 12.28 22 8.5C22 5.42 19.58 3 16.5 3C14.76 3 13.09 3.81 12 5.09Z" fill="#D63031" fill-opacity="0.2"/>
</svg>`,

    sparkles: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z" fill="#FEE75C"/>
  <path d="M19 16L19.8 18.2L22 19L19.8 19.8L19 22L18.2 19.8L16 19L18.2 18.2L19 16Z" fill="#FFAA00"/>
  <circle cx="6" cy="5" r="1.5" fill="#FEE75C"/>
</svg>`,

    gift: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="4" y="9" width="16" height="12" rx="2" fill="#9B59B6"/>
  <path d="M12 9H20V21H12V9Z" fill="#8E44AD" fill-opacity="0.3"/>
  <rect x="3" y="6" width="18" height="3.5" rx="1.5" fill="#D980FA"/>
  <rect x="10.5" y="6" width="3" height="15" fill="#FEE75C"/>
  <path d="M8.5 3.5C7.5 3.5 6.5 4.3 6.5 5.5C6.5 6.5 8 6.5 10.5 6.5C10.5 5 9.5 3.5 8.5 3.5Z" fill="#FEE75C"/>
  <path d="M15.5 3.5C16.5 3.5 17.5 4.3 17.5 5.5C17.5 6.5 16 6.5 13.5 6.5C13.5 5 14.5 3.5 15.5 3.5Z" fill="#FEE75C"/>
</svg>`,

    party: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M3 21L7 11L13 17L3 21Z" fill="#EB459E"/>
  <path d="M5 16L9.5 13.5L10.5 14.5L7 18L5 16Z" fill="#FEE75C"/>
  <circle cx="16" cy="6" r="2" fill="#57F287"/>
  <circle cx="20" cy="11" r="1.5" fill="#00D2FF"/>
  <circle cx="12" cy="7" r="1.5" fill="#FFAA00"/>
  <circle cx="17" cy="15" r="1.5" fill="#EB459E"/>
  <path d="M15 11L18 9M18 13L21 15M13 3L14 5" stroke="#FEE75C" stroke-width="2" stroke-linecap="round"/>
</svg>`,

    trophy: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M6 3H18V10C18 13.3 15.3 16 12 16C8.7 16 6 13.3 6 10V3Z" fill="#F1C40F"/>
  <path d="M12 3H18V10C18 13.3 15.3 16 12 16V3Z" fill="#D68910" fill-opacity="0.25"/>
  <path d="M6 5H4C2.9 5 2 5.9 2 7C2 9.2 3.8 11 6 11V9C4.9 9 4 8.1 4 7H6V5Z" fill="#F39C12"/>
  <path d="M18 5H20C21.1 5 22 5.9 22 7C22 9.2 20.2 11 18 11V9C19.1 9 20 8.1 20 7H18V5Z" fill="#D68910"/>
  <rect x="11" y="16" width="2" height="3" fill="#F39C12"/>
  <rect x="7" y="19" width="10" height="3" rx="1.5" fill="#B7950B"/>
</svg>`,

    star: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M12 2L14.9 8.5L22 9.3L16.8 14.1L18.2 21.1L12 17.5L5.8 21.1L7.2 14.1L2 9.3L9.1 8.5L12 2Z" fill="#FEE75C"/>
  <path d="M12 2V17.5L18.2 21.1L16.8 14.1L22 9.3L14.9 8.5L12 2Z" fill="#F39C12" fill-opacity="0.25"/>
</svg>`,

    badge: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M12 2L4 5V11C4 16.5 7.5 21.2 12 22C16.5 21.2 20 16.5 20 11V5L12 2Z" fill="#57F287"/>
  <path d="M12 2V22C16.5 21.2 20 16.5 20 11V5L12 2Z" fill="#2ECC71" fill-opacity="0.3"/>
  <path d="M8.5 11.5L11 14L15.5 9" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    verify: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M12 2L4 5V11C4 16.5 7.5 21.2 12 22C16.5 21.2 20 16.5 20 11V5L12 2Z" fill="#57F287"/>
  <path d="M12 2V22C16.5 21.2 20 16.5 20 11V5L12 2Z" fill="#2ECC71" fill-opacity="0.3"/>
  <path d="M8.5 11.5L11 14L15.5 9" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    // Identity, Roles & Verification
    user: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="7" r="4.5" fill="#5865F2"/>
  <path d="M4 21C4 16.5 7.5 14 12 14C16.5 14 20 16.5 20 21" fill="#5865F2"/>
  <path d="M12 14C16.5 14 20 16.5 20 21H12V14Z" fill="#4752C4" fill-opacity="0.3"/>
  <path d="M12 2.5A4.5 4.5 0 0 1 16.5 7A4.5 4.5 0 0 1 12 11.5" fill="#4752C4" fill-opacity="0.3"/>
</svg>`,

    users: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="16" cy="7" r="3.5" fill="#7289DA"/>
  <path d="M11 19C11 15.5 13.5 13.5 17 13.5C20.5 13.5 23 15.5 23 19" fill="#7289DA"/>
  <circle cx="8" cy="8.5" r="4" fill="#5865F2"/>
  <path d="M1 21C1 17 4 15 8 15C12 15 15 17 15 21" fill="#5865F2"/>
</svg>`,

    mod: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M3 18L4.5 7L9 11L12 4L15 11L19.5 7L21 18H3Z" fill="#F1C40F"/>
  <path d="M12 4L15 11L19.5 7L21 18H12V4Z" fill="#D68910" fill-opacity="0.25"/>
  <rect x="3" y="18" width="18" height="3" rx="1.5" fill="#D68910"/>
  <circle cx="12" cy="14" r="1.5" fill="#FFFFFF"/>
</svg>`,

    bot: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="4" y="7" width="16" height="13" rx="3.5" fill="#5865F2"/>
  <path d="M12 7H20V20H12V7Z" fill="#4752C4" fill-opacity="0.3"/>
  <circle cx="12" cy="3" r="1.5" fill="#57F287"/>
  <rect x="11.25" y="4.5" width="1.5" height="2.5" fill="#7289DA"/>
  <circle cx="8.5" cy="13" r="1.8" fill="#57F287"/>
  <circle cx="15.5" cy="13" r="1.8" fill="#57F287"/>
  <rect x="8.5" y="16.5" width="7" height="1.5" rx="0.75" fill="#FFFFFF"/>
</svg>`,

    role: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M8 14L5 22L12 19L19 22L16 14" fill="#8E44AD"/>
  <circle cx="12" cy="10" r="7" fill="#9B59B6"/>
  <path d="M12 3A7 7 0 0 1 19 10A7 7 0 0 1 12 17" fill="#8E44AD" fill-opacity="0.3"/>
  <polygon points="12,6 13.5,9 17,9.5 14.5,12 15,15.5 12,13.8 9,15.5 9.5,12 7,9.5 10.5,9" fill="#FEE75C"/>
</svg>`,

    id: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="4" y="4" width="16" height="16" rx="3" fill="#5865F2"/>
  <path d="M12 4H20V20H12V4Z" fill="#4752C4" fill-opacity="0.3"/>
  <rect x="10" y="2" width="4" height="2" rx="1" fill="#7289DA"/>
  <circle cx="12" cy="9.5" r="2.5" fill="#FFFFFF"/>
  <rect x="7" y="14" width="10" height="2" rx="1" fill="#FFFFFF"/>
  <rect x="8.5" y="17" width="7" height="1.5" rx="0.75" fill="#7289DA"/>
</svg>`,

    wave: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M8 12V6C8 5.2 8.7 4.5 9.5 4.5C10.3 4.5 11 5.2 11 6V11M11 6C11 5.2 11.7 4.5 12.5 4.5C13.3 4.5 14 5.2 14 6V11M14 7C14 6.2 14.7 5.5 15.5 5.5C16.3 5.5 17 6.2 17 7V13C17 17.4 13.4 21 9 21C6 21 4 19 4 17L4.5 13.5C4.8 11.5 6.5 12 8 12Z" fill="#FFAA00"/>
  <path d="M12 4.5C13.3 4.5 14 5.2 14 6V11M14 7C14 6.2 14.7 5.5 15.5 5.5C16.3 5.5 17 6.2 17 7V13C17 17.4 13.4 21 9 21V4.5" fill="#D68910" fill-opacity="0.25"/>
  <path d="M19 4C20.5 5.5 21.5 7.5 22 10" stroke="#FFAA00" stroke-width="2" stroke-linecap="round"/>
</svg>`,

    // Tickets & Communication
    ticket: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M3 7C3 6.4 3.4 6 4 6H20C20.6 6 21 6.4 21 7V9.5C19.6 9.5 18.5 10.6 18.5 12C18.5 13.4 19.6 14.5 21 14.5V17C21 17.6 20.6 18 20 18H4C3.4 18 3 17.6 3 17V14.5C4.4 14.5 5.5 13.4 5.5 12C5.5 10.6 4.4 9.5 3 9.5V7Z" fill="#00D2FF"/>
  <path d="M12 6H20V18H12V6Z" fill="#0984E3" fill-opacity="0.3"/>
  <polygon points="12,8 13.2,10.5 16,11 14,13 14.5,16 12,14.5 9.5,16 10,13 8,11 10.8,10.5" fill="#FFFFFF"/>
</svg>`,

    mail: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="5" width="18" height="14" rx="3" fill="#00D2FF"/>
  <path d="M12 5H21V19H12V5Z" fill="#0984E3" fill-opacity="0.3"/>
  <path d="M3 7L12 13L21 7" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    chat: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M3 11C3 6.03 7.03 2 12 2C16.97 2 21 6.03 21 11C21 15.97 16.97 20 12 20C10.3 20 8.7 19.5 7.4 18.7L3 20L4.3 15.8C3.5 14.4 3 12.8 3 11Z" fill="#00D2FF"/>
  <path d="M12 2C16.97 2 21 6.03 21 11C21 15.97 16.97 20 12 20V2Z" fill="#0984E3" fill-opacity="0.3"/>
  <circle cx="8" cy="11" r="1.5" fill="#FFFFFF"/>
  <circle cx="12" cy="11" r="1.5" fill="#FFFFFF"/>
  <circle cx="16" cy="11" r="1.5" fill="#FFFFFF"/>
</svg>`,

    channel: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M10 3L8 21M16 3L14 21M4 9H21M3 16H20" stroke="#5865F2" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M16 3L14 21M10 9H21M9 16H20" stroke="#7289DA" stroke-width="3.2" stroke-linecap="round" stroke-opacity="0.5"/>
</svg>`,

    voice: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="9" y="3" width="6" height="11" rx="3" fill="#00D2FF"/>
  <path d="M12 3H15V14H12V3Z" fill="#0984E3" fill-opacity="0.3"/>
  <path d="M5 10C5 13.9 8.1 17 12 17C15.9 17 19 10 19 10M12 17V21M8 21H16" stroke="#00D2FF" stroke-width="2.4" stroke-linecap="round"/>
</svg>`,

    edit: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M4 20L8 19L19 8L16 5L5 16L4 20Z" fill="#5865F2"/>
  <path d="M16 5L19 8L17 10L14 7L16 5Z" fill="#7289DA"/>
  <path d="M4 20L7 20L4 17L4 20Z" fill="#FEE75C"/>
</svg>`,

    notes: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="4" y="3" width="16" height="18" rx="2.5" fill="#5865F2"/>
  <rect x="3" y="6" width="3" height="2" rx="0.5" fill="#FEE75C"/>
  <rect x="3" y="11" width="3" height="2" rx="0.5" fill="#FEE75C"/>
  <rect x="3" y="16" width="3" height="2" rx="0.5" fill="#FEE75C"/>
  <rect x="8" y="7" width="9" height="2" rx="1" fill="#FFFFFF"/>
  <rect x="8" y="11" width="9" height="2" rx="1" fill="#FFFFFF"/>
  <rect x="8" y="15" width="6" height="2" rx="1" fill="#FFFFFF"/>
</svg>`,

    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M3 6C3 4.9 3.9 4 5 4H9L11 6H19C20.1 6 21 6.9 21 8V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V6Z" fill="#5865F2"/>
  <path d="M3 9H21V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V9Z" fill="#7289DA" fill-opacity="0.35"/>
</svg>`,

    link: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M9 17H7C4.8 17 3 15.2 3 13C3 10.8 4.8 9 7 9H9M15 9H17C19.2 9 21 10.8 21 13C21 15.2 19.2 17 17 17H15M8 13H16" stroke="#00D2FF" stroke-width="3" stroke-linecap="round"/>
</svg>`,

    bell: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M12 3C8.7 3 6 5.7 6 9V14L4 16V17H20V16L18 14V9C18 5.7 15.3 3 12 3Z" fill="#FEE75C"/>
  <path d="M12 3V17H20V16L18 14V9C18 5.7 15.3 3 12 3Z" fill="#F39C12" fill-opacity="0.3"/>
  <path d="M10 18C10 19.1 10.9 20 12 20C13.1 20 14 19.1 14 18" fill="#F39C12"/>
</svg>`,

    pin: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M16 4L20 8L16 12L12 8L16 4Z" fill="#EB459E"/>
  <path d="M12 8L16 12L13 15L12 19L9 16L5 15L8 12L12 8Z" fill="#FDA7DF"/>
  <path d="M9 16L4 21" stroke="#EB459E" stroke-width="2.5" stroke-linecap="round"/>
</svg>`,

    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="4" width="18" height="17" rx="3" fill="#5865F2"/>
  <rect x="3" y="4" width="18" height="6" rx="3" fill="#ED4245"/>
  <circle cx="8" cy="14" r="1.3" fill="#FFFFFF"/>
  <circle cx="12" cy="14" r="1.3" fill="#FFFFFF"/>
  <circle cx="16" cy="14" r="1.3" fill="#FFFFFF"/>
  <circle cx="8" cy="17.5" r="1.3" fill="#FFFFFF"/>
  <circle cx="12" cy="17.5" r="1.3" fill="#FFFFFF"/>
  <circle cx="16" cy="17.5" r="1.3" fill="#FFFFFF"/>
</svg>`,

    chart: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="4" y="13" width="4" height="8" rx="1.5" fill="#00D2FF"/>
  <rect x="10" y="8" width="4" height="13" rx="1.5" fill="#0984E3"/>
  <rect x="16" y="3" width="4" height="18" rx="1.5" fill="#5865F2"/>
</svg>`,

    search: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="11" cy="11" r="7" fill="#00D2FF" fill-opacity="0.3"/>
  <circle cx="11" cy="11" r="7" stroke="#00D2FF" stroke-width="3"/>
  <path d="M16 16L21 21" stroke="#00D2FF" stroke-width="3.5" stroke-linecap="round"/>
</svg>`,

    download: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M4 17V19C4 20.1 4.9 21 6 21H18C19.1 21 20 20.1 20 19V17" stroke="#00D2FF" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M12 3V14M12 14L8 10M12 14L16 10" stroke="#00D2FF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    upload: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M4 17V19C4 20.1 4.9 21 6 21H18C19.1 21 20 20.1 20 19V17" stroke="#57F287" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M12 15V4M12 4L8 8M12 4L16 8" stroke="#57F287" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    arrow_left: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#5865F2"/>
  <path d="M14 8L10 12L14 16" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    arrow_right: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#5865F2"/>
  <path d="M10 8L14 12L10 16" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

    number: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="10" fill="#5865F2"/>
  <path d="M10 7L8.5 17M15.5 7L14 17M6 10H18M5 14H17" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
</svg>`,

    // Status Dots
    dot_green: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" fill="#57F287" fill-opacity="0.25"/>
  <circle cx="12" cy="12" r="6" fill="#57F287"/>
  <circle cx="10" cy="10" r="1.8" fill="#FFFFFF" fill-opacity="0.6"/>
</svg>`,

    dot_yellow: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" fill="#FEE75C" fill-opacity="0.25"/>
  <circle cx="12" cy="12" r="6" fill="#FEE75C"/>
  <circle cx="10" cy="10" r="1.8" fill="#FFFFFF" fill-opacity="0.6"/>
</svg>`,

    dot_red: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" fill="#ED4245" fill-opacity="0.25"/>
  <circle cx="12" cy="12" r="6" fill="#ED4245"/>
  <circle cx="10" cy="10" r="1.8" fill="#FFFFFF" fill-opacity="0.6"/>
</svg>`,

    dot_white: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" fill="#B2BEC3" fill-opacity="0.25"/>
  <circle cx="12" cy="12" r="6" fill="#B2BEC3"/>
  <circle cx="10" cy="10" r="1.8" fill="#FFFFFF" fill-opacity="0.6"/>
</svg>`
};

const ALIASES = {
    warning: 'warn',
    check: 'success',
    cross: 'error',
    timer: 'slowmode',
    clock: 'slowmode',
    trash: 'purge',
    switch: 'switch_icon',
    log: 'transcript',
    scroll: 'transcript',
    stats: 'chart',
    medal1: 'trophy',
    medal2: 'star',
    medal3: 'star',
    status_online: 'dot_green',
    status_idle: 'dot_yellow',
    status_dnd: 'dot_red',
    status_offline: 'dot_white',
    dot_gray: 'dot_white',
    loading: 'refresh',
    online: 'dot_green',
    idle: 'dot_yellow',
    dnd: 'dot_red',
    offline: 'dot_white'
};

/**
 * Automatically verifies and syncs filled application emojis to the Discord Developer Portal
 * for the currently logged-in bot application.
 * If the token changes or emojis are missing, it automatically creates them.
 * 
 * @param {import('discord.js').Client} client 
 * @param {Object} [options]
 * @param {boolean} [options.force=false]
 */
async function autoSyncApplicationEmojis(client, options = {}) {
    if (process.env.NODE_ENV === 'test' || !client || !client.application) {
        return;
    }

    try {
        console.log(`[EmojiSync] Checking Developer Portal application emojis for App ID: ${client.application.id}...`);
        const existingEmojis = await client.application.emojis.fetch();
        const existingMap = new Map();
        existingEmojis.forEach(e => existingMap.set(e.name.toLowerCase(), e));

        const requiredNames = Object.keys(FILLED_ICONS);
        const missingNames = requiredNames.filter(name => !existingMap.has(name.toLowerCase()));

        // Also check if local emojis.json needs updating
        let localData = {};
        try {
            if (fs.existsSync(EMOJIS_PATH)) {
                localData = JSON.parse(fs.readFileSync(EMOJIS_PATH, 'utf8'));
            }
        } catch (e) {
            localData = {};
        }

        const needsSync = options.force || missingNames.length > 0 || Object.keys(localData).length < 70;

        if (!needsSync) {
            console.log(`[EmojiSync] ✓ All ${requiredNames.length} application emojis already exist on Developer Portal (App ID: ${client.application.id}).`);
            return;
        }

        console.log(`[EmojiSync] Detected token/app change or missing emojis (${missingNames.length} missing). Syncing to Developer Portal...`);

        const emojiRegistry = { ...localData };
        let uploaded = 0;

        for (const name of requiredNames) {
            const lower = name.toLowerCase();
            if (existingMap.has(lower) && !options.force) {
                emojiRegistry[name] = existingMap.get(lower).toString();
            } else {
                try {
                    const svg = FILLED_ICONS[name];
                    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } });
                    const pngBuffer = resvg.render().asPng();

                    // If forcing and already exists, delete old one
                    if (options.force && existingMap.has(lower)) {
                        await existingMap.get(lower).delete().catch(() => {});
                    }

                    const created = await client.application.emojis.create({
                        attachment: pngBuffer,
                        name: lower
                    });

                    emojiRegistry[name] = created.toString();
                    existingMap.set(lower, created);
                    uploaded++;
                    console.log(`[EmojiSync ✓] Uploaded ${name} -> ${created.toString()}`);
                    await new Promise(r => setTimeout(r, 200));
                } catch (err) {
                    console.error(`[EmojiSync] Failed to upload ${name}:`, err.message);
                }
            }
        }

        // Apply aliases
        for (const [alias, target] of Object.entries(ALIASES)) {
            if (emojiRegistry[target]) {
                emojiRegistry[alias] = emojiRegistry[target];
            }
        }

        // Save emojis.json
        fs.writeFileSync(EMOJIS_PATH, JSON.stringify(emojiRegistry, null, 2), 'utf8');

        // Reload in-memory emojis store
        if (emojisUtil && typeof emojisUtil.reloadEmojis === 'function') {
            emojisUtil.reloadEmojis();
        }

        console.log(`[EmojiSync] 🎉 Successfully synced ${Object.keys(emojiRegistry).length} custom emojis to emojis.json for Application ID: ${client.application.id} (Uploaded: ${uploaded})`);
    } catch (error) {
        console.error('[EmojiSync] Failed to sync application emojis:', error.message);
    }
}

module.exports = {
    FILLED_ICONS,
    ALIASES,
    autoSyncApplicationEmojis
};
