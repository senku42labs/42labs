# RIMURU TEMPEST MD — Worker

This is the isolated Railway worker service for RIMURU TEMPEST MD.

## Current scope

- Node.js HTTP health endpoint at `/health`.
- Intended to run independently from the existing 42-BOT service.
- Does not connect to WhatsApp, Postgres, or any other existing service yet.

## Run

```sh
npm start
```

Railway should use this directory as the service root and `npm start` as the start command.
