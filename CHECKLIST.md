# Corruption database

Checklist for a new app, forked in spirit from [dao-ci-yi-you](https://github.com/iravan/dao-ci-yi-you). That project is a 24-hour, GPS-gated chat: Redis deletes every comment, a token lottery decides who may write, and there is no admin role.

This app is a self-hosted corruption database. Anyone can submit a report. An admin reviews it before it is public.

Treat every submission as an unpublished allegation until an admin publishes it. The public site shows only published reports, and each one is labeled as an allegation.

## 1. Fork and rename

- [x] New git repo. Do not keep pushing to dao-ci-yi-you.
- [x] New name, README, and page title. Remove 到此一遊, the map, and the token copy.
- [x] New env files from `server/.env.example` and `web/.env.example` in the source repo. Do not copy secrets.
- [x] The source repo has no `LICENSE` file. Add one here before anyone else contributes.

## 2. Lock the product rules

- [x] Anyone can submit. No account, no GPS, no token.
- [x] A new report is `pending`. It is invisible on the public site.
- [x] An admin can redact, reject, publish, and unpublish.
- [x] The public page shows status `published` only.
- [x] The public record stores no reporter name, email, phone, or account id.
- [x] Optional reporter contact is a separate private field, visible only in the admin site.
- [x] Refuse national ID numbers, home addresses, and private phone numbers in the public text. Admin redacts anything that slips through before publish.
- [x] Each published page says the text is an allegation, not a finding.
- [x] No file uploads in the first version. A report is text plus optional source links.

## 3. Replace the data model

Keep Axum. Replace Redis as the record store. Comments in the source live in keys with a 24-hour TTL (`comment:{id}`, `EX 86400` in `server/src/store.rs`). That cannot be the database.

- [x] One SQLite file on the server. Use Postgres only if more than one API process will run.
- [x] Table `reports`: `id`, `created_at`, `updated_at`, `status` (`pending`, `published`, `rejected`), `title`, `body`, `category`, `agency`, `place`, `occurred_on`, `source_links`.
- [x] Table `report_private`: `report_id`, `contact`, `submitter_ip_hash`. Never selected by public routes.
- [x] Table `admin_actions`: `report_id`, `admin_id`, `action`, `note`, `at`.
- [x] Status changes are the only way a report becomes public. No TTL, no sweep that deletes reports.

## 4. Cut the chat machinery

Delete these from the new app. They are the whole current product and do not map onto reports.

- [x] Server: area snap (`server/src/area.rs`), presence, token draw, comment sweep, and the 60-second clock in `server/src/lib.rs`.
- [x] Server: WebSocket hub (`server/src/hub.rs`) and the socket route in `server/src/routes.rs`.
- [x] Server: Supabase JWKS login for the public (`server/src/auth.rs`). Public `POST` does not use it.
- [x] Web: MapLibre, grid, GPS, comment sheet, token notice, demo mode (`web/components/map-stage.tsx`, `comment-sheet.tsx`, `token-notice.tsx`, `web/lib/area.ts`, `web/app/demo/page.tsx`).
- [x] Web: `@supabase/supabase-js` unless Supabase is kept for the admin login only.
- [x] GitHub Pages workflow (`.github/workflows/pages.yml`). A database needs the Rust process running. Pages can only host a static shell.

## 5. Public site

One Next.js app, two public routes plus the form.

- [x] `/` lists published reports: title, category, agency, place, date. Newest first.
- [x] `/reports/[id]` shows one published report, with the allegation label.
- [x] `/report` is the form: title, body, category, agency, place, date, source links, optional contact.
- [x] Submit calls `POST /reports` with no auth header.
- [x] Success copy says the report is queued and is not public yet. Do not show the private id in a guessable public URL until it is published.
- [x] Empty title or body is rejected in the form and again in Rust. Cap body length (for example 4,000 characters).
- [x] Rate-limit `POST /reports` per IP. A simple in-process limit is enough for one server.

## 6. Admin site

New routes, not a mode of the map.

- [x] `/admin` requires an admin session. Everyone else gets the public site only.
- [x] One admin allowlist is enough: a password checked by Axum, or one OIDC login whose subject is in `ADMIN_SUBJECTS`. Do not offer Apple, Google, and Facebook to the public.
- [x] Queue: `pending` reports, oldest first. Show private contact here only.
- [x] Detail: edit public fields, redact, then reject or publish. Both actions write `admin_actions`.
- [x] Published list: unpublish sends the report back to `pending` and removes it from `/`.
- [x] Rejected list stays in the admin site. It never appears on `/`.

## 7. API

Replace the area routes in `server/src/routes.rs`.

- [x] `GET /reports` returns published reports only. No contact, no IP hash, no admin notes.
- [x] `GET /reports/{id}` returns the same shape, or 404 when the report is not published.
- [x] `POST /reports` accepts the public fields plus optional `contact`. Writes `pending`. Returns `{ "id", "status": "pending" }`.
- [x] `GET /admin/reports?status=` returns the queue, including private fields.
- [x] `PATCH /admin/reports/{id}` updates text and status. Require the admin session.
- [x] CORS stays as it is now: `CORS_ORIGINS` lists the Next.js origin only.
- [x] Rewrite `server/tests/flow.rs`. The current tests cover tokens, GPS mismatch, and the 24-hour expiry. New tests: anonymous create stays unpublished, public `GET` hides pending and rejected, admin publish makes it visible, unpublish hides it again.

## 8. Self-host

- [x] One machine runs three things: the Axum process, the Next.js server, and the SQLite file on a persistent disk.
- [x] Bind Axum to localhost. The default `BIND` is `127.0.0.1:8787`.
- [ ] Put TLS and the public hostname on a reverse proxy.
- [x] Env: `BIND`, `DATABASE_PATH`, `CORS_ORIGINS`, and `ADMIN_PASSWORD`. `REDIS_URL`, `SUPABASE_JWKS_URL`, and `JWT_HS_SECRET` are gone.
- [x] Web env: `NEXT_PUBLIC_API_URL` points at the public API origin.
- [ ] Back up the SQLite file on a schedule. Redis in the source repo is disposable; the new file is the record.
- [x] Logs must not print report bodies or reporter contact.

## 9. Done when

- [x] A visitor with no account can submit, and the report does not appear on `/`.
- [x] An admin can redact and publish it, and `/reports/{id}` shows the allegation label.
- [x] Unpublish or reject removes it from the public list and the public detail URL.
- [x] The public JSON has no contact and no admin note.
- [x] Restarting the server keeps the report.
