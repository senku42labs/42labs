export class PairingManager {
  constructor({ loadAuthState, createSocket, authDir }) {
    this.loadAuthState = loadAuthState;
    this.createSocket = createSocket;
    this.authDir = authDir;
    this.socket = null;
    this.saveCreds = null;
    this.mode = null;
    this.state = { status: 'disconnected', qr: null, pairingCode: null, phone: null, lastError: null };
    this.codeWaiters = [];
    this.codeRequested = false;
  }

  publicStatus() { return { ...this.state }; }

  async restore() {
    const auth = await this.loadAuthState(this.authDir);
    if (!auth.state.creds.registered) return this.publicStatus();
    await this.attachSocket(auth, 'restore');
    return this.publicStatus();
  }

  async start(mode, phone = null) {
    if (!['qr', 'code'].includes(mode)) throw new Error('Pairing mode must be qr or code.');
    if (['connecting', 'qr_ready', 'code_ready', 'connected'].includes(this.state.status)) {
      throw new Error('A WhatsApp connection or pairing attempt is already active.');
    }
    this.mode = mode;
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

  async attachSocket(auth, mode) {
    this.saveCreds = auth.saveCreds;
    this.socket = this.createSocket({
      auth: auth.state,
      browser: ['RIMURU TEMPEST MD', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false
    });
    this.socket.ev.on('creds.update', this.saveCreds);
    this.socket.ev.on('connection.update', (update) => this.handleConnectionUpdate(update, mode));

    // Baileys' documented pairing-code flow requests the code directly after
    // creating the socket; it does not wait for a QR event.
    if (mode === 'code') void this.requestPhonePairingCode();
  }

  async requestPhonePairingCode() {
    if (this.codeRequested || !this.socket || !this.state.phone) return;
    this.codeRequested = true;
    try {
      const code = await this.socket.requestPairingCode(this.state.phone);
      if (this.state.status === 'connecting') {
        this.state.status = 'code_ready';
        this.state.pairingCode = code;
        this.state.lastError = null;
        this.resolveCodeWaiters(code);
      }
    } catch (error) {
      this.state.status = 'error';
      this.state.pairingCode = null;
      this.state.lastError = error?.message || 'WhatsApp could not issue a pairing code.';
      this.rejectCodeWaiters(error);
    }
  }

  async handleConnectionUpdate(update, mode) {
    if (update.qr && mode === 'qr') {
      this.state.status = 'qr_ready';
      this.state.qr = update.qr;
      this.state.lastError = null;
    }
    if (update.connection === 'open') {
      this.state.status = 'connected';
      this.state.qr = null;
      this.state.pairingCode = null;
      this.state.lastError = null;
      this.resolveCodeWaiters(null);
    }
    if (update.connection === 'close') {
      const reason = update.lastDisconnect?.error?.message || 'WhatsApp connection closed before pairing completed.';
      this.state.status = 'error';
      this.state.qr = null;
      this.state.pairingCode = null;
      this.state.lastError = reason;
      this.rejectCodeWaiters(new Error(reason));
    }
  }

  waitForPairingCode(timeoutMs = 30000) {
    if (this.state.pairingCode) return Promise.resolve(this.state.pairingCode);
    if (this.state.status === 'error') return Promise.reject(new Error(this.state.lastError));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.codeWaiters.push(waiter);
      const timer = setTimeout(() => {
        this.codeWaiters = this.codeWaiters.filter((item) => item !== waiter);
        reject(new Error('Timed out waiting for WhatsApp to issue a pairing code.'));
      }, timeoutMs);
      waiter.resolve = (value) => { clearTimeout(timer); resolve(value); };
      waiter.reject = (error) => { clearTimeout(timer); reject(error); };
    });
  }

  resolveCodeWaiters(value) {
    for (const waiter of this.codeWaiters.splice(0)) waiter.resolve(value);
  }

  rejectCodeWaiters(error) {
    for (const waiter of this.codeWaiters.splice(0)) waiter.reject(error);
  }
}
