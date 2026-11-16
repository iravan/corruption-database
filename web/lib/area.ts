/** Degrees. Matches the server cell size. The server still decides the area. */
export const STEP = 0.001;

/** Hide the line grid above this many cells on one axis. Busy cells still draw. */
export const GRID_CELL_CAP = 80;

export type Cell = {
  latCell: number;
  lngCell: number;
};

export type Bounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

const EMPTY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export function cellIndex(value: number): number {
  const scaled = value / STEP;
  const nearest = Math.round(scaled);
  if (Math.abs(scaled - nearest) < 1e-6) return nearest;
  return Math.floor(scaled);
}

/** `floor(lat / step):floor(lng / step)`. Preview for drawing. Rust recomputes this. */
export function areaId(latitude: number, longitude: number): string {
  return `${cellIndex(latitude)}:${cellIndex(longitude)}`;
}

export function parseArea(area: string): Cell | null {
  const parts = area.split(":");
  if (parts.length !== 2) return null;
  const latCell = Number(parts[0]);
  const lngCell = Number(parts[1]);
  if (!Number.isInteger(latCell) || !Number.isInteger(lngCell)) return null;
  if (String(latCell) !== parts[0] || String(lngCell) !== parts[1]) return null;
  return { latCell, lngCell };
}

export function southwest(cell: Cell): { latitude: number; longitude: number } {
  return {
    latitude: cell.latCell * STEP,
    longitude: cell.lngCell * STEP,
  };
}

export function corner(area: string): { latitude: number; longitude: number } | null {
  const cell = parseArea(area);
  return cell ? southwest(cell) : null;
}

export function intersects(area: string, bounds: Bounds): boolean {
  const cell = parseArea(area);
  if (!cell) return false;
  const cellSouth = cell.latCell * STEP;
  const cellNorth = cellSouth + STEP;
  const cellWest = cell.lngCell * STEP;
  const cellEast = cellWest + STEP;
  const latHit = cellNorth > bounds.south && cellSouth < bounds.north;
  const lngHit =
    bounds.west <= bounds.east
      ? cellEast > bounds.west && cellWest < bounds.east
      : cellEast > bounds.west || cellWest < bounds.east;
  return latHit && lngHit;
}

export function formatDegrees(latitude: number, longitude: number): string {
  const ns = latitude >= 0 ? "N" : "S";
  const ew = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(3)}°${ns}  ${Math.abs(longitude).toFixed(3)}°${ew}`;
}

/** Southwest corner, which is the stable name of a block. */
export function formatBlock(area: string): string {
  const point = corner(area);
  return point ? formatDegrees(point.latitude, point.longitude) : area;
}

export type CountCell = {
  area: string;
  count: number;
};

export type CountMark = {
  id: string;
  count: number;
  areas: string[];
  south: number;
  west: number;
  latSpan: number;
  lngSpan: number;
};

/** Power-of-two cell group so a count stays about a finger wide as the map zooms out. */
export function binSize(zoom: number): number {
  const pixelsPerCell = (STEP * 512 * 2 ** zoom) / 360;
  let bin = 1;
  while (pixelsPerCell * bin < 56 && bin < 8192) bin *= 2;
  return bin;
}

export function clusterCounts(cells: CountCell[], zoom: number): CountMark[] {
  const bin = binSize(zoom);
  const groups = new Map<string, CountMark>();
  for (const cell of cells) {
    const parsed = parseArea(cell.area);
    if (!parsed || cell.count < 1) continue;
    const lat = Math.floor(parsed.latCell / bin) * bin;
    const lng = Math.floor(parsed.lngCell / bin) * bin;
    const id = bin === 1 ? cell.area : `${lat}:${lng}@${bin}`;
    const existing = groups.get(id);
    if (existing) {
      existing.count += cell.count;
      existing.areas.push(cell.area);
      continue;
    }
    groups.set(id, {
      id,
      count: cell.count,
      areas: [cell.area],
      south: lat * STEP,
      west: lng * STEP,
      latSpan: bin * STEP,
      lngSpan: bin * STEP,
    });
  }
  return [...groups.values()];
}

export function boxCollection(
  boxes: { south: number; west: number; latSpan: number; lngSpan: number }[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: boxes.map((box) => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [box.west, box.south],
            [box.west + box.lngSpan, box.south],
            [box.west + box.lngSpan, box.south + box.latSpan],
            [box.west, box.south + box.latSpan],
            [box.west, box.south],
          ],
        ],
      },
    })),
  };
}

export function markContains(mark: CountMark, latitude: number, longitude: number): boolean {
  return (
    latitude >= mark.south &&
    latitude < mark.south + mark.latSpan &&
    longitude >= mark.west &&
    longitude < mark.west + mark.lngSpan
  );
}

function ring(cell: Cell): GeoJSON.Position[] {
  const { latitude, longitude } = southwest(cell);
  const north = latitude + STEP;
  const east = longitude + STEP;
  return [
    [longitude, latitude],
    [east, latitude],
    [east, north],
    [longitude, north],
    [longitude, latitude],
  ];
}

export function polygonCollection(areas: string[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const area of areas) {
    const cell = parseArea(area);
    if (!cell) continue;
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring(cell)] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function gridCollection(bounds: Bounds): GeoJSON.FeatureCollection {
  if (bounds.west > bounds.east || bounds.south > bounds.north) return EMPTY;

  const latStart = cellIndex(bounds.south);
  const latEnd = cellIndex(bounds.north);
  const lngStart = cellIndex(bounds.west);
  const lngEnd = cellIndex(bounds.east);
  const latCount = latEnd - latStart + 1;
  const lngCount = lngEnd - lngStart + 1;
  if (latCount < 1 || lngCount < 1 || latCount > GRID_CELL_CAP || lngCount > GRID_CELL_CAP) {
    return EMPTY;
  }

  const south = latStart * STEP;
  const north = (latEnd + 1) * STEP;
  const west = lngStart * STEP;
  const east = (lngEnd + 1) * STEP;
  const features: GeoJSON.Feature[] = [];

  for (let lat = latStart; lat <= latEnd + 1; lat += 1) {
    const y = lat * STEP;
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [west, y],
          [east, y],
        ],
      },
    });
  }

  for (let lng = lngStart; lng <= lngEnd + 1; lng += 1) {
    const x = lng * STEP;
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [x, south],
          [x, north],
        ],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** Point on the north edge, centered, where the count label sits. */
export function labelPoint(area: string): { longitude: number; latitude: number } | null {
  const point = corner(area);
  if (!point) return null;
  return {
    longitude: point.longitude + STEP / 2,
    latitude: point.latitude + STEP,
  };
}
