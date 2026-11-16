"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiError, api } from "@/lib/api";
import { demoPublic, isDemo } from "@/lib/demo";
import { formatBlock } from "@/lib/area";
import type { Report } from "@/lib/types";

export function ReportView({ id }: { id: string }) {
  const seeded = isDemo() ? demoPublic(id) : null;
  const [report, setReport] = useState<Report | null>(seeded);
  const [error, setError] = useState(isDemo() && !seeded ? "That report is not public." : "");

  useEffect(() => {
    if (!id) {
      return;
    }
    api<Report>(`/reports/${id}`)
      .then(setReport)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "The report failed to load.");
      });
  }, [id]);

  return (
    <Shell>
      <p className="allegation">
        This page is an allegation submitted by a member of the public. It is not a finding.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {!report && !error ? <p className="muted">Loading the report.</p> : null}
      {report ? (
        <>
          <h1>{report.title}</h1>
          <dl>
            {report.category ? (
              <div>
                <dt>Category</dt>
                <dd>{report.category}</dd>
              </div>
            ) : null}
            {report.agency ? (
              <div>
                <dt>Agency</dt>
                <dd>{report.agency}</dd>
              </div>
            ) : null}
            {report.area ? (
              <div>
                <dt>Block</dt>
                <dd>{formatBlock(report.area)}</dd>
              </div>
            ) : null}
            {report.place ? (
              <div>
                <dt>Place</dt>
                <dd>{report.place}</dd>
              </div>
            ) : null}
            {report.occurred_on ? (
              <div>
                <dt>Date</dt>
                <dd>{report.occurred_on}</dd>
              </div>
            ) : null}
            <div>
              <dt>Report</dt>
              <dd>{report.body}</dd>
            </div>
            {report.source_links ? (
              <div>
                <dt>Source links</dt>
                <dd>{report.source_links}</dd>
              </div>
            ) : null}
          </dl>
        </>
      ) : null}
    </Shell>
  );
}
