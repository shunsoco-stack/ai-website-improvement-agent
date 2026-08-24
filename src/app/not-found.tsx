import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-page">
      <div className="error-card">
        <span className="error-code">404</span>
        <h1>このページは探索対象外です</h1>
        <p>Workspaceに戻り、監査Runを続けてください。</p>
        <Link href="/" className="primary-button">Workspaceへ戻る</Link>
      </div>
    </main>
  );
}
