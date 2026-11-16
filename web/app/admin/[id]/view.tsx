"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiError, adminToken, api, clearAdminToken } from "@/lib/api";
import { demoAdmin, isDemo } from "@/lib/demo";
import { CATEGORIES, type AdminReport, type Report } from "@/lib/types";

export function AdminReportView({ id }: { id: string }) {
  const seeded = isDemo() ? demoAdmin(id) : null;
  const [ready, setReady] = useState(isDemo());
  const [token, setToken] = useState(isDemo() ? "demo" : "");
  const [report, setReport] = useState<AdminReport | null>(seeded);
  const [title, setTitle] = useState(seeded?.title ?? "");
  const [body, setBody] = useState(seeded?.body ?? "");
  const [category, setCategory] = useState(seeded?.category ?? "");
  const [agency, setAgency] = useState(seeded?.agency ?? "");
  const [place, setPlace] = useState(seeded?.place ?? "");
  const [occurredOn, setOccurredOn] = useState(seeded?.occurred_on ?? "");
  const [sourceLinks, setSourceLinks] = useState(seeded?.source_links ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (isDemo()) {
      if (sessionStorage.getItem("demo-signed-out") === "1") {
        setToken("");
      }
      setReady(true);
      if (sessionStorage.getItem("demo-signed-out") === "1") {
        return;
      }
    } else {
      const stored = adminToken();
      setToken(stored);
      setReady(true);
      if (!stored || !id) {
        return;
      }
    }
    if (!id) {
      return;
    }
    const session = isDemo() ? "demo" : adminToken();
    api<AdminReport>(`/admin/reports/${id}`, {}, session)
      .then((data) => {
        setReport(data);
        fill(data);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.message.includes("admin session")) {
          clearAdminToken();
          setToken("");
        }
        setError(err instanceof ApiError ? err.message : "The report failed to load.");
      });
  }, [id]);

  function fill(data: AdminReport) {
    setTitle(data.title);
    setBody(data.body);
    setCategory(data.category);
    setAgency(data.agency);
    setPlace(data.place);
    setOccurredOn(data.occurred_on);
    setSourceLinks(data.source_links);
  }

  async function save(status: Report["status"]) {
    setError("");
    setPending(true);
    try {
      const data = await api<AdminReport>(
        `/admin/reports/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title,
            body,
            category,
            agency,
            place,
            occurred_on: occurredOn,
            source_links: sourceLinks,
            note,
            status,
          }),
        },
        token,
      );
      setReport(data);
      fill(data);
      setNote("");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "The change could not be saved.");
    } finally {
      setPending(false);
    }
  }

  if (!ready) {
    return (
      <Shell>
        <p className="muted">Loading the report.</p>
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell>
        <p>
          <Link href="/admin">Sign in</Link> to review this report.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p>
        <Link href="/admin">Back to the queue</Link>
      </p>
      <h1>Review report</h1>
      {error ? <p className="error">{error}</p> : null}
      {!report && !error ? <p className="muted">Loading the report.</p> : null}
      {report ? (
        <div className="stack">
          <p className="meta">Status: {report.status}</p>
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
          </label>
          <label>
            What happened
            <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">None</option>
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agency
            <input value={agency} onChange={(event) => setAgency(event.target.value)} maxLength={200} />
          </label>
          <label>
            Place
            <input value={place} onChange={(event) => setPlace(event.target.value)} maxLength={200} />
          </label>
          <label>
            Date
            <input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} />
          </label>
          <label>
            Source links
            <input value={sourceLinks} onChange={(event) => setSourceLinks(event.target.value)} maxLength={1000} />
          </label>
          <label>
            Note for the review log
            <input value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className="actions">
            <button type="button" className="secondary" disabled={pending} onClick={() => save(report.status)}>
              Save
            </button>
            <button type="button" disabled={pending} onClick={() => save("published")}>
              Publish
            </button>
            <button type="button" className="secondary" disabled={pending} onClick={() => save("rejected")}>
              Reject
            </button>
            {report.status === "published" ? (
              <button type="button" className="secondary" disabled={pending} onClick={() => save("pending")}>
                Unpublish
              </button>
            ) : null}
          </div>
          {report.actions.length > 0 ? (
            <div>
              <h2>Review log</h2>
              <ul className="history">
                {report.actions.map((action, index) => (
                  <li key={`${action.at}-${index}`}>
                    {action.action}
                    {action.note ? ` — ${action.note}` : ""} · {action.at}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Shell>
  );
}
