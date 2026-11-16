import Link from "next/link";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="top">
        <Link className="brand" href="/">
          Corruption database
        </Link>
        <nav className="nav">
          <Link href="/report">Report</Link>
          <Link href="/admin">Admin</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
