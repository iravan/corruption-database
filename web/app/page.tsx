"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReportForm } from "@/components/report-form";
import { ReportSheet } from "@/components/report-sheet";
import { ReportBody } from "@/app/reports/[id]/view";
import {
  areaId,
  binSize,
  clusterCounts,
  corner,
  markContains,
  STEP,
  type Bounds,
  type CountMark,
} from "@/lib/area";
import { ApiError, api } from "@/lib/api";
import { isDemo } from "@/lib/demo";
import type { Report } from "@/lib/types";

const MapStage = dynamic(() => import("@/components/map-stage"), { ssr: false });

type AreaCount = {
  area: string;
  count: number;
};

type Focus = { longitude: number; latitude: number; zoom: number };

const CENTER: [number, number] = [114.1694, 22.3194];

export default function HomePage() {
  const [cells, setCells] = useState<AreaCount[]>([]);
  const [zoom, setZoom] = useState(16);
  const [selected, setSelected] = useState<CountMark | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [detail, setDetail] = useState<Report | null>(null);
  const [composing, setComposing] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [grid, setGrid] = useState(true);
  const [error, setError] = useState("");
  const marks = useMemo(() => clusterCounts(cells, zoom), [cells, zoom]);

  const onSettle = useCallback((bounds: Bounds) => {
    const query = new URLSearchParams({
      south: String(bounds.south),
      west: String(bounds.west),
      north: String(bounds.north),
      east: String(bounds.east),
    });
    api<{ areas: AreaCount[] }>(`/areas?${query}`)
      .then((data) => setCells(data.areas))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "The map failed to load.");
      });
  }, []);

  const openMark = useCallback((mark: CountMark) => {
    setSelected(mark);
    setDetail(null);
    setComposing(false);
    setReports(null);
    setError("");
    Promise.all(
      mark.areas.map((area) => api<{ reports: Report[] }>(`/areas/${encodeURIComponent(area)}/reports`)),
    )
      .then((pages) => setReports(pages.flatMap((page) => page.reports)))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "That block failed to load.");
      });
  }, []);

  const onPick = useCallback(
    (latitude: number, longitude: number) => {
      const hit = marks.find((mark) => markContains(mark, latitude, longitude));
      if (hit) {
        openMark(hit);
        return;
      }
      if (binSize(zoom) !== 1) return;
      const area = areaId(latitude, longitude);
      const point = corner(area);
      if (!point) return;
      openMark({
        id: area,
        count: 0,
        areas: [area],
        south: point.latitude,
        west: point.longitude,
        latSpan: STEP,
        lngSpan: STEP,
      });
    },
    [marks, openMark, zoom],
  );

  const onCount = useCallback(
    (id: string) => {
      const mark = marks.find((item) => item.id === id);
      if (mark) openMark(mark);
    },
    [marks, openMark],
  );

  function reportHere() {
    if (!selected) return;
    if (selected.areas.length === 1) {
      setComposing(true);
      return;
    }
    setFocus({
      longitude: selected.west + selected.lngSpan / 2,
      latitude: selected.south + selected.latSpan / 2,
      zoom: 16,
    });
    setSelected(null);
  }

  const bin = binSize(zoom);
  const binRef = useRef(bin);
  useEffect(() => {
    if (binRef.current === bin) return;
    binRef.current = bin;
    setSelected(null);
    setDetail(null);
    setComposing(false);
  }, [bin]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (composing) {
        setComposing(false);
        return;
      }
      if (detail) {
        setDetail(null);
        return;
      }
      setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composing, detail]);

  const modal = detail ? (
    <div className="modal-back" onClick={() => setDetail(null)}>
      <div
        className="modal-card"
        role="dialog"
        aria-label={detail.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <button type="button" className="text-button" onClick={() => setDetail(null)}>
            Close
          </button>
        </div>
        <p className="allegation">
          This is an allegation submitted by a member of the public. It is not a finding.
        </p>
        <ReportBody report={detail} />
      </div>
    </div>
  ) : composing && selected?.areas.length === 1 ? (
    <div className="modal-back" onClick={() => setComposing(false)}>
      <div className="modal-card" role="dialog" aria-label="Report corruption" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h1>Report corruption</h1>
          <button type="button" className="text-button" onClick={() => setComposing(false)}>
            Close
          </button>
        </div>
        <ReportForm area={selected.areas[0]} />
      </div>
    </div>
  ) : null;

  return (
    <div className={`map-page${selected ? " sheet-open" : ""}`}>
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
        {error && !selected ? <p className="error">{error}</p> : null}
        {grid ? null : <p className="help">Zoom in to choose a block.</p>}
      </header>
      <MapStage
        marks={marks}
        selected={selected}
        center={CENTER}
        focus={focus}
        onPick={onPick}
        onCount={onCount}
        onZoom={setZoom}
        onSettle={onSettle}
        onGrid={setGrid}
      />
      {selected ? (
        <ReportSheet
          mark={selected}
          reports={reports}
          error={selected ? error : ""}
          onClose={() => {
            setSelected(null);
            setDetail(null);
            setComposing(false);
          }}
          onOpen={setDetail}
          onReport={reportHere}
        />
      ) : null}
      {modal}
    </div>
  );
}
