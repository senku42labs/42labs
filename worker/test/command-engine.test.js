import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, handleIncomingMessage, registeredCommands, getCommandConfig, updateCommandConfig } from '../src/command-engine.js';

test('parses a prefixed command and keeps its arguments', () => {
  assert.deepEqual(parseCommand({message:{conversation:'.ping now'}}, '.'), {name:'ping',args:'now'});
});
test('ignores messages without the configured prefix', () => {
  assert.equal(parseCommand({message:{conversation:'hello'}}, '.'), null);
});
test('ignores an empty prefix command', () => {
  assert.equal(parseCommand({message:{conversation:'.'}}, '.'), null);
});
test('runs alive and replies to the originating chat', async () => {
  const sent=[]; const sock={sendMessage:async (...args)=>sent.push(args)};
  const message={key:{remoteJid:'123@s.whatsapp.net'},message:{conversation:'.alive'}};
  const result=await handleIncomingMessage(sock,message,{prefix:'.',botName:'RIMURU TEMPEST MD',version:'1.0.0'});
  assert.equal(result.handled,true); assert.match(sent[0][1].text,/RIMURU TEMPEST MD/);
});
test('does not execute commands from the bot itself', async () => {
  const sent=[]; const sock={sendMessage:async (...args)=>sent.push(args)};
  const message={key:{remoteJid:'123@s.whatsapp.net',fromMe:true},message:{conversation:'.alive'}};
  const result=await handleIncomingMessage(sock,message,{prefix:'.'});
  assert.equal(result.handled,false); assert.equal(sent.length,0);
});
test('unknown commands are ignored without sending a message', async () => {
  const sent=[]; const sock={sendMessage:async (...args)=>sent.push(args)};
  const message={key:{remoteJid:'123@s.whatsapp.net'},message:{conversation:'.notreal'}};
  const result=await handleIncomingMessage(sock,message,{prefix:'.'});
  assert.equal(result.handled,false); assert.equal(sent.length,0);
});
test('exports a command registry that includes Knightbot-inspired core commands', () => {
  assert.equal(registeredCommands.length,17);\n  for (const name of ['alive','ping','menu','help','time','echo','groupinfo','pair','joke','fact','compliment','truth','dare','8ball','goodnight','goodmorning','quote']) assert.ok(registeredCommands.includes(name));
});

test('disabled commands stop executing until re-enabled', async () => {
  const original = getCommandConfig();
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  updateCommandConfig({ enabled: original.enabled.filter((name) => name !== 'ping') });
  const result = await handleIncomingMessage(sock, {
    key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.ping' }
  });
  assert.equal(result.handled, false);
  assert.equal(sent.length, 0);
  updateCommandConfig(original);
});

test('rejects invalid command prefixes and unknown command names', () => {
  const original = getCommandConfig();
  assert.throws(() => updateCommandConfig({ prefix: '  ' }), /prefix/);
  assert.throws(() => updateCommandConfig({ enabled: ['not-a-command'] }), /registered/);
  updateCommandConfig(original);
});

test('executes offline Knightbot-inspired entertainment commands', async () => {
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  for (const command of ['joke','fact','compliment','truth','dare','goodnight','goodmorning','quote']) {
    const result = await handleIncomingMessage(sock, {
      key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: `.${command}` }
    });
    assert.equal(result.handled, true, command);
  }
  const eight = await handleIncomingMessage(sock, {
    key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.8ball Will it rain?' }
  });
  assert.equal(eight.handled, true);
  assert.equal(sent.length, 9);
});
