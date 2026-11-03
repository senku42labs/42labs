import { handleIncomingMessage } from './command-engine.js';
export class PairingManager {
  constructor({ loadAuthState, createSocket, authDir, fetchLatestVersion = async () => null }) {
    this.loadAuthState = loadAuthState;
    this.createSocket = createSocket;
    this.authDir = authDir;
    this.fetchLatestVersion = fetchLatestVersion;
    this.socket = null;
    this.mode = null;
    this.state = { status: 'disconnected', qr: null, pairingCode: null, phone: null, lastError: null };
    this.codeRequested = false;
    this.retryCount = 0;
    this.reconnectTimer = null;
    this.generation = 0;
  }

  publicStatus() { return { ...this.state }; }

  async restore() {
    const auth = await this.loadAuthState(this.authDir);
    if (!auth.state.creds.registered) return this.publicStatus();
    this.mode = 'restore';
    await this.attachSocket(auth, 'restore');
    return this.publicStatus();
  }

  async start(mode, phone = null) {
    if (!['qr', 'code'].includes(mode)) throw new Error('Pairing mode must be qr or code.');
    if (['connecting', 'qr_ready', 'code_ready', 'connected'].includes(this.state.status)) {
      throw new Error('A WhatsApp connection or pairing attempt is already active.');
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.generation += 1;
    this.mode = mode;
    this.retryCount = 0;
    this.codeRequested = false;
    this.state = { status: 'connecting', qr: null, pairingCode: null, phone, lastError: null };
    const auth = await this.loadAuthState(this.authDir);
    if (auth.state.creds.registered) {
      await this.attachSocket(auth, 'restore');
      return this.publicStatus();
    }
    await this.attachSocket(auth, mode);
    return this.publicStatus();
  }

  async latestVersionWithTimeout() {
    let timer;
    try {
      return await Promise.race([
        this.fetchLatestVersion(),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 6000); })
      ]);
    } catch (error) {
      console.warn('Could not fetch current WhatsApp Web version; using Baileys defaults:', error?.message || error);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async attachSocket(auth, mode) {
    const generation = this.generation;
    const latest = await this.latestVersionWithTimeout();
    if (generation !== this.generation) return;
    const options = {
      auth: auth.state,
      // Match the Chrome desktop identity used by the working 42 MD BOT connection.
      browser: ['RIMURU TEMPEST MD', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      ...(latest?.version ? { version: latest.version } : {})
    };
    const socket = this.createSocket(options);
    this.socket = socket;
    socket.ev.on('creds.update', auth.saveCreds);
    socket.ev.on('messages.upsert', async (update) => {
      if (update.type !== 'notify' || !Array.isArray(update.messages)) return;
      for (const message of update.messages) {
        try {
          await handleIncomingMessage(socket, message, {
            botName: process.env.RIMURU_BOT_NAME || 'RIMURU TEMPEST MD',
            version: process.env.RIMURU_BOT_VERSION || '1.0.0'
          });
        } catch (error) {
          console.error('RIMURU message handler failed:', error?.message || error);
        }
      }
    });
    socket.ev.on('connection.update', (update) => {
      if (generation !== this.generation) return;
      this.handleConnectionUpdate(update, mode, generation);
    });
  }

  async requestPhonePairingCode(socket = this.socket, generation = this.generation) {
    if (this.codeRequested || !socket || !this.state.phone) return;
    this.codeRequested = true;
    try {
      const code = await socket.requestPairingCode(this.state.phone);
      if (generation === this.generation && this.state.status === 'connecting') {
        this.state.status = 'code_ready';
        this.state.pairingCode = code;
        this.state.lastError = null;
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.state.status = 'error';
      this.state.pairingCode = null;
      this.state.lastError = error?.message || 'WhatsApp could not issue a pairing code.';
    }
  }

  handleConnectionUpdate(update, mode, generation) {
    // Baileys emits a QR update in pairing-code mode too. Use that socket-ready
    // event as the trigger; requesting a code earlier can race the Noise handshake.
    if (update.qr && mode === 'code') {
      void this.requestPhonePairingCode(this.socket, generation);
    }
    if (update.qr && mode === 'qr') {
      this.state.status = 'qr_ready';
      this.state.qr = update.qr;
      this.state.lastError = null;
    }
    if (update.connection === 'open') {
      this.retryCount = 0;
      this.state.status = 'connected';
      this.state.qr = null;
      this.state.pairingCode = null;
      this.state.lastError = null;
    }
    if (update.connection === 'close') {
      const error = update.lastDisconnect?.error;
      const reason = error?.message || 'WhatsApp connection closed before pairing completed.';
      const code = error?.output?.statusCode ?? error?.statusCode;
      this.socket = null;
      this.state.qr = null;
      this.state.pairingCode = null;

      // WhatsApp 515 is a normal restart-required handshake after linking.
      // 401 (logged out) and 440 (another client replaced this one) need user action.
      const terminal = code === 401 || code === 440;
      if (!terminal && this.retryCount < 8) {
        this.state.status = 'connecting';
        this.state.lastError = `WhatsApp disconnected (${code ?? 'network'}: ${reason}); reconnecting…`;
        const delay = code === 515 ? 250 : Math.min(1000 * (2 ** this.retryCount), 30000);
        this.retryCount += 1;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          void this.reconnect(mode, generation);
        }, delay);
      } else {
        this.state.status = 'error';
        this.state.lastError = terminal
          ? `WhatsApp ended or replaced this session (${code}): ${reason}`
          : `WhatsApp reconnect limit reached: ${reason}`;
      }
    }
  }

  async reconnect(mode, generation) {
    if (generation !== this.generation) return;
    try {
      const auth = await this.loadAuthState(this.authDir);
      const nextMode = auth.state.creds.registered ? 'restore' : mode;
      this.codeRequested = false;
      await this.attachSocket(auth, nextMode);
    } catch (error) {
      if (generation !== this.generation) return;
      this.state.status = 'error';
      this.state.lastError = `WhatsApp reconnect failed: ${error?.message || error}`;
    }
  }
}
