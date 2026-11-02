import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PairingManager } from '../src/pairing-manager.js';

function createHarness({ registered = false, pairingCode = 'ABCD-1234' } = {}) {
  const events = new EventEmitter();
  const calls = [];
  const socket = {
    ev: events,
    requestPairingCode: async (phone) => { calls.push(phone); return pairingCode; }
  };
  const manager = new PairingManager({
    authDir: '/tmp/auth',
    loadAuthState: async () => ({ state: { creds: { registered } }, saveCreds: async () => {} }),
    createSocket: () => socket
  });
  return { manager, events, socket, calls };
}

test('QR mode exposes the QR payload when WhatsApp emits it', async () => {
  const { manager, events } = createHarness();
  await manager.start('qr');
  events.emit('connection.update', { qr: 'qr-payload' });
  assert.equal(manager.publicStatus().status, 'qr_ready');
  assert.equal(manager.publicStatus().qr, 'qr-payload');
});

test('phone-code mode waits for the socket connecting event before requesting a code', async () => {
  const { manager, events, calls } = createHarness();
  await manager.start('code', '263771234567');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, []);
  events.emit('connection.update', { connection: 'connecting' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['263771234567']);
  assert.equal(manager.publicStatus().status, 'code_ready');
  assert.equal(manager.publicStatus().pairingCode, 'ABCD-1234');
});

test('phone-code mode requests a code only once when connecting is emitted repeatedly', async () => {
  const { manager, events, calls } = createHarness();
  await manager.start('code', '263771234567');
  events.emit('connection.update', { connection: 'connecting' });
  events.emit('connection.update', { connection: 'connecting' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['263771234567']);
});

test('logged-out connection close exposes an actionable error instead of reconnecting stale credentials', async () => {
  const { manager, events } = createHarness();
  await manager.start('qr');
  events.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { message: 'Connection Failure', output: { statusCode: 401 } } }
  });
  assert.equal(manager.publicStatus().status, 'error');
  assert.match(manager.publicStatus().lastError, /401.*Connection Failure/);
});

test('connected event clears temporary pairing credentials', async () => {
  const { manager, events } = createHarness();
  await manager.start('qr');
  events.emit('connection.update', { qr: 'qr-payload' });
  events.emit('connection.update', { connection: 'open' });
  assert.deepEqual(manager.publicStatus(), {
    status: 'connected', qr: null, pairingCode: null, phone: null, lastError: null
  });
});

test('restore reconnects only when saved credentials are registered', async () => {
  const { manager } = createHarness({ registered: false });
  assert.equal((await manager.restore()).status, 'disconnected');
});

test('restarts the WhatsApp socket after restartRequired (515)', async () => {
  const firstEvents = new EventEmitter();
  const secondEvents = new EventEmitter();
  let socketCount = 0;
  const manager = new PairingManager({
    authDir: '/tmp/auth',
    loadAuthState: async () => ({ state: { creds: { registered: true } }, saveCreds: async () => {} }),
    createSocket: () => ({ ev: ++socketCount === 1 ? firstEvents : secondEvents })
  });
  await manager.start('qr');
  firstEvents.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { message: 'restart required', output: { statusCode: 515 } } }
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(socketCount, 2);
  secondEvents.emit('connection.update', { connection: 'open' });
  assert.equal(manager.publicStatus().status, 'connected');
});

test('uses the dynamically fetched WhatsApp Web version when creating a socket', async () => {
  const events = new EventEmitter();
  let socketOptions;
  const manager = new PairingManager({
    authDir: '/tmp/auth',
    loadAuthState: async () => ({ state: { creds: { registered: false } }, saveCreds: async () => {} }),
    fetchLatestVersion: async () => ({ version: [2, 3000, 1] }),
    createSocket: (options) => { socketOptions = options; return { ev: events }; }
  });
  await manager.start('qr');
  assert.deepEqual(socketOptions.version, [2, 3000, 1]);
});
