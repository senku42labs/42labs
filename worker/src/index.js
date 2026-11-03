import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { PairingManager } from './pairing-manager.js';
import { normalizePhoneNumber } from './phone.js';
import { getCommandConfig, updateCommandConfig, registeredCommands } from './command-engine.js';

const port = Number(process.env.PORT || 3000);
const apiKey = process.env.RIMURU_API_KEY || '';
const authDir = process.env.AUTH_DIR || '/data/whatsapp-auth';
const commandConfigPath = process.env.COMMAND_CONFIG_PATH || '/data/command-config.json';
const manager = new PairingManager({
  loadAuthState: useMultiFileAuthState,
  createSocket: (options) => makeWASocket(options),
  fetchLatestVersion: fetchLatestBaileysVersion,
  authDir
});

function authorized(req) {
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const expected = Buffer.from(apiKey);
  const actual = Buffer.from(supplied);
  return Boolean(apiKey) && expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error('Request body too large.');
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new Error('Request body must be valid JSON.'); }
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    return send(res, 200, { service: 'RIMURU TEMPEST MD', status: 'healthy', whatsapp: manager.publicStatus().status });
  }
  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' });

  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return send(res, 200, manager.publicStatus());
    }
    if (req.method === 'POST' && url.pathname === '/api/pairing/qr') {
      await manager.start('qr');
      return send(res, 202, { message: 'QR pairing started. Poll /api/status for the QR payload.', ...manager.publicStatus() });
    }
    if (req.method === 'POST' && url.pathname === '/api/pairing/code') {
      const body = await readJson(req);
      const phone = normalizePhoneNumber(body.phone);
      await manager.start('code', phone);
      return send(res, 202, {
        message: 'Pairing started. Poll /api/status for the WhatsApp-issued pairing code.',
        ...manager.publicStatus()
      });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    const message = error?.message || 'Request failed.';
    const status = /already active/.test(message) ? 409 : /8–15 digits|Phone number/.test(message) ? 400 : 500;
    return send(res, status, { error: message });
  }
});

await mkdir(authDir, { recursive: true });
try {
  const savedConfig = JSON.parse(await readFile(commandConfigPath, 'utf8'));
  updateCommandConfig(savedConfig);
} catch (error) {
  if (error?.code !== 'ENOENT') console.error('Command config restore failed:', error?.message || error);
}
try {
  await manager.restore();
} catch (error) {
  console.error('WhatsApp session restore failed:', error?.message || error);
}
server.listen(port, '0.0.0.0', () => console.log(`RIMURU TEMPEST MD worker listening on ${port}`));
