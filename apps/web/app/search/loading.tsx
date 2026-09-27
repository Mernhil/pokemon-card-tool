import { SkeletonPage } from "../../components/ui/skeleton";

// Only on pages without server-action forms: a loading boundary around a form
// replaces it while the action's refresh runs, which aborts the action (see
// the note in components/ui/skeleton.tsx).
export default function Loading() {
  return <SkeletonPage cardShaped />;
}
