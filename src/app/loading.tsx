export default function Loading() {
  return (
    <main className="app-loading" aria-busy="true">
      <span className="loading-mark" aria-hidden="true" />
      <p>Agent Workspaceを読み込んでいます…</p>
    </main>
  );
}
