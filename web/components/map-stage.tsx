"use client";

import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  GeoJSONSource,
  Map,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { boxCollection, gridCollection, type Bounds, type CountMark } from "@/lib/area";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
setWorkerUrl(`${basePath}/maplibre-gl-worker.mjs`);

type Label = {
  id: string;
  count: number;
  x: number;
  y: number;
};

type MapStageProps = {
  marks: CountMark[];
  selected: CountMark | null;
  center: [number, number];
  focus: { longitude: number; latitude: number; zoom: number } | null;
  onPick: (latitude: number, longitude: number) => void;
  onCount: (id: string) => void;
  onZoom: (zoom: number) => void;
  onSettle: (bounds: Bounds) => void;
  onGrid: (visible: boolean) => void;
};

const EMPTY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export default function MapStage({
  marks,
  selected,
  center,
  focus,
  onPick,
  onCount,
  onZoom,
  onSettle,
  onGrid,
}: MapStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const centerRef = useRef(center);
  const [mapReady, setMapReady] = useState<Map | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const marksRef = useRef(marks);
  const onPickRef = useRef(onPick);
  const onSettleRef = useRef(onSettle);
  const onZoomRef = useRef(onZoom);
  const onGridRef = useRef(onGrid);

  useEffect(() => {
    marksRef.current = marks;
    onPickRef.current = onPick;
    onSettleRef.current = onSettle;
    onZoomRef.current = onZoom;
    onGridRef.current = onGrid;
  }, [marks, onPick, onSettle, onZoom, onGrid]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = new Map({
      container,
      center: centerRef.current,
      zoom: 16,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });

    map.addControl(new AttributionControl({ compact: false }), "bottom-left");
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.getCanvas().style.cursor = "pointer";

    map.on("load", () => {
      map.resize();
      map.addSource("busy", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "busy",
        type: "fill",
        source: "busy",
        paint: { "fill-color": "#c44736", "fill-opacity": 0.22 },
      });
      map.addSource("grid", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "grid",
        type: "line",
        source: "grid",
        paint: {
          "line-color": "#241f1a",
          "line-opacity": 0.28,
          "line-width": 1,
        },
      });
      map.addSource("selected", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "selected",
        type: "line",
        source: "selected",
        paint: {
          "line-color": "#241f1a",
          "line-width": 2,
          "line-dasharray": [1.4, 1.1],
        },
      });
      setMapReady(map);
    });

    map.on("click", (event) => {
      onPickRef.current(event.lngLat.lat, event.lngLat.lng);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(null);
    };
  }, []);

  useEffect(() => {
    const map = mapReady;
    if (!map) return;

    let frame = 0;
    const draw = (settle: boolean) => {
      const bounds = map.getBounds();
      const box = {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      };
      const grid = gridCollection(box);
      geojsonSource(map, "grid").setData(grid);
      onGridRef.current(grid.features.length > 0);
      onZoomRef.current(map.getZoom());
      if (settle) onSettleRef.current(box);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setLabels(projectLabels(map, marksRef.current));
      });
    };

    const onMove = () => draw(false);
    const onMoveEnd = () => draw(true);
    map.on("move", onMove);
    map.on("moveend", onMoveEnd);
    draw(true);
    return () => {
      map.off("move", onMove);
      map.off("moveend", onMoveEnd);
      cancelAnimationFrame(frame);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapReady;
    if (!map) return;
    geojsonSource(map, "busy").setData(boxCollection(marks));
    const frame = requestAnimationFrame(() => {
      setLabels(projectLabels(map, marks));
    });
    return () => cancelAnimationFrame(frame);
  }, [mapReady, marks]);

  useEffect(() => {
    const map = mapReady;
    if (!map) return;
    geojsonSource(map, "selected").setData(boxCollection(selected ? [selected] : []));
  }, [mapReady, selected]);

  useEffect(() => {
    const map = mapReady;
    if (!map || !focus) return;
    map.flyTo({ center: [focus.longitude, focus.latitude], zoom: focus.zoom });
  }, [mapReady, focus]);

  return (
    <div className="map-stage">
      <div ref={containerRef} className="map-canvas" />
      <div className="count-layer">
        {labels.map((label) => (
          <button
            key={label.id}
            type="button"
            className="count-label"
            style={{ left: label.x, top: label.y }}
            aria-label={`${label.count} published`}
            onClick={(event) => {
              event.stopPropagation();
              onCount(label.id);
            }}
          >
            {label.count}
          </button>
        ))}
      </div>
    </div>
  );
}

function geojsonSource(map: Map, id: string): GeoJSONSource {
  const source = map.getSource(id);
  if (!source || source.type !== "geojson") {
    throw new Error(`Missing GeoJSON source ${id}`);
  }
  return source as GeoJSONSource;
}

function projectLabels(map: Map, marks: CountMark[]): Label[] {
  return marks.map((mark) => {
    const projected = map.project([
      mark.west + mark.lngSpan / 2,
      mark.south + mark.latSpan / 2,
    ]);
    return { id: mark.id, count: mark.count, x: projected.x, y: projected.y };
  });
}
