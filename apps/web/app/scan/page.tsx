import { PageHeader } from "../../components/ui/page-header";
import { ScanClient } from "./scan-client";

export const dynamic = "force-dynamic";

export default function ScanPage() {
  return (
    <main className="page max-w-4xl">
      <PageHeader
        eyebrow="Collection"
        title="Scan with the webcam"
        subtitle="Hold a card up so its bottom edge (the collector number, like 025/198) is readable, and press Scan. The number is matched against the catalog; pick the card to add it."
      />
      <ScanClient />
    </main>
  );
}
