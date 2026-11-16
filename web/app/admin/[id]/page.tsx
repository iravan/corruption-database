import { demoParams } from "@/lib/demo";
import { AdminReportView } from "./view";

export const dynamicParams = true;

export function generateStaticParams() {
  return demoParams();
}

export default async function Page({ params }: PageProps<"/admin/[id]">) {
  const { id } = await params;
  return <AdminReportView id={id} />;
}
