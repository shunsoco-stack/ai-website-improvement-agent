# AI Webサイト改善エージェント

URLと改善Goalを入力すると、制限付きCrawl、決定論的な技術監査、AIまたはRule-basedによる意味付け、Patternの再調査、優先順位、改善Backlog、Human Reviewまでを一つのRunとして進めるポートフォリオ用Webアプリです。

単に「WebサイトをAIに評価させる」画面ではありません。HTTPとHTMLから確認できるFactを通常コードで取得し、そのEvidenceを壊さずにInterpretationへ渡します。外部サイトを自動変更するToolは持たず、出力はPlanとSuggested Fixまでです。

> **自主制作 / Concept Project** です。Demo内のサイト、組織、商品、数値はWorkflow確認用の架空データであり、実在顧客の導入事例ではありません。

## Release status

- Vercel: [https://ai-website-improvement-agent.vercel.app](https://ai-website-improvement-agent.vercel.app)（公開済み・Production verifier 3/3・実ブラウザ確認済み）
- GitHub: [https://github.com/shunsoco-stack/ai-website-improvement-agent](https://github.com/shunsoco-stack/ai-website-improvement-agent)（Public・`main`公開済み）
- QA: [docs/QA.md](docs/QA.md)
- ポートフォリオ掲載用完全版プロンプト: [docs/PORTFOLIO_COMPLETE_PROMPT.md](docs/PORTFOLIO_COMPLETE_PROMPT.md)

Vercel、GitHub、検証件数、Production Screenshot、Secret Scanは実測済みです。Releaseの証跡と既知の検証範囲は [docs/QA.md](docs/QA.md) に記録しています。

## Portfolio metadata

- 作品名: AI Webサイト改善エージェント
- カテゴリ: AIエージェント
- サブカテゴリ: Web改善・監査エージェント
- Repository: `ai-website-improvement-agent`
- 対応: Web / Desktop / Tablet / Smartphone
- 専用アイコン: Globe + Wrench + AI Nodes
- 外部変更Policy: `suggestions_only`

## Agent workflow

```text
Goal
↓
Planning / Human approval
↓
Limited Site Crawl
↓
Deterministic Audit
↓
AI Interpretation または明示されたRule-based Demo解釈
↓
Pattern Detection / Re-investigation
↓
Deterministic Priority
↓
Improvement Backlog / Suggested Fix
↓
Human Review
```

Planは次の8段階です。

1. Site Crawl
2. Metadata確認
3. Broken Link確認
4. Content確認
5. UX・Accessibility整理
6. Technical Issues・AI Interpretation
7. Priority設定・追加調査
8. Improvement Plan・Human Review

ユーザーは実行前にPlanとCrawl上限を確認します。Run中はCrawl、Check、AI Analyze、Recheck、Report、Approval、GuardrailのActivityを時系列で確認でき、最終結果は人が承認または差戻しできます。

## Goal

複数選択に対応します。

- SEO改善
- UX改善
- Conversion改善
- Technical Audit
- リニューアル調査

URLだけで断定できない事業要件はBusiness Contextとして補足できます。AIやRule-based解釈は、選択されたGoalと監査Evidenceを説明に利用しますが、HTTP Statusや優先順位の計算値を書き換えません。

## Limited crawl and guardrails

同一Originの内部URLだけをBFSで探索します。Fragmentを除去して重複を避け、外部LinkはEvidenceとして保持してもCrawl queueへ追加しません。

UIで扱う値:

| Setting | Demo initial | Live UI range / behavior |
| --- | ---: | ---: |
| Max Pages | 18 | 3–50 |
| Depth | 2 | 0–3 |
| Concurrency | 3 | 1–4 |
| Per-page Timeout | 8,000 ms | 4,000 / 8,000 / 12,000 / 15,000 ms |
| Agent Max Tool Calls | 44 | `min(80, max(20, Max Pages × 2 + 8))` |
| Crawl fetch cap | 36 | `min(60, max(15, Max Pages × 2))` |
| Max Retry | 1 | 1 |
| Agent Max Duration | 120,000 ms | 120,000 ms（Crawl部分は90,000 ms） |

固定Demo datasetには別途、最大30 Page、48 Tool Call、Retry 2、120秒、Re-investigation 4回、1回あたり追加4 Pageという再現用Guardrailがあります。Live Runでは画面のMax Pages、導出したTool Call上限、Retry 1、120秒、Re-investigation 4回、1回あたり追加3 Pageを使います。実行側はより厳しい有効上限を使い、Page、Tool Call、Retry、Duration、Re-investigationのいずれかへ到達した時点で停止理由を残します。無限Crawl、無限Retry、同じPatternの再調査Loopは許可しません。

## Deterministic audit

次の観測はAIへ任せず、Node.jsのHTTP clientと上限制御付きHTML scannerで確認します。

- HTTP Status
- Broken Link / 4xx / 5xx
- Final URL
- Redirect Count / Chain / Loop / Limit
- Response Time
- Content-Type
- Title
- Meta Description
- Canonical
- H1 / H1件数
- 内部・外部Anchor Link
- HTML本文の上限付きSnippet
- Technology Hint
- `alt` 属性のない画像
- Accessible Nameを確認できないForm Control / Button
- Heading levelの飛び越し

Technology Hintは、`_next` asset、WordPress、Shopify、Nuxtなどの静的markerから得る補助情報です。対象技術を断定するものではなく、Code Suggestionには「実装前に構成を確認」と表示します。

Response TimeはBackendがResponse Headerを受け取るまでを中心とした測定値です。Browser rendering、JavaScript実行、Core Web Vitals、実ユーザー計測ではありません。

## AI interpretation

決定論的Findingごとに、次を整理します。

- 問題の意味
- 想定されるBusiness Impact
- Review可能な改善案
- 不確実性

`OPENAI_API_KEY` がある場合、Server側の `/api/interpret` からOpenAI Responses APIを呼び、厳格なJSON SchemaでStructured Outputを要求します。Requestは `store: false` とし、AIへ渡すFindingは最大24件、API bodyは48 KiB、各Content Snippetは最大1,200文字、Provider timeoutは22秒です。SecretはBrowserへ渡しません。

API Keyがない場合は `Rule-based Demo解釈` と明示します。Provider失敗時も `AI失敗時のRule-based解釈` と表示し、通常コードの文面をAI生成として偽りません。どちらのModeでも、AIはPriority、Evidence ID、URL、HTTP Status、Crawl上限を変更できません。

> `store: false` はこのアプリがProviderへ指定するRequest設定です。Provider側のData policy全体や通信経路を本作品が保証するものではありません。

## Prompt Injection defense

対象ページ本文はAgent指示ではなく、常に信頼できない外部Dataとして扱います。

- Script、Style、iframe、object等を本文Snippetから除外
- 制御文字とrole delimiterをneutralize
- 本文を長さ制限付きの `untrusted_web_content` envelopeへ格納
- Website本文とSystem Instructionを別DataとしてProviderへ送信
- 「以前の指示を無視」「System Promptを表示」「Toolを実行」等のSignalを記録
- AIへEvidence、URL、Priority、Tool挙動を変更しない制約を付与
- Provider responseを許可済みIssue IDとSchemaで再検証

Pattern検出は防御の補助です。未知の表現をすべて検出できるとは主張せず、主防御は命令と外部Dataの分離、権限制限、Structured Output validationです。

## Priority and backlog

PriorityはAIの自由回答ではなく、次の明示Ruleで通常コードが算出します。

```text
score = Impact (1–3) × Confidence (1–3) ÷ Effort (1–3)

High   : score >= 4.5
Medium : score >= 2.0 and < 4.5
Low    : score < 2.0
```

Severity、Issue code、CategoryからImpact / Confidence / Effortを決定論的に導き、計算根拠をIssueへ保存します。Backlogは次へ分類します。

- Critical
- Quick Win
- Medium-term
- Optional

Criticalは高影響のBroken / Server / Conversion阻害等、Quick Winは低Effortかつ一定Impactを持つIssueを中心にします。分類は修正の自動適用ではなく、Human Review用の着手順です。

## Evidence and suggested fixes

Issueごとに次を保持します。

- URL
- Page titleまたはPage URL
- Detected Fact
- Source
- Locator（取得できる場合）
- Checked At
- 安定Fingerprint

Title、Description、Canonical、H1、alt、Label、HTTP / Link等は `Before → Suggested` を表示します。HTML例を出せる場合でも、Technology Hintを確認できなければ標準HTML例として提示し、React、Next.js、CMS等を断定しません。

## Re-investigation

初回監査のObservationから、次のようなPatternを通常コードで抽出します。

- 同一Titleが複数Pageに存在
- alt不足が複数Pageで反復
- Canonical不足が同系統Pageで反復
- Form Label不足が共通Componentらしく反復

関連Pageの未監査内部Linkを、残りPage / Tool Call / Re-investigation上限内で追加確認します。Trigger、Reason、Pattern、関連Issue、追加URL、結果をTaskとして記録します。同じPattern fingerprintを完了済みの場合は `loop_detected` として再実行しません。

## Compare mode

Run AとRun BをIssue fingerprintで比較し、次へ分類します。

- 改善済み
- 新規問題
- 未解決

同一FingerprintがRun Bにもあれば未解決、Run Aだけなら改善済み、Run Bだけなら新規問題です。サイト内容や応答は時刻で変わり得るため、比較結果は同条件での再確認材料として扱います。

## Demo mode

アカウントやAPI Keyなしで、次の3タイプを体験できる構成です。

1. Corporate Site
   - 架空のB2B企業「Aoba Solutions」5 Page
   - 重複Title、Canonical、alt、Form Label、404、曖昧CTAを確認
   - 本文中のPrompt Injection SignalをUntrusted Contentとして隔離
2. EC Site
   - 架空の生活用品EC「Nagi Market」5 Page
   - Category、商品詳細、CartのDescription / Canonical、画像alt、Slow Response、Checkout Error recoveryを確認
3. Landing Page
   - 架空SaaS「Haru Flow」のLPを起点とする3 Page
   - Description、Canonical、Heading jump、競合CTA、Signup Form、Slow Responseを確認

Demoの決定論的な期待値:

| Scenario | Pages | Issues | Rechecks | Critical | Quick Win | Medium-term | Optional | Run A → B（改善 / 新規 / 未解決） |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Corporate Site | 5 | 11 | 2 | 1 | 8 | 1 | 1 | 1 / 1 / 10 |
| EC Site | 5 | 8 | 1 | 0 | 5 | 3 | 0 | 1 / 1 / 7 |
| Landing Page | 3 | 12 | 1 | 0 | 7 | 5 | 0 | 1 / 1 / 11 |

固定結果の3 RunはHuman Review完了済みのConcept Projectで、`externalChangesApplied`は`false`です。画面からDemoを実行した場合はReport作成後に`Human Review待ち`で停止し、利用者がApproveまたはChanges requestedを選びます。ActivityはCrawl → Check → AI Analyze（Demo rule-based）→ Recheck → Report → Approvalを保持します。

Demoは架空の安全なDatasetです。固定された「完成結果画像」ではなく、同じSynthesis、Priority、Re-investigation、Backlog、Human Reviewの処理を通してAgent Workflowを再現します。Live Crawlと同じ外部Network検査を行ったとは表示しません。

## Human review and external safety

本作品は対象サイトを変更しません。

```text
Evidence
↓
Improvement Backlog
↓
Suggested Fix
↓
Human Review
```

- CMS、Repository、Hosting、DNS、Analyticsへ書き込むToolなし
- 自動Deploy、Commit、PR作成、メール送信なし
- ApprovalまたはChanges requestedをDecisionとして保持
- `externalChangesApplied` は常に `false`
- Technologyを確認できないCode Suggestionは断定しない

## SSRF and backend fetch safety

任意URLを扱うため、Backend Fetchはfail-closedを基本にします。

- HTTP / HTTPSのみ
- URL長2,048文字まで
- URL内credentialsを拒否
- Port 80 / 443のみ
- localhost、single-label host、`.local`、`.internal`、`.lan`等を拒否
- loopback、private、link-local、carrier-grade NAT、reserved、documentation、multicast等を拒否
- Cloud metadata host / IP rangeを拒否
- DNSの全Answerがpublicの場合のみ許可
- 検証済みIPへSocketを接続し、Host HeaderとTLS SNIは元Hostnameを使用
- Redirectの各HopでURLとDNSを再検証
- TLS certificate validationを有効化

Backend resource limits:

| Control | Value |
| --- | ---: |
| DNS lookup timeout | 5秒 |
| Per-hop request timeout | 8秒 |
| Per-URL audit deadline | 24秒 |
| Redirect limit | 6 |
| HTML body limit | 1,000,000 byte |
| Response header limit | 32 KiB |
| `/api/check` JSON body | 16 KiB |
| `/api/check` rate bucket | 120 Request / 60秒 / Client key |
| Backend active checks | 最大6 |
| Same-origin active checks | 最大3 |
| Vercel Function max duration | 30秒 |

Rate bucketとactive counterはFunction instance内Memoryのbest-effort制御であり、分散Rate Limitではありません。「SSRFを完全防止」「脆弱性診断済み」「WAF相当」とは主張しません。

## Architecture

```text
React Agent Workspace
├─ Goal / Plan approval
├─ Client-side bounded BFS scheduler
├─ Activity / Usage / Stop
├─ Deterministic synthesis and priority
├─ Re-investigation planner
├─ Compare / Backlog / Human Review
└─ Demo datasets
        │
        ├─ POST /api/check
        │   └─ SSRF policy → pinned HTTP(S) → static HTML audit
        │
        └─ POST /api/interpret
            ├─ Optional OpenAI Structured Outputs
            └─ Explicit Rule-based Demo / failure fallback
```

Session UIはBrowser内で扱い、外部サイトを更新するBackend Toolはありません。Database、Authentication、Team共有、長期監査履歴は本作品の範囲外です。

## Tech stack

- Next.js 16.3 / App Router / Node.js Route Handlers
- React 19.2
- TypeScript 5.9 strict mode
- Node.js 24 native HTTP / HTTPS / DNS / Crypto
- Optional OpenAI Responses API / JSON Schema Structured Outputs
- Lucide React
- Vitest 4 / Testing Library / jsdom
- ESLint 9
- Vercel Functions

## Environment variables

DemoとRule-based InterpretationはSecretなしで動作します。

```bash
cp .env.example .env.local
```

```dotenv
# Optional. Server-side only.
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
```

`OPENAI_API_KEY` に `NEXT_PUBLIC_` を付けたり、Browser code、Screenshot、Git履歴へ含めたりしないでください。利用Model名はDeploy時にProviderで利用可能なものを確認してください。

## Development

Requirements: Node.js 24 / npm

```bash
npm install
npm run dev
```

Next.js 16は従来VersionとAPIやConventionが異なるため、変更前にインストール済みPackageの `node_modules/next/dist/docs/` にある関連Guideを確認します。

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npm run build

# まとめて実行
npm run verify
```

Production公開後:

```bash
npm run verify:production -- https://ai-website-improvement-agent.vercel.app
```

Production verifierは、Homeが本作品であることを確認してから、Networkへ接続しないInvalid URLとPrivate IPv4のBlockだけを `/api/check` で検証します。外部サイトのCrawlや変更は行いません。最終結果と実行日時は [docs/QA.md](docs/QA.md) を参照してください。

## Deployment

VercelのNext.js Node.js runtimeへDeployします。`/api/check` と `/api/interpret` は最大30秒のFunctionとして設定されています。

```bash
vercel
vercel --prod
```

本番公開、Production verifier、Desktop / Tablet / Mobile QA、5枚のProduction Screenshotを確認した後、Secret Scanを通してGitHub Public Repositoryを公開します。公開前のURLや未実行テストをREADMEだけでPass扱いにしません。

## Screenshots

次の5枚をVercel Productionの実画面から取得します。現在のRelease状況は [docs/QA.md](docs/QA.md) を確認してください。

1. `docs/screenshots/01-goal-plan.png` — Goal / Plan
2. `docs/screenshots/02-crawl-progress.png` — Crawl Progress
3. `docs/screenshots/03-issue-dashboard.png` — Issue Dashboard
4. `docs/screenshots/04-issue-detail-evidence.png` — Issue Detail + Evidence
5. `docs/screenshots/05-improvement-backlog.png` — Improvement Backlog

AI生成の架空UI、DevToolsで差し替えたResult、Loading途中の画面は使用しません。

## Responsive, accessibility, and design

UIはApple DesignのSafety / Predictability、Agency、Simplicity、Craftを、装飾ではなく監査判断へ反映します。

- System fontとSize別のtracking / leading
- Goal、Plan、実行中、ReviewのWayfinding
- 押下時の即時Feedback
- Statusを色だけでなくLabelとIconで表示
- Visible focus、Semantic form / table / dialog
- 44pxを基本とする主要Touch target
- Desktop / Tablet / Smartphoneで主要Workflowを維持
- `prefers-reduced-motion`
- `prefers-reduced-transparency`
- `prefers-contrast`

本アプリ自身のUI配慮と、対象サイトのAccessibility監査は別です。対象サイトに対して自動確認できるのは静的HTMLのalt、Label、Heading等の一部です。ContrastはCSS、背景画像、状態変化、render後のcomputed styleが必要なため `manual_review` とし、WCAG適合を断定しません。

## Known limitations

- 権限のあるサイトだけを監査してください。利用規約、robots.txt、法的許可、負荷条件を自動判定しません。
- JavaScriptを実行せず、初期HTMLだけを解析します。Client rendering後のDOM、SPA内遷移、Shadow DOMは対象外です。
- Login、Cookie、Bearer / Basic認証、custom Header、VPN / private network内サイトには対応しません。
- 80 / 443以外のPortは安全上拒否します。
- 圧縮Responseが `Accept-Encoding: identity` に従わない場合、本文を解析できないことがあります。
- HTML本文は先頭1,000,000 byteまでです。
- Response TimeはCore Web Vitalsではありません。
- Technology detectionはhintであり、FrameworkやVersionを保証しません。
- Static HTMLだけではContrast、Keyboard操作、Screen Reader体験、Modal focus、動画字幕等を完全監査できません。
- AIのBusiness Impactと改善案は推論です。Evidenceで確認できる事実と区別し、Human Reviewしてください。
- Prompt Injection Signal検出はすべての攻撃表現を網羅しません。
- Live AI利用時は監査Factと上限付き本文Snippetが外部Providerへ送られます。
- Rate Limitはinstance-localであり、分散Abuse protectionではありません。
- Database、Login、Team共有、Server-side長期Run履歴、通知、外部サイトへの自動修正は実装していません。
- Browser / Region / Network / 対象サイト状態によって同じURLでも結果が変わります。

## License / usage boundary

Repository公開時のLicense有無と利用条件はGitHub上の実ファイルを確認してください。READMEだけで第三者利用権を付与するものではありません。
