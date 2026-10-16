const { Client, GatewayIntentBits, Partials, Collection, DefaultWebSocketManagerOptions } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Ensure DefaultWebSocketManagerOptions identify properties are set for VR
if (DefaultWebSocketManagerOptions && DefaultWebSocketManagerOptions.identifyProperties) {
    DefaultWebSocketManagerOptions.identifyProperties.browser = 'Discord VR';
    DefaultWebSocketManagerOptions.identifyProperties.device = 'Discord VR';
    DefaultWebSocketManagerOptions.identifyProperties.os = 'Android';
}

/**
 * Extended Client class
 * @extends {Client}
 */
class ExtendedClient extends Client {
    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildModeration,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.AutoModerationExecution,
                GatewayIntentBits.GuildVoiceStates
            ],
            partials: [
                Partials.Channel,
                Partials.Message,
                Partials.GuildMember
            ],
            ws: {
                properties: {
                    browser: 'Discord VR',
                    device: 'Discord VR',
                    os: 'Android'
                }
            },
            presence: {
                status: 'online',
                activities: [{
                    name: 'EnzoCord',
                    type: 3 // ActivityType.Watching
                }]
            }
        });

        this.commands = new Collection();
        this.buttons = new Collection();
        this.selects = new Collection();
        this.modals = new Collection();
        this.cooldowns = new Collection();
    }

    /**
     * Start the client
     * @param {string} token - Discord Bot Token
     */
    async start(token) {
        await this.loadCommands();
        await this.loadEvents();
        await this.loadComponents();
        await super.login(token);
    }

    /**
     * Recursively load slash commands
     */
    async loadCommands() {
        const commandsPath = path.join(__dirname, '..', 'commands');
        if (!fs.existsSync(commandsPath)) return;
        
        const commandFolders = fs.readdirSync(commandsPath);
        for (const folder of commandFolders) {
            const folderPath = path.join(commandsPath, folder);
            if (!fs.statSync(folderPath).isDirectory()) continue;
            
            const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
            for (const file of commandFiles) {
                const filePath = path.join(folderPath, file);
                const command = require(filePath);
                if ('data' in command && 'execute' in command) {
                    this.commands.set(command.data.name, command);
                } else {
                    console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
                }
            }
        }
    }

    /**
     * Recursively load events
     */
    async loadEvents() {
        const eventsPath = path.join(__dirname, '..', 'events');
        if (!fs.existsSync(eventsPath)) return;
        
        const eventFolders = fs.readdirSync(eventsPath);
        for (const folder of eventFolders) {
            const folderPath = path.join(eventsPath, folder);
            if (!fs.statSync(folderPath).isDirectory()) continue;
            
            const eventFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
            for (const file of eventFiles) {
                const filePath = path.join(folderPath, file);
                const event = require(filePath);
                if (event.once) {
                    this.once(event.name, (...args) => event.execute(...args, this));
                } else {
                    this.on(event.name, (...args) => event.execute(...args, this));
                }
            }
        }
    }

    /**
     * Load interactive components (buttons, selects, modals)
     */
    async loadComponents() {
        const componentsPath = path.join(__dirname, '..', 'components');
        if (!fs.existsSync(componentsPath)) return;

        const componentTypes = ['buttons', 'selects', 'modals'];
        for (const type of componentTypes) {
            const typePath = path.join(componentsPath, type);
            if (!fs.existsSync(typePath)) continue;

            const files = fs.readdirSync(typePath).filter(file => file.endsWith('.js'));
            for (const file of files) {
                const filePath = path.join(typePath, file);
                const component = require(filePath);
                if (component.id && component.execute) {
                    this[type].set(component.id, component);
                }
            }
        }
    }
}

module.exports = ExtendedClient;
