import { Suspense } from "react";

import { AgentWorkbench } from "@/components/agent-workbench";

function WorkbenchFallback() {
  return (
    <main className="app-loading" aria-busy="true" aria-label="Workspaceを準備しています">
      <span className="loading-mark" aria-hidden="true" />
      <p>Workspaceを準備しています…</p>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<WorkbenchFallback />}>
      <AgentWorkbench />
    </Suspense>
  );
}
