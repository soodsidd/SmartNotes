import { Suspense } from "react";
import { ReliableNotebookShell } from "@/components/notebook-shell-reliable";
import { readVaultTree } from "@/server/vault/pages";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const initialVault = await readVaultTree({ skipCache: true });

  return (
    <Suspense fallback={null}>
      <ReliableNotebookShell initialVault={initialVault} />
    </Suspense>
  );
}
