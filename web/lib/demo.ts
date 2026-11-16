import type { AdminAction, AdminReport, Report } from "@/lib/types";

export const DEMO_PASSWORD = "demo";

type DemoRecord = AdminReport;

const SAMPLE: DemoRecord[] = [
  {
    id: "school-roof",
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    status: "pending",
    title: "School roof contract",
    body: "The same contractor won three school roof jobs. The other bids were higher by the same amount.",
    category: "procurement",
    agency: "Education bureau",
    place: "North district",
    occurred_on: "2025-06-12",
    source_links: "https://example.com/tenders/school-roof",
    actions: [],
  },
  {
    id: "clinic-supply",
    created_at: "2026-11-08T09:00:00Z",
    updated_at: "2026-11-08T09:00:00Z",
    status: "pending",
    title: "Clinic supply invoices",
    body: "Invoices for gloves and masks were paid twice. The second payment went to a new company with the same directors.",
    category: "embezzlement",
    agency: "Health department",
    place: "Central clinic",
    occurred_on: "2024-03-02",
    source_links: "",
    actions: [],
  },
  {
    id: "harbour-tender",
    created_at: "2026-10-02T09:00:00Z",
    updated_at: "2026-10-04T11:00:00Z",
    status: "published",
    title: "Harbour repair tender",
    body: "The winning bid was submitted after the deadline. Staff still scored it first.",
    category: "procurement",
    agency: "Works department",
    place: "Harbour",
    occurred_on: "2019-01-15",
    source_links: "https://example.com/tenders/harbour",
    actions: [
      {
        admin_id: "admin",
        action: "publish",
        note: "example",
        at: "2026-10-04T11:00:00Z",
      },
    ],
  },
  {
    id: "depot-fuel",
    created_at: "2026-09-18T09:00:00Z",
    updated_at: "2026-09-20T15:00:00Z",
    status: "published",
    title: "Depot fuel records",
    body: "Fuel logs at the depot show more litres issued than the tanks can hold.",
    category: "embezzlement",
    agency: "Transport department",
    place: "Main depot",
    occurred_on: "2023-11-03",
    source_links: "",
    actions: [
      {
        admin_id: "admin",
        action: "publish",
        note: "example",
        at: "2026-09-20T15:00:00Z",
      },
    ],
  },
  {
    id: "park-lights",
    created_at: "2026-08-01T09:00:00Z",
    updated_at: "2026-08-02T10:00:00Z",
    status: "rejected",
    title: "Park lighting claim",
    body: "A resident said the lighting budget was diverted. The only source was a rumour.",
    category: "abuse of office",
    agency: "Leisure department",
    place: "Riverside park",
    occurred_on: "2022-07-01",
    source_links: "",
    actions: [
      {
        admin_id: "admin",
        action: "reject",
        note: "no source",
        at: "2026-08-02T10:00:00Z",
      },
    ],
  },
];

const KEY = "demo-reports";

export function isDemo(): boolean {
  return process.env.NEXT_PUBLIC_DEMO === "1";
}

export function demoParams(): { id: string }[] {
  return SAMPLE.map((report) => ({ id: report.id }));
}

export function demoPublished(): Report[] {
  return read()
    .filter((report) => report.status === "published")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(publicReport);
}

export function demoQueue(status: string): Report[] {
  const reports = read().filter((report) => report.status === status);
  reports.sort((a, b) =>
    status === "pending"
      ? a.created_at.localeCompare(b.created_at)
      : b.created_at.localeCompare(a.created_at),
  );
  return reports.map(publicReport);
}

export function demoPublic(id: string): Report | null {
  const report = read().find((item) => item.id === id && item.status === "published");
  return report ? publicReport(report) : null;
}

export function demoAdmin(id: string): DemoRecord | null {
  return read().find((item) => item.id === id) ?? null;
}

export function demoRequest<T>(path: string, init: RequestInit = {}, token = ""): T {
  const method = (init.method ?? "GET").toUpperCase();
  const [pathname, query = ""] = path.split("?");
  const status = new URLSearchParams(query).get("status");

  if (method === "GET" && pathname === "/reports") {
    return { reports: demoPublished() } as T;
  }

  const publicId = pathname.match(/^\/reports\/([^/]+)$/);
  if (method === "GET" && publicId) {
    const report = demoPublic(decodeURIComponent(publicId[1]));
    if (!report) {
      throw new Error("That report is not public.");
    }
    return report as T;
  }

  if (method === "POST" && pathname === "/reports") {
    return { id: "queued", status: "pending" } as T;
  }

  if (method === "POST" && pathname === "/admin/session") {
    const body = JSON.parse(String(init.body ?? "{}")) as { password?: string };
    if (body.password !== DEMO_PASSWORD) {
      throw new Error("The password is wrong.");
    }
    return { token: "demo" } as T;
  }

  if (method === "DELETE" && pathname === "/admin/session") {
    return undefined as T;
  }

  requireDemoAdmin(token);

  if (method === "GET" && pathname === "/admin/reports") {
    return { reports: demoQueue(status || "pending") } as T;
  }

  const adminId = pathname.match(/^\/admin\/reports\/([^/]+)$/);
  if (adminId && method === "GET") {
    const report = demoAdmin(decodeURIComponent(adminId[1]));
    if (!report) {
      throw new Error("That report does not exist.");
    }
    return report as T;
  }

  if (adminId && method === "PATCH") {
    return patchDemo(decodeURIComponent(adminId[1]), String(init.body ?? "{}")) as T;
  }

  throw new Error("The request failed.");
}

function requireDemoAdmin(token: string) {
  if (token !== "demo") {
    throw new Error("An admin session is required.");
  }
}

function patchDemo(id: string, raw: string): DemoRecord {
  const patch = JSON.parse(raw) as Partial<Report> & { note?: string; status?: Report["status"] };
  const reports = read();
  const current = reports.find((report) => report.id === id);
  if (!current) {
    throw new Error("That report does not exist.");
  }
  const nextStatus = patch.status ?? current.status;
  const action = actionName(current.status, nextStatus);
  const updated: DemoRecord = {
    ...current,
    title: patch.title ?? current.title,
    body: patch.body ?? current.body,
    category: patch.category ?? current.category,
    agency: patch.agency ?? current.agency,
    place: patch.place ?? current.place,
    occurred_on: patch.occurred_on ?? current.occurred_on,
    source_links: patch.source_links ?? current.source_links,
    status: nextStatus,
    updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    actions: [
      ...current.actions,
      {
        admin_id: "admin",
        action,
        note: (patch.note ?? "").trim(),
        at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      } satisfies AdminAction,
    ],
  };
  write(reports.map((report) => (report.id === id ? updated : report)));
  return updated;
}

function actionName(from: Report["status"], to: Report["status"]): string {
  if (from === to) {
    return "edit";
  }
  if (to === "published") {
    return "publish";
  }
  if (to === "rejected") {
    return "reject";
  }
  if (from === "published") {
    return "unpublish";
  }
  return "reopen";
}

function publicReport(report: DemoRecord): Report {
  const { actions: _actions, ...rest } = report;
  return rest;
}

function read(): DemoRecord[] {
  if (typeof sessionStorage === "undefined") {
    return structuredClone(SAMPLE);
  }
  const raw = sessionStorage.getItem(KEY);
  if (!raw) {
    return structuredClone(SAMPLE);
  }
  try {
    return JSON.parse(raw) as DemoRecord[];
  } catch {
    return structuredClone(SAMPLE);
  }
}

function write(reports: DemoRecord[]) {
  sessionStorage.setItem(KEY, JSON.stringify(reports));
}
