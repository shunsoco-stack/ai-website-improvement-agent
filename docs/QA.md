# QA / Release Verification

「AI Webサイト改善エージェント」の自動Test、Production API、実ブラウザ、Screenshot、Vercel / GitHub公開を一か所で追跡するRelease記録です。時刻は特記がない限りJSTです。

## Source rules reviewed

- `AGENTS.md`: 確認済み
- Next.js 16.3 local docs: Project Structure / Server・Client Components / Route Handlers / Data Security / Backend for Frontend / Production Checklistを確認
- `apple-design` skill: Safety / Predictability、Agency、Simplicity、Craft、Light-first、reduced motion等を反映
- `DEVELOPMENT_RULES.md`: `C:\Users\kj\OneDrive\デスクトップ\DEVELOPMENT_RULES.md` を確認
- Vercel skills: Next.js / Deployments & CI/CD / CLI / Browser verificationを確認

## Release status

| Gate | Result | Executed at | Evidence / notes |
| --- | --- | --- | --- |
| `npm run lint` | **PASS** | 2026-08-25 01:07 | ESLint error 0 / warning 0 |
| `npm run typecheck` | **PASS** | 2026-08-25 01:07 | `next typegen && tsc --noEmit` |
| `npm run test` | **PASS** | 2026-08-25 01:07 | 12 files / 117 tests / 117 passed / 0 failed |
| `npm run build` | **PASS** | 2026-08-25 01:07 | Next.js 16.3.2 Production build、7 routes |
| `npm run verify` | **PASS** | 2026-08-25 01:07 | lint → typecheck → test → buildを連続実行 |
| Vercel Production deploy | **PASS** | 2026-08-25 01:08 | `dpl_DBJuDuKPJrYYaq3cZfVbHuxG42Um` / READY |
| Production verifier | **PASS** | 2026-08-25 01:08 | 3 / 3 passed |
| Desktop Browser QA | **PASS** | 2026-08-25 01:08 | 1280×720、8 Plan steps、27 interactive controls、Error Overlayなし |
| Tablet Browser QA | **PASS** | 2026-08-25 01:10 | 820×1100、2-column layout、横Overflowなし |
| Mobile Browser QA | **PASS** | 2026-08-25 01:10 | 390×844、1 panel + bottom navigation、Evidence表示、横Overflowなし |
| Production Demo × 3 | **PASS** | 2026-08-25 01:10 | 11 / 8 / 12 Issues、全RunがHuman Reviewで停止して承認可能 |
| Production Live URL | **PASS** | 2026-08-25 01:12 | `example.com`、Max 3 / Depth 0 / Concurrency 1、1 Page / 2 Issues / Human Review |
| Production screenshots × 5 | **PASS** | 2026-08-25 01:08 | `docs/screenshots/`、Production実画面 |
| Browser console errors | **PASS** | 2026-08-25 01:12 | Desktop / Demo / Responsive / Live Runで0件 |
| GitHub Public | **PASS** | 2026-08-26 01:13 | `shunsoco-stack/ai-website-improvement-agent`、Public、`main`、source commit `2fba477` |
| Secret scan | **PASS** | 2026-08-25 01:13 | 67 staged files / 0 findings、ignored artifact混入0 |

## Automated test matrix

| Required area | Test / verification | Result |
| --- | --- | --- |
| Crawl | BFS、Depth、Concurrency、Page / Tool / Retry / Duration上限、Abort | **PASS** |
| HTTP | Redirect、Loop、Timeout、Body / Header上限、Socket pinning | **PASS** |
| Metadata | Title、Description、Canonical、H1、Link、alt、Label、Heading jump | **PASS** |
| Priority | `Impact × Confidence ÷ Effort`、High / Medium / Low、Backlog | **PASS** |
| Re-investigation | Duplicate Title等のPattern、追加URL、上限 | **PASS** |
| SSRF | localhost、private、link-local、metadata、reserved IP、DNS、Redirect hop | **PASS** |
| Prompt Injection | Signal検出、immutable untrusted envelope、許可Issue ID、本文非実行 | **PASS** |
| Loop Limit | completed fingerprint、`loop_detected`、Recheck上限 | **PASS** |
| Human Review | Plan approval、awaiting review、Approve、Changes requested、外部変更なし | **PASS** |
| Compare | Stable fingerprintで改善済み / 新規問題 / 未解決 | **PASS** |

Test files:

- Agent domain: 7 files
- Bounded client crawl: 1 file
- Safe HTTP / URL / HTML audit: 3 files
- Route Handler: 1 file
- Total: 12 files / 117 tests

## Production API verification

Command:

```bash
npm run verify:production -- https://ai-website-improvement-agent.vercel.app
```

Result:

```text
PASS Home / deployment identity
PASS Invalid URL is rejected without an invented status
PASS Private IPv4 target is blocked before fetch
Production verification: 3/3 passed
```

追加のLocal API probeでは次を確認しました。

- `http://127.0.0.1:3000/` → `BLOCKED_TARGET`
- `http://169.254.169.254/latest/meta-data/` → `BLOCKED_TARGET`
- `file:///etc/passwd` → `INVALID_URL`
- Prompt Injection文字列を`untrustedContent`へ含めた `/api/interpret` → `rule_based_demo`、許可Issue IDだけを返し、命令文字列を実行・反映・echoしない

## Browser QA

### Desktop / workflow

- [x] App名、専用Icon、Light-first UIが表示される。
- [x] Goalを複数選択できる。
- [x] Max URL / Depth / Concurrency / Timeoutを操作できる。
- [x] 8段階PlanとPlan Approvalを確認できる。
- [x] Crawl progressにDepth、Current URL、Page、Tool Callを表示する。
- [x] Technical / Content / UX / AccessibilityのIssueを表示する。
- [x] URL / Page / Detected Fact / SourceのEvidenceを表示する。
- [x] Before → Suggested、Technology qualifierを表示する。
- [x] Re-investigationとConfirmed Patternを表示する。
- [x] Critical / Quick Win / Medium-term / Optionalへ分類する。
- [x] Compareで改善済み / 新規問題 / 未解決を表示する。
- [x] Demoは自動承認せずHuman Reviewで停止する。
- [x] Human Approval後も「外部サイトは変更していません」と表示する。
- [x] Console error 0、Next.js Error Overlayなし。

Production Demo実測:

| Demo | Pages | Issues | Rechecks | Human Review |
| --- | ---: | ---: | ---: | --- |
| Corporate Site | 5 | 11 | 2 | 停止 → Approve **PASS** |
| EC Site | 5 | 8 | 1 | 停止 → Approve **PASS** |
| Landing Page | 3 | 12 | 1 | 停止 → Approve **PASS** |

### Live URL

`https://example.com/` をMax 3、Depth 0、Concurrency 1、Timeout 4秒で実行し、次を確認しました。

- 1 PageをBackend Fetchして2 IssuesをEvidence付きで整理
- Provider表示は`Rule-based Demo解釈`
- Human Reviewで停止
- Error toast / Console error / Overlayなし
- External mutationなし

### Responsive

- Tablet 820×1100: Goal + Workspaceの2列、Reviewは同一Flow内、横Overflowなし。
- Mobile 390×844: Plan / Workspace / Reviewのbottom navigation、1 panel表示、Issue Evidenceへ切替可能。
- `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`をCSSで処理。

## Security checklist

- [x] HTTP / HTTPSのみ、credentialsと80 / 443以外のPortを拒否。
- [x] localhost、single-label、private、loopback、link-local、metadata、reserved等を拒否。
- [x] DNSの全A / AAAA Answerを検査し、検証済みIPへSocketを固定。
- [x] Redirect全HopでURL policyとDNSを再検証。
- [x] Redirect、Timeout、Header、Body、Snippet、API body、Rate、Concurrencyへ上限。
- [x] Page / Tool Call / Retry / Duration / Re-investigation / LoopへAgent上限。
- [x] Web本文を`untrusted` dataとして分離し、AIへTool権限を与えない。
- [x] AI outputをJSON Schemaと許可済みIssue IDで検証。
- [x] `/api/check`と`/api/interpret`が`Cache-Control: no-store`。
- [x] `.env.local`、`.vercel/`、`node_modules/`、`.next/`をGit ignore。
- [x] ScreenshotにSecret、個人情報、DevTools、local pathなし。
- [ ] Vercel Firewall / WAF、分散Rate Limit、Load test、Penetration testは実施していない。

Rate bucketとactive counterはServerless Function instance内のbest-effort制御です。SSRFやPrompt Injectionの対策を実装していますが、「完全防止」「脆弱性診断済み」「WAF相当」とは主張しません。

## Production screenshots

| # | File | Required content | Result |
| ---: | --- | --- | --- |
| 1 | `docs/screenshots/01-goal-plan.png` | URL、Goal、Crawl上限、8段階Plan、承認 | **PASS** |
| 2 | `docs/screenshots/02-crawl-progress.png` | Crawl進捗、URL、Depth、Tool Calls、Activity | **PASS** |
| 3 | `docs/screenshots/03-issue-dashboard.png` | Category、Priority、Issue一覧、Filter | **PASS** |
| 4 | `docs/screenshots/04-issue-detail-evidence.png` | URL、Page、Detected Fact、Source、Before → Suggested | **PASS** |
| 5 | `docs/screenshots/05-improvement-backlog.png` | 4 Backlog、Priority、Human Review | **PASS** |

5枚とも `https://ai-website-improvement-agent.vercel.app` の実画面を1280×720で撮影し、内容・解像度・Secret不在を目視確認しました。

## Release identity

```text
Vercel URL: https://ai-website-improvement-agent.vercel.app
Vercel deployment ID: dpl_DBJuDuKPJrYYaq3cZfVbHuxG42Um
Vercel state: READY
GitHub URL: https://github.com/shunsoco-stack/ai-website-improvement-agent
Default branch: main
Verified source commit: 2fba477
Secret scan: PASS — 67 staged files / 0 findings
```

## Known QA boundaries

- Static HTML監査であり、JavaScript render後DOM、SPA内遷移、Shadow DOM、Core Web Vitalsは対象外です。
- Contrast、Keyboard、Screen Reader、Focus管理は対象サイトについてHuman Reviewが必要です。
- Production verifierは安全なIdentity / Invalid URL / Private IPv4 Blockだけを自動確認します。
- Prompt Injection signal検出は未知表現を網羅しません。主防御はInstruction / Data分離、権限制限、Schema validationです。
- OpenAI API KeyなしのReleaseではRule-based modeを検証済みです。Live AI Provider responseは未検証です。
- Cross-browser Matrix、Visual regression、Load test、Penetration test、Accessibility認証は実施していません。
