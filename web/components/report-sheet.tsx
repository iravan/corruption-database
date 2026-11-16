"use client";

import { formatBlock, formatDegrees, type CountMark } from "@/lib/area";
import { meta, type Report } from "@/lib/types";

type ReportSheetProps = {
  mark: CountMark;
  reports: Report[] | null;
  error: string;
  onClose: () => void;
  onOpen: (report: Report) => void;
  onReport: () => void;
};

export function ReportSheet({ mark, reports, error, onClose, onOpen, onReport }: ReportSheetProps) {
  const single = mark.areas.length === 1;
  const heading = single ? formatBlock(mark.areas[0]) : formatDegrees(mark.south, mark.west);

  return (
    <aside className="sheet" role="dialog" aria-label={heading}>
      <header className="sheet-head">
        <div>
          <p className="sheet-area">{heading}</p>
          {single ? null : <p className="sheet-note">{mark.areas.length} blocks</p>}
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="sheet-list">
        {error ? <p className="error">{error}</p> : null}
        {!error && reports === null ? <p className="sheet-empty">Loading reports</p> : null}
        {reports?.length === 0 ? <p className="sheet-empty">No published allegations here.</p> : null}
        {reports && reports.length > 0 ? (
          <ol>
            {reports.map((report) => (
              <li key={report.id}>
                <button type="button" className="sheet-item" onClick={() => onOpen(report)}>
                  <span>{report.title}</span>
                  <span className="meta">{meta(report)}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      <div className="sheet-foot">
        {single ? null : <p className="help">Zoom in to file a report in one block.</p>}
        <button type="button" onClick={onReport}>
          Report corruption
        </button>
      </div>
    </aside>
  );
}
