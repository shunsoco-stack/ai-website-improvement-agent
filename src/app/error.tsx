"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[workspace] recoverable render error", error);
  }, [error]);

  return (
    <main className="error-page">
      <div className="error-card" role="alert">
        <span className="error-code">Recovery</span>
        <h1>Workspaceを再開できます</h1>
        <p>表示処理で問題が発生しました。監査対象サイトへの変更は行われていません。</p>
        <button type="button" className="primary-button" onClick={reset}>再読み込み</button>
      </div>
    </main>
  );
}
