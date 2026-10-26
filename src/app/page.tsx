import { Suspense } from "react";
import { ReliableNotebookShell } from "@/components/notebook-shell-reliable";
import { readVaultTree } from "@/server/vault/pages";
import { readVaultUiState } from "@/server/vault/ui-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const { closedNotebooks } = await readVaultUiState();
  const initialVault = await readVaultTree({ skipCache: true, closedNotebookPaths: new Set(closedNotebooks) });

  return (
    <Suspense fallback={null}>
      <ReliableNotebookShell initialVault={initialVault} initialClosedNotebooks={closedNotebooks} />
    </Suspense>
  );
}
