import { notFound } from "next/navigation";
import { availableCards, getBinder } from "@tcg-vault/db";
import { BinderView } from "../../../components/binders/binder-view";

export const dynamic = "force-dynamic";

export default async function BinderDetailPage(props: { params: Promise<{ binderId: string }> }) {
  const params = await props.params;
  const [binder, available] = await Promise.all([getBinder(params.binderId), availableCards()]);
  if (!binder) notFound();
  return <BinderView binder={binder} available={available} />;
}
