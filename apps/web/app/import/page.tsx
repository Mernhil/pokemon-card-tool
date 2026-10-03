import { PageHeader } from "../../components/ui/page-header";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <main className="page max-w-5xl">
      <PageHeader
        eyebrow="Collection"
        title="Import from another tracker"
        subtitle="Pick a CSV from Cardmarket (stock export), the TCGplayer app, Collectr, a spreadsheet, or this app's own export. Every row is matched to a card; you check the uncertain ones before anything is saved."
      />
      <ImportForm />
    </main>
  );
}
