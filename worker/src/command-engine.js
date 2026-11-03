const COMMANDS = {
  alive: async ({ settings }) => `🌪️ *${settings.botName || 'RIMURU TEMPEST MD'}*\n\nStatus: Online\nVersion: ${settings.version || '1.0.0'}\nCreated by: 42`,
  ping: async () => '🏓 Pong! RIMURU is responding.',
  menu: async ({ settings }) => {
    const prefix = settings.prefix || '.';
    return `🌪️ *${settings.botName || 'RIMURU TEMPEST MD'} — COMMANDS*\n\n` +
      [`${prefix}alive — bot status`, `${prefix}ping — connection response`, `${prefix}menu — command list`,
       `${prefix}help — command help`, `${prefix}time — current UTC time`, `${prefix}echo <text> — repeat text`,
       `${prefix}groupinfo — group details`, `${prefix}pair — open the RIMURU pairing dashboard`].join('\n');
  },
  help: async ({ settings, args }) => args
    ? `Help: use ${settings.prefix || '.'}${args.trim()} with its required arguments.`
    : COMMANDS.menu({ settings }),
  time: async () => `🕒 ${new Date().toISOString()} (UTC)`,
  echo: async ({ args }) => args ? args.slice(0, 500) : 'Usage: .echo <text>',
  groupinfo: async ({ sock, chatId }) => {
    if (!chatId.endsWith('@g.us')) return 'This command only works in a group.';
    const metadata = await sock.groupMetadata(chatId);
    return `👥 *${metadata.subject || 'Group'}*\nMembers: ${metadata.participants?.length ?? 'unknown'}\nGroup ID: ${chatId}`;
  },
  pair: async () => 'To link a WhatsApp account, use the official RIMURU pairing dashboard. Pairing codes are issued by your own Baileys session; do not use third-party pairing services.'
};

let runtimeConfig = { prefix: process.env.COMMAND_PREFIX || '.', enabled: new Set(Object.keys(COMMANDS)) };

export function getCommandConfig() {
  return { prefix: runtimeConfig.prefix, enabled: [...runtimeConfig.enabled] };
}

export function updateCommandConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Command config must be an object.');
  const prefix = input.prefix ?? runtimeConfig.prefix;
  const enabled = input.enabled ?? [...runtimeConfig.enabled];
  if (typeof prefix !== 'string' || prefix.length < 1 || prefix.length > 3 || /\s/.test(prefix)) {
    throw new Error('Command prefix must be 1–3 non-space characters.');
  }
  if (!Array.isArray(enabled) || enabled.some((name) => typeof name !== 'string' || !Object.hasOwn(COMMANDS, name))) {
    throw new Error('Enabled commands must contain only registered command names.');
  }
  runtimeConfig = { prefix, enabled: new Set(enabled) };
  return getCommandConfig();
}

export function extractMessageText(message) {
  const m = message?.message || {};
  return (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
    m.videoMessage?.caption || m.documentMessage?.caption || '').trim();
}

export function parseCommand(message, prefix = '.') {
  const text = extractMessageText(message);
  if (!prefix || !text.startsWith(prefix)) return null;
  const body = text.slice(prefix.length).trim();
  if (!body) return null;
  const firstSpace = body.search(/\s/);
  const name = (firstSpace < 0 ? body : body.slice(0, firstSpace)).toLowerCase();
  const args = firstSpace < 0 ? '' : body.slice(firstSpace + 1).trim();
  return { name, args };
}

export async function handleIncomingMessage(sock, message, settings = {}) {
  if (!message?.message || message.key?.fromMe || message.key?.remoteJid === 'status@broadcast') return { handled: false };
  const prefix = settings.prefix || runtimeConfig.prefix;
  const parsed = parseCommand(message, prefix);
  if (!parsed || !Object.hasOwn(COMMANDS, parsed.name) || !runtimeConfig.enabled.has(parsed.name)) return { handled: false };
  const chatId = message.key?.remoteJid;
  if (!chatId) return { handled: false };
  const context = { sock, message, chatId, args: parsed.args,
    settings: { ...settings, prefix, botName: settings.botName || process.env.RIMURU_BOT_NAME || 'RIMURU TEMPEST MD' } };
  try {
    const text = await COMMANDS[parsed.name](context);
    if (text) await sock.sendMessage(chatId, { text }, { quoted: message });
    return { handled: true, command: parsed.name };
  } catch (error) {
    console.error(`RIMURU command ${parsed.name} failed:`, error?.message || error);
    await sock.sendMessage(chatId, { text: 'That command could not be completed. Please try again.' }, { quoted: message });
    return { handled: true, command: parsed.name, error: true };
  }
}

export const registeredCommands = Object.keys(COMMANDS);
