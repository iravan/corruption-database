"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ReportForm } from "@/components/report-form";
import { Shell } from "@/components/shell";
import { corner } from "@/lib/area";

export default function ReportPage() {
  const [area, setArea] = useState<string | null>(null);

  useEffect(() => {
    setArea(new URLSearchParams(window.location.search).get("area") ?? "");
  }, []);

  return (
    <Shell>
      <h1>Report corruption</h1>
      {area === null ? (
        <p className="muted">Loading the block.</p>
      ) : !corner(area) ? (
        <p>
          Choose the block where it happened on the <Link href="/">map</Link>.
        </p>
      ) : (
        <ReportForm area={area} />
      )}
    </Shell>
  );
}
