"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiError, api } from "@/lib/api";
import { meta, type Report } from "@/lib/types";

export default function HomePage() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ reports: Report[] }>("/reports")
      .then((data) => setReports(data.reports))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "The list failed to load.");
      });
  }, []);

  return (
    <Shell>
      <h1>Published reports</h1>
      <p className="allegation">
        Every report on this site is an allegation. It is not a finding.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {reports === null && !error ? <p className="muted">Loading reports.</p> : null}
      {reports?.length === 0 ? <p className="muted">No published reports.</p> : null}
      <ul className="list">
        {reports?.map((report) => (
          <li key={report.id}>
            <Link className="card" href={`/reports/${report.id}`}>
              <h2>{report.title}</h2>
              <p className="meta">{meta(report)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
