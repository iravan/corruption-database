"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiError, adminToken, api, clearAdminToken, setAdminToken } from "@/lib/api";
import { meta, type AdminListItem } from "@/lib/types";

const STATUSES = ["pending", "published", "rejected"] as const;

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  const [reports, setReports] = useState<AdminListItem[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setToken(adminToken());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    setReports(null);
    setError("");
    api<{ reports: AdminListItem[] }>(`/admin/reports?status=${status}`, {}, token)
      .then((data) => setReports(data.reports))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.message.includes("admin session")) {
          clearAdminToken();
          setToken("");
        }
        setError(err instanceof ApiError ? err.message : "The queue failed to load.");
      });
  }, [token, status]);

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const session = await api<{ token: string }>("/admin/session", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setAdminToken(session.token);
      setToken(session.token);
      setPassword("");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  }

  async function onSignOut() {
    if (token) {
      await api("/admin/session", { method: "DELETE" }, token).catch(() => undefined);
    }
    clearAdminToken();
    setToken("");
    setReports(null);
  }

  return (
    <Shell>
      <h1>Review queue</h1>
      {!ready ? <p className="muted">Loading the queue.</p> : null}
      {ready && !token ? (
        <form onSubmit={onLogin}>
          <label>
            Admin password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={pending}>
            {pending ? "Checking" : "Sign in"}
          </button>
        </form>
      ) : null}
      {ready && token ? (
        <div className="stack">
          <div className="actions">
            {STATUSES.map((item) => (
              <button
                key={item}
                type="button"
                className={item === status ? undefined : "secondary"}
                onClick={() => setStatus(item)}
              >
                {item}
              </button>
            ))}
            <button type="button" className="secondary" onClick={onSignOut}>
              Sign out
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
          {reports === null && !error ? <p className="muted">Loading the queue.</p> : null}
          {reports?.length === 0 ? <p className="muted">Nothing in this list.</p> : null}
          <ul className="list">
            {reports?.map((report) => (
              <li key={report.id}>
                <Link className="card" href={`/admin/${report.id}`}>
                  <h2>{report.title}</h2>
                  <p className="meta">{meta(report)}</p>
                  <p className="meta">Contact: {report.contact || "none"}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Shell>
  );
}
