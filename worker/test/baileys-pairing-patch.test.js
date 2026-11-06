import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../node_modules/@chaeulso/baileys/lib/', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('RIMURU imports the patched Baileys package', async () => {
  const entry = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(entry, /from '@chaeulso\/baileys'/);
});

test('Baileys QR refresh handler is present and preserves the active QR ref', async () => {
  const socket = await read('Socket/socket.js');
  assert.match(socket, /handleCompanionRegRefresh/);
  assert.match(socket, /makePairingQRRenderer/);
});

test('pairing-code registration uses the correct nonce and registration handshake', async () => {
  const socket = await read('Socket/socket.js');
  assert.match(socket, /content: Buffer\.alloc\(1\)/);
  assert.match(socket, /if \(!creds\.me \|\| \(!!creds\.pairingCode && !creds\.registered\)\)/);
});

test('pairing-code notification ignores the preliminary non-primary hello stage', async () => {
  const receiver = await read('Socket/messages-recv.js');
  assert.match(receiver, /linkCodeCompanionReg\?\.attrs\?\.stage !== 'primary_hello'/);
});

test('successful QR pairing marks credentials registered before reconnect', async () => {
  const validation = await read('Utils/validate-connection.js');
  assert.match(validation, /platform: platformNode\?\.attrs\.name,\s*registered: true/);
});
