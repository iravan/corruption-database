"use client";

import { FormEvent, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiError, api } from "@/lib/api";
import { CATEGORIES } from "@/lib/types";

const BODY_MAX = 4000;

export default function ReportPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [agency, setAgency] = useState("");
  const [place, setPlace] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [sourceLinks, setSourceLinks] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [queued, setQueued] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!title.trim() || !body.trim()) {
      setError("A title and a report are required.");
      return;
    }
    if (body.trim().length > BODY_MAX) {
      setError("The report is too long.");
      return;
    }
    setPending(true);
    try {
      await api("/reports", {
        method: "POST",
        body: JSON.stringify({
          title,
          body,
          category,
          agency,
          place,
          occurred_on: occurredOn,
          source_links: sourceLinks,
        }),
      });
      setQueued(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "The report could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Shell>
      <h1>Report corruption</h1>
      {queued ? (
        <p className="success">
          Your anonymous report is queued for review. It is not public.
        </p>
      ) : (
        <form onSubmit={onSubmit}>
          <p className="help">
            A report is anonymous. Do not include your name, phone number,
            identity number, or home address.
          </p>
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
          </label>
          <label>
            What happened
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={BODY_MAX}
              required
            />
          </label>
          <p className="help">{body.trim().length} / {BODY_MAX}</p>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Choose one</option>
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
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={pending}>
            {pending ? "Sending" : "Submit report"}
          </button>
        </form>
      )}
    </Shell>
  );
}
