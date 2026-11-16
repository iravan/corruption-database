export type Report = {
  id: string;
  created_at: string;
  updated_at: string;
  status: "pending" | "published" | "rejected";
  title: string;
  body: string;
  category: string;
  agency: string;
  place: string;
  occurred_on: string;
  source_links: string;
};

export type AdminAction = {
  admin_id: string;
  action: string;
  note: string;
  at: string;
};

export type AdminListItem = Report & {
  contact: string;
};

export type AdminReport = AdminListItem & {
  actions: AdminAction[];
};

export const CATEGORIES = [
  "bribery",
  "procurement",
  "embezzlement",
  "abuse of office",
  "other",
] as const;

export function meta(report: Pick<Report, "category" | "agency" | "place" | "occurred_on" | "created_at">): string {
  return [report.category, report.agency, report.place, report.occurred_on || report.created_at.slice(0, 10)]
    .filter(Boolean)
    .join(" · ");
}
