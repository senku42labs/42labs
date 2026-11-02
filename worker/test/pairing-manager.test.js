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

test('phone-code mode requests its code immediately without waiting for a QR event', async () => {
  const { manager, calls } = createHarness();
  await manager.start('code', '263771234567');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['263771234567']);
  assert.equal(manager.publicStatus().status, 'code_ready');
  assert.equal(manager.publicStatus().pairingCode, 'ABCD-1234');
});

test('connection close exposes an error instead of leaving pairing in a waiting state', async () => {
  const { manager, events } = createHarness();
  await manager.start('qr');
  events.emit('connection.update', { connection: 'close', lastDisconnect: { error: new Error('Connection Failure') } });
  assert.equal(manager.publicStatus().status, 'error');
  assert.match(manager.publicStatus().lastError, /Connection Failure/);
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
