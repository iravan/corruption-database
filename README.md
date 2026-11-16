# Corruption database

A self-hosted database of corruption reports. Anyone can submit a report. An admin reviews it before it is public. A published report is an allegation, not a finding.

This app was started from [dao-ci-yi-you](https://github.com/iravan/dao-ci-yi-you), which is a 24-hour location chat. The chat, the map, the token draw, and Redis are gone. The record is a SQLite file. The build checklist is [CHECKLIST.md](CHECKLIST.md).

## Run

One machine runs the Axum process, the Next.js server, and the SQLite file.

```sh
cp server/.env.example server/.env
# set ADMIN_PASSWORD in server/.env
cargo run --manifest-path server/Cargo.toml

cp web/.env.example web/.env.local
cd web && bun install && bun run dev
```

The API listens on `127.0.0.1:8787`. Open the page at `http://127.0.0.1:3000`. Put TLS and the public hostname on a reverse proxy in front of both processes. Back up `data/reports.sqlite`. A report is anonymous: the file has no contact and no IP address. The server does not print report text.

## Demo

GitHub Pages serves a static demo of the public site and the admin panel. The reports there are examples. Nothing is written to a database.

https://iravan.github.io/corruption-database/

The admin demo is already signed in. After signing out, the password is `demo`.
