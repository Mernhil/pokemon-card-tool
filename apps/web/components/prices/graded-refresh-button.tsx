"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { refreshGradedPricesAction } from "../../app/[game]/[set]/[number]/actions";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";

export function GradedRefreshButton({
  variantId,
  language,
  hasData,
}: {
  variantId: string;
  language: string;
  hasData: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await refreshGradedPricesAction(variantId, language);
          if (!res.ok) toast("error", res.error);
          else
            toast(
              "success",
              res.rows > 0
                ? `Found graded prices in ${res.rows} grade slots`
                : "No graded listings found",
            );
          router.refresh();
        })
      }
    >
      <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Looking…" : hasData ? "Refresh graded" : "Load graded prices"}
    </Button>
  );
}
