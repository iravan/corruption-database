# Corruption database

Checklist for a new app, forked in spirit from [dao-ci-yi-you](https://github.com/iravan/dao-ci-yi-you). That project is a 24-hour, GPS-gated chat: Redis deletes every comment, a token lottery decides who may write, and there is no admin role.

This app is a self-hosted corruption database. Anyone can submit a report. An admin reviews it before it is public.

Treat every submission as an unpublished allegation until an admin publishes it. The public site shows only published reports, and each one is labeled as an allegation.

## 1. Fork and rename

- [ ] New git repo. Do not keep pushing to dao-ci-yi-you.
- [ ] New name, README, and page title. Remove 到此一遊, the map, and the token copy.
- [ ] New env files from `server/.env.example` and `web/.env.example` in the source repo. Do not copy secrets.
- [ ] The source repo has no `LICENSE` file. Add one here before anyone else contributes.

## 2. Lock the product rules

- [ ] Anyone can submit. No account, no GPS, no token.
- [ ] A new report is `pending`. It is invisible on the public site.
- [ ] An admin can redact, reject, publish, and unpublish.
- [ ] The public page shows status `published` only.
- [ ] The public record stores no reporter name, email, phone, or account id.
- [ ] Optional reporter contact is a separate private field, visible only in the admin site.
- [ ] Refuse national ID numbers, home addresses, and private phone numbers in the public text. Admin redacts anything that slips through before publish.
- [ ] Each published page says the text is an allegation, not a finding.
- [ ] No file uploads in the first version. A report is text plus optional source links.

## 3. Replace the data model

Keep Axum. Replace Redis as the record store. Comments in the source live in keys with a 24-hour TTL (`comment:{id}`, `EX 86400` in `server/src/store.rs`). That cannot be the database.

- [ ] One SQLite file on the server. Use Postgres only if more than one API process will run.
- [ ] Table `reports`: `id`, `created_at`, `updated_at`, `status` (`pending`, `published`, `rejected`), `title`, `body`, `category`, `agency`, `place`, `occurred_on`, `source_links`.
- [ ] Table `report_private`: `report_id`, `contact`, `submitter_ip_hash`. Never selected by public routes.
- [ ] Table `admin_actions`: `report_id`, `admin_id`, `action`, `note`, `at`.
- [ ] Status changes are the only way a report becomes public. No TTL, no sweep that deletes reports.

## 4. Cut the chat machinery

Delete these from the new app. They are the whole current product and do not map onto reports.

- [ ] Server: area snap (`server/src/area.rs`), presence, token draw, comment sweep, and the 60-second clock in `server/src/lib.rs`.
- [ ] Server: WebSocket hub (`server/src/hub.rs`) and the socket route in `server/src/routes.rs`.
- [ ] Server: Supabase JWKS login for the public (`server/src/auth.rs`). Public `POST` does not use it.
- [ ] Web: MapLibre, grid, GPS, comment sheet, token notice, demo mode (`web/components/map-stage.tsx`, `comment-sheet.tsx`, `token-notice.tsx`, `web/lib/area.ts`, `web/app/demo/page.tsx`).
- [ ] Web: `@supabase/supabase-js` unless Supabase is kept for the admin login only.
- [ ] GitHub Pages workflow (`.github/workflows/pages.yml`). A database needs the Rust process running. Pages can only host a static shell.

## 5. Public site

One Next.js app, two public routes plus the form.

- [ ] `/` lists published reports: title, category, agency, place, date. Newest first.
- [ ] `/reports/[id]` shows one published report, with the allegation label.
- [ ] `/report` is the form: title, body, category, agency, place, date, source links, optional contact.
- [ ] Submit calls `POST /reports` with no auth header.
- [ ] Success copy says the report is queued and is not public yet. Do not show the private id in a guessable public URL until it is published.
- [ ] Empty title or body is rejected in the form and again in Rust. Cap body length (for example 4,000 characters).
- [ ] Rate-limit `POST /reports` per IP. A simple in-process limit is enough for one server.

## 6. Admin site

New routes, not a mode of the map.

- [ ] `/admin` requires an admin session. Everyone else gets the public site only.
- [ ] One admin allowlist is enough: a password checked by Axum, or one OIDC login whose subject is in `ADMIN_SUBJECTS`. Do not offer Apple, Google, and Facebook to the public.
- [ ] Queue: `pending` reports, oldest first. Show private contact here only.
- [ ] Detail: edit public fields, redact, then reject or publish. Both actions write `admin_actions`.
- [ ] Published list: unpublish sends the report back to `pending` and removes it from `/`.
- [ ] Rejected list stays in the admin site. It never appears on `/`.

## 7. API

Replace the area routes in `server/src/routes.rs`.

- [ ] `GET /reports` returns published reports only. No contact, no IP hash, no admin notes.
- [ ] `GET /reports/{id}` returns the same shape, or 404 when the report is not published.
- [ ] `POST /reports` accepts the public fields plus optional `contact`. Writes `pending`. Returns `{ "id", "status": "pending" }`.
- [ ] `GET /admin/reports?status=` returns the queue, including private fields.
- [ ] `PATCH /admin/reports/{id}` updates text and status. Require the admin session.
- [ ] CORS stays as it is now: `CORS_ORIGINS` lists the Next.js origin only.
- [ ] Rewrite `server/tests/flow.rs`. The current tests cover tokens, GPS mismatch, and the 24-hour expiry. New tests: anonymous create stays unpublished, public `GET` hides pending and rejected, admin publish makes it visible, unpublish hides it again.

## 8. Self-host

- [ ] One machine runs three things: the Axum process, the Next.js server, and the SQLite file on a persistent disk.
- [ ] Bind Axum to localhost. Put TLS and the public hostname on a reverse proxy.
- [ ] Env: `BIND`, `DATABASE_PATH`, `CORS_ORIGINS`, `ADMIN_PASSWORD_HASH` or `ADMIN_SUBJECTS`. Delete `REDIS_URL`, `SUPABASE_JWKS_URL`, and `JWT_HS_SECRET` if Supabase is gone.
- [ ] Web env: `NEXT_PUBLIC_API_URL` points at the public API origin.
- [ ] Back up the SQLite file on a schedule. Redis in the source repo is disposable; the new file is the record.
- [ ] Logs must not print report bodies or reporter contact.

## 9. Done when

- [ ] A visitor with no account can submit, and the report does not appear on `/`.
- [ ] An admin can redact and publish it, and `/reports/{id}` shows the allegation label.
- [ ] Unpublish or reject removes it from the public list and the public detail URL.
- [ ] The public JSON has no contact and no admin note.
- [ ] Restarting the server keeps the report.
