import { demoParams } from "@/lib/demo";
import { ReportView } from "./view";

export const dynamicParams = true;

export function generateStaticParams() {
  return demoParams();
}

export default async function Page({ params }: PageProps<"/reports/[id]">) {
  const { id } = await params;
  return <ReportView id={id} />;
}
