import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PairingManager } from '../src/pairing-manager.js';

function createHarness({ registered = false, pairingCode = 'ABCD-1234' } = {}) {
  const events = new EventEmitter();
  const socket = { ev: events, requestPairingCode: async () => pairingCode };
  const manager = new PairingManager({
    authDir: '/tmp/auth',
    loadAuthState: async () => ({ state: { creds: { registered } }, saveCreds: async () => {} }),
    createSocket: () => socket
  });
  return { manager, events, socket };
}

test('QR mode exposes the QR payload when WhatsApp emits it', async () => {
  const { manager, events } = createHarness();
  await manager.start('qr');
  events.emit('connection.update', { qr: 'qr-payload' });
  assert.equal(manager.publicStatus().status, 'qr_ready');
  assert.equal(manager.publicStatus().qr, 'qr-payload');
});

test('phone-code mode requests a code only after WhatsApp emits its QR trigger', async () => {
  const { manager, events } = createHarness();
  await manager.start('code', '263771234567');
  const codePromise = manager.waitForPairingCode();
  events.emit('connection.update', { qr: 'internal-trigger' });
  assert.equal(await codePromise, 'ABCD-1234');
  assert.equal(manager.publicStatus().status, 'code_ready');
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
