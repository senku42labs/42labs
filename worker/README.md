# RIMURU TEMPEST MD — WhatsApp worker

Railway worker for the RIMURU TEMPEST MD WhatsApp Multi-Device bot.

## Implemented

- WhatsApp Web connection using the community-maintained Baileys 6.7.24 legacy line. This is a compatibility choice after repeated Noise-handshake failures on the 7.0.0 release-candidate line; re-evaluate against WhatsApp changes before upgrading again.
- QR and phone-number linking are intended for both the regular WhatsApp Messenger app and the regular WhatsApp Business mobile app. In either app, approve the link under Settings → Linked Devices; the server cannot pre-authorize a device.
- QR pairing through `POST /api/pairing/qr` and `GET /api/status`.
- Phone-number pairing through `POST /api/pairing/code`.
- Multi-file session persistence and reconnect on process start when credentials are registered.
- Bearer-token protection for all `/api/*` endpoints; `/health` remains public.

## Railway configuration

- Root directory: `/worker`
- Start command: `npm start`
- Health check: `/health`
- Node.js: 22+
- Variables: `RIMURU_API_KEY` (long random secret), `AUTH_DIR=/data/whatsapp-auth`
- Attach a **new, dedicated volume** to this service at `/data`. Do not reuse the existing 42-BOT or Postgres volumes.

Without a persistent volume, WhatsApp credentials can be lost when the container is replaced. Never share the API key or session files. Do not expose pairing endpoints publicly without the bearer token.

## API

All endpoints except `/health` require `Authorization: Bearer <RIMURU_API_KEY>`.

- `GET /health` — public liveness check.
- `GET /api/status` — connection state; includes the QR payload while QR pairing is pending.
- `POST /api/pairing/qr` — starts QR pairing. Poll `/api/status` for `qr`.
- `POST /api/pairing/code` — JSON body `{"phone":"263771234567"}`; country code required, digits only, 8–15 digits.

Phone pairing instructions (Messenger or Business app): Settings → Linked Devices → Link a Device → Link with phone number instead. QR pairing uses the same Linked Devices screen.

## Development

The Railway `prestart` hook runs the worker test suite before each start; a failing test prevents the worker from starting.

```sh
npm test
npm start
```

The WhatsApp Web protocol is not an official WhatsApp Business API. Use an account you control, comply with WhatsApp's terms, and expect protocol changes to occasionally require dependency updates.
