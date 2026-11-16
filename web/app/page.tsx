"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useState } from "react";
import { formatBlock, type Bounds } from "@/lib/area";
import { ApiError, api } from "@/lib/api";
import { isDemo } from "@/lib/demo";
import { meta, type Report } from "@/lib/types";

const MapStage = dynamic(() => import("@/components/map-stage"), { ssr: false });

type AreaCount = {
  area: string;
  count: number;
  south: number;
  west: number;
};

const CENTER: [number, number] = [114.1694, 22.3194];

export default function HomePage() {
  const [areas, setAreas] = useState<AreaCount[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [grid, setGrid] = useState(true);
  const [error, setError] = useState("");

  const onSettle = useCallback((bounds: Bounds) => {
    const query = new URLSearchParams({
      south: String(bounds.south),
      west: String(bounds.west),
      north: String(bounds.north),
      east: String(bounds.east),
    });
    api<{ areas: AreaCount[] }>(`/areas?${query}`)
      .then((data) => setAreas(data.areas))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "The map failed to load.");
      });
  }, []);

  const onSelect = useCallback((area: string) => {
    setSelected(area);
    setReports(null);
    api<{ reports: Report[] }>(`/areas/${encodeURIComponent(area)}/reports`)
      .then((data) => setReports(data.reports))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "That block failed to load.");
      });
  }, []);

  return (
    <div className="map-page">
      <header className="map-bar">
        <div className="map-bar-row">
          <Link className="brand" href="/">
            Corruption database
          </Link>
          <nav className="nav">
            <Link href="/admin">Admin</Link>
          </nav>
        </div>
        {isDemo() ? (
          <p className="demo-banner">Demo. These reports are examples. Nothing you type is stored.</p>
        ) : null}
        <p className="allegation">Every report on this map is an allegation. It is not a finding.</p>
        {error ? <p className="error">{error}</p> : null}
        {grid ? null : <p className="help">Zoom in to choose a block.</p>}
      </header>
      <MapStage
        busy={areas}
        selectedArea={selected}
        center={CENTER}
        onSelect={onSelect}
        onSettle={onSettle}
        onGrid={setGrid}
      />
      {selected ? (
        <aside className="sheet">
          <p className="meta">{formatBlock(selected)}</p>
          <p>
            <Link href={`/report?area=${encodeURIComponent(selected)}`}>Report this block</Link>
          </p>
          {reports === null ? <p className="muted">Loading reports.</p> : null}
          {reports?.length === 0 ? <p className="muted">No published allegations in this block.</p> : null}
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
        </aside>
      ) : null}
    </div>
  );
}
