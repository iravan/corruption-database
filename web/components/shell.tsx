import Link from "next/link";
import { isDemo } from "@/lib/demo";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      {isDemo() ? (
        <p className="demo-banner">
          Demo. These reports are examples. Nothing you type is stored.
        </p>
      ) : null}
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
