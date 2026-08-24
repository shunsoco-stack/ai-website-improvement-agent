# ポートフォリオ掲載用 完全版プロンプト

以下を、そのまま既存ポートフォリオサイトの編集・UI実装担当へ渡してください。

---

あなたは、AIエージェント作品を既存ポートフォリオへ追加する編集・UI実装担当です。既存ポートフォリオの作品Data型、一覧Card、詳細Page、Category Filter、画像配置、外部Link表示条件、Responsive規則、Test方法を最初に確認し、既存Design Systemを再利用してください。

追加する作品は「AI Webサイト改善エージェント」です。単なるAIチャットや「URLをAIに評価させる」画面として紹介せず、次のAgent Workflowが伝わる掲載にしてください。

```text
Goal
↓
Planning / Human approval
↓
Limited Crawl
↓
Deterministic Audit
↓
AI Interpretation または明示されたRule-based Demo解釈
↓
Re-investigation
↓
Deterministic Priority
↓
Improvement Backlog / Suggested Fix
↓
Human Review
```

## 1. 作業前のSource of truth

掲載Copyと数値は、次の実ファイルとProductionを確認してから確定してください。

- App README: `ai-website-improvement-agent/README.md`
- QA: `ai-website-improvement-agent/docs/QA.md`
- App source: `ai-website-improvement-agent/src/`
- Icon: `ai-website-improvement-agent/src/app/icon.svg`
- Screenshots: `ai-website-improvement-agent/docs/screenshots/`
- Expected Vercel URL: `https://ai-website-improvement-agent.vercel.app`
- Expected GitHub URL: `https://github.com/shunsoco-stack/ai-website-improvement-agent`

VercelとGitHubを実際に開き、HTTP 200、作品名、README、Production Screenshotとの一致を確認してください。未公開、404、別作品、認証画面の場合はURLを推測して置き換えず、公開担当へ確認してください。QAで`PENDING`のTest件数、Deployment ID、Verified commitを掲載本文へ持ち込まないでください。

## 2. 固定メタデータ

- 作品名: AI Webサイト改善エージェント
- 英語補助表記: AI Website Improvement Agent
- Slug候補: `ai-website-improvement-agent`
- カテゴリ: **AIエージェント**
- サブカテゴリ: **Web改善・監査エージェント**
- 作品種別: 自主制作 / Concept Project
- 対応: Web / Desktop / Tablet / Smartphone
- 専用アイコン: Globe + Wrench + AI Nodes
- Icon path: `ai-website-improvement-agent/src/app/icon.svg`
- Primary CTA: `アプリを試す ↗`
- Primary CTA URL: `https://ai-website-improvement-agent.vercel.app`
- Secondary CTA: `GitHubを見る`
- Secondary CTA URL: `https://github.com/shunsoco-stack/ai-website-improvement-agent`
- README URL: `https://github.com/shunsoco-stack/ai-website-improvement-agent/blob/main/README.md`

既存に「WebサイトURL一括チェック・リンク監査ツール」が掲載されていても置き換えないでください。既存作品はURL / HTTP / Metadata確認とExportを中心とする業務効率化ツール、本作品はGoal、Plan、AI Interpretation、Observation-driven Re-investigation、Priority、Backlog、Human Reviewを中心とするAIエージェントであり、役割が異なります。

## 3. 一文要約

URLと改善Goalから、制限付きCrawl、決定論的監査、AI解釈、Patternの再調査、優先順位、改善Backlog、Human Reviewまでを自律的に進めるWeb改善エージェント。

## 4. 課題と解決

### 課題

- SEO、UX、Conversion、Technicalの確認が別々のCheck Listへ分かれやすい。
- AIへページ本文だけを渡すと、HTTP Status等の事実、推測、提案が混ざりやすい。
- 問題一覧だけでは、何から直すか、なぜ重要か、どのPageが根拠か判断しにくい。
- 重複Title等が複数Pageへ広がる場合、最初の検出だけで終えるとTemplate Patternを見落とす。
- 任意URLをBackend Fetchする機能にはSSRF、Redirect先、Timeout、負荷上限が必要である。
- AIに外部サイト変更権限を与えると、人が確認する前に本番へ影響する危険がある。

### 解決

- GoalをSEO / UX / Conversion / Technical Audit / リニューアル調査から選択。
- 実行前に8段階PlanとMax Pages / Depth / Concurrency / Timeoutを確認。
- HTTP、Redirect、Metadata、基本Accessibility Signalを通常コードで測定。
- AIにはimmutableなFindingとEvidenceだけを渡し、意味・Business Impact・改善案・不確実性を構造化。
- Duplicate Title、alt不足、Canonical不足、Form Label不足等の反復から追加調査Taskを生成。
- `Impact × Confidence ÷ Effort`でHigh / Medium / Lowを決定論的に分類。
- Critical / Quick Win / Medium-term / OptionalのBacklogとBefore → Suggestedを作成。
- Human ReviewでApprove / Changes requestedを選び、外部変更は一切行わない。

## 5. 完成Workflow

次の順序を崩さず、画面と技術を結び付けて説明してください。

1. **Goal** — 改善目的、URL、Business Contextを入力。
2. **Planning** — Site CrawlからHuman Reviewまでの8段階Planを生成。
3. **Plan Approval** — 上限とTaskを人が確認してから実行。
4. **Crawl** — 同一Originの内部LinkをBFSで制限付き探索。
5. **Deterministic Check** — HTTP、Redirect、Metadata、HTML Signalを通常コードで確認。
6. **AI Interpretation** — Factを変えず、意味・Impact・Recommendation・不確実性を整理。
7. **Re-investigation** — 反復Patternから未監査の関連Pageを上限内で追加確認。
8. **Priority** — 明示式でHigh / Medium / Lowを分類。
9. **Improvement Backlog** — Critical / Quick Win / Medium-term / Optionalへ整理。
10. **Suggested Fix** — Before → Suggestedと、必要に応じ標準HTML例を提示。
11. **Human Review** — ApproveまたはChanges requested。外部サイトは変更しない。

## 6. Goal / Planning

Goalは複数選択できます。

- SEO改善
- UX改善
- Conversion改善
- Technical Audit
- リニューアル調査

Planの8 Step:

1. Site Crawl
2. Metadata確認
3. Broken Link確認
4. Content確認
5. UX・Accessibility整理
6. Technical Issues・AI Interpretation
7. Priority設定・追加調査
8. Improvement Plan・Human Review

「AIが勝手に開始する」と表現せず、Plan承認後に実行するAgencyと予測可能性を説明してください。

## 7. Crawl / execution limits

Live Crawlは同一Originの内部LinkだけをBFSで探索します。Fragmentと重複を除き、外部Linkはqueueへ追加しません。

画面のDemo初期値:

| Setting | Default |
| --- | ---: |
| Max Pages | 18 |
| Depth | 2 |
| Concurrency | 3 |
| Timeout | 8,000 ms |
| Agent Max Tool Calls | 44 |
| Crawl fetch cap | 36 |
| Max Retry | 1 |
| Agent Max Duration | 120,000 ms |

Live UIではMax Pages 3–50、Depth 0–3、Concurrency 1–4、Timeout 4–15秒を選べます。Agent Tool Call上限は`min(80, max(20, Max Pages × 2 + 8))`、Crawl fetch capは`min(60, max(15, Max Pages × 2))`で導出します。Page、Tool Call、Retry、Duration、Re-investigation、同一Pattern Loopを制限し、停止理由をActivityへ残す設計です。「無制限にサイト全体をCrawl」とは書かないでください。

## 8. Deterministic audit

AIではなく通常コードで確認する項目です。

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
- `alt`属性なし
- Accessible Nameを確認できないForm Control / Button
- Heading level jump
- HTML markerからのTechnology Hint

Response TimeはBrowser renderingやCore Web Vitalsではありません。Technology Hintは静的markerによる補助であり、FrameworkやVersionを断定しません。

## 9. Evidence

Issue detailでは次を中心に見せてください。

- URL
- Page
- Detected Fact
- Source
- Locator（取得できる場合）
- Checked At
- 安定Fingerprint

AI InterpretationはEvidenceと視覚的に分離し、「観測事実」と「解釈・推奨」を混ぜないでください。

## 10. AI / Rule-based modeの正確な表現

`OPENAI_API_KEY`が設定されている場合、Server側からOpenAI Responses APIを呼び、JSON Schema Strict Structured Outputで、各IssueのMeaning、Business Impact、Recommendation、Uncertaintyを取得します。

Providerへ渡す外部本文は信頼できないDataとして分離します。AIはPriority、Evidence、URL、HTTP Status、Crawl Limitを変更できません。

API Keyがない場合は、画面どおり **Rule-based Demo解釈** と書いてください。Provider失敗時は **AI失敗時のRule-based解釈** です。通常コードの定型文を「AIが生成した」と紹介してはいけません。

### Prompt Injection対策

- 対象本文はAgent指示ではなく`untrusted_web_content`
- Script / Style / iframe等と制御文字を除去
- role delimiterをneutralize
- InstructionとWebsite Dataを分離
- よくあるInstruction Override Signalを記録
- Provider outputを許可済みIssue IDとSchemaで再検証
- 外部Site変更Toolを持たない

Pattern検出だけで全Prompt Injectionを防げるとは書かないでください。主防御はInstruction / Data分離、権限制限、Schema validationです。

## 11. Priority / Backlog

Priority式は正確に掲載してください。

```text
score = Impact (1–3) × Confidence (1–3) ÷ Effort (1–3)

High   : 4.5以上
Medium : 2.0以上4.5未満
Low    : 2.0未満
```

Backlog:

- Critical
- Quick Win
- Medium-term
- Optional

PriorityはAIの主観点数ではなく通常コードのRuleです。AIは意味やBusiness Impactを説明しますが、scoreを変更しません。

## 12. Re-investigation

Agentらしい機能として、次を省略しないでください。

```text
Title重複を複数Pageで検出
↓
Pattern fingerprintを作成
↓
関連Pageの未監査Linkを上限内で追加確認
↓
Template / URL PatternとしてFindingを更新
↓
ActivityとEvidenceへ記録
```

Duplicate Titleに加え、alt不足、Canonical不足、Form Label不足の複数Page Patternを扱います。Max Re-investigation、Max Additional Pages、Page / Tool Call Limit、完了済みFingerprintでLoopを止めます。

## 13. Suggested Fix / Human Review

次の形式を見せてください。

```text
Title
Before
↓
Suggested

Meta Description
Before
↓
Suggested
```

Title、Description、Canonical、H1、alt、Label、HTTP / Link等は、Evidenceに基づく修正案を表示します。Technologyが確認できない場合、Code Exampleは標準HTMLとして提示し、React / Next.js / CMS実装を断定しません。

Human ReviewはApprove / Changes requestedを扱います。本作品はCMS更新、Repository Commit、PR、Deploy、DNS変更、メール送信を行いません。`externalChangesApplied`は常に`false`です。

## 14. Compare mode / Activity log

Run AとRun BをIssue fingerprintで比較します。

- 改善済み
- 新規問題
- 未解決

Activityは次のPhaseを時系列表示します。

- Crawl
- Check
- AI Analyze
- Recheck
- Report
- Approval
- Guardrail

Compareは同一条件の補助です。対象サイトやNetworkは時刻で変化するため、因果関係や恒久的修正を保証するものではありません。

## 15. Demo mode

3タイプを掲載してください。

### Corporate Site

架空のB2B企業「Aoba Solutions」5 Pageです。重複Title、Canonical、alt、Form Label、404、曖昧CTAを確認し、問い合わせ本文中のPrompt Injection SignalをUntrusted Contentとして隔離します。

### EC Site

架空の生活用品EC「Nagi Market」5 Pageです。Category、商品詳細、CartのDescription / Canonical、商品画像alt、Slow Response、Filter状態、Checkout Error recoveryを確認します。

### Landing Page

架空SaaS「Haru Flow」のLPを起点とする3 Pageです。Description、Canonical、Heading jump、競合CTA、Signup Form、Slow Responseを確認します。

固定Demo期待値:

| Scenario | Pages | Issues | Rechecks | Critical | Quick Win | Medium-term | Optional | Run A → B（改善 / 新規 / 未解決） |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Corporate Site | 5 | 11 | 2 | 1 | 8 | 1 | 1 | 1 / 1 / 10 |
| EC Site | 5 | 8 | 1 | 0 | 5 | 3 | 0 | 1 / 1 / 7 |
| Landing Page | 3 | 12 | 1 | 0 | 7 | 5 | 0 | 1 / 1 / 11 |

3 RunともCompleted Human Reviewで、`externalChangesApplied`は`false`です。ActivityはCrawl → Check → AI Analyze（Demo rule-based）→ Recheck → Report → Approvalを保持します。Portfolioへ数値を掲載する場合は、Production UIと最新Testで同じ値を再確認してください。

Demo内の企業、商品、数値、URLは架空です。実在顧客、制作実績、導入成果として紹介しないでください。Demoは同じSynthesis、Priority、Re-investigation、Backlog、Human Reviewを通しますが、Live Internet Crawlを行ったとは書かないでください。

## 16. SSRF / resource safety

任意URLへ接続するBackendの主要技術として説明してください。

- HTTP / HTTPSのみ
- URL長2,048文字まで
- credentials入りURLを拒否
- Port 80 / 443のみ
- localhost、single-label host、internal suffixを拒否
- loopback、private、link-local、CGNAT、reserved、documentation、multicast等を拒否
- Cloud metadata host / IPを拒否
- DNSの全Answerがpublicの場合だけ許可
- 検証済みIPへSocketを接続し、Host Header / TLS SNIは元Hostnameを維持
- Redirect各HopでURL / DNS policyを再適用
- TLS certificate validation

主要上限:

| Control | Value |
| --- | ---: |
| Per-hop timeout | 8秒 |
| Per-URL audit deadline | 24秒 |
| Redirect limit | 6 |
| HTML body | 1,000,000 byte |
| API JSON body | 16 KiB |
| API rate bucket | 120 Request / 60秒 / Client key |
| Backend active checks | 6 |
| Same-origin active checks | 3 |
| Vercel Function max duration | 30秒 |

Rate LimitはFunction instance内Memoryのbest-effortであり、分散Rate Limitではありません。「SSRFを完全防止」「脆弱性診断済み」「WAF相当」「安全を保証」とは書かないでください。

## 17. Architecture / Tech stack

```text
React Agent Workspace
├─ Goal / Plan approval
├─ Bounded BFS scheduler
├─ Activity / Usage / Stop
├─ Synthesis / Priority / Backlog
├─ Re-investigation / Compare
└─ Human Review
        │
        ├─ POST /api/check
        │   └─ SSRF → pinned HTTP(S) → static HTML audit
        │
        └─ POST /api/interpret
            ├─ Optional OpenAI Structured Outputs
            └─ Explicit Rule-based fallback
```

Tech stack:

- Next.js 16.3 / App Router
- React 19.2
- TypeScript 5.9
- Node.js 24 native HTTP / HTTPS / DNS / Crypto
- Optional OpenAI Responses API / JSON Schema Structured Outputs
- Lucide React
- Vitest / Testing Library / jsdom
- Vercel Functions

Database、Authentication、Team共有、外部サイトへの書込みToolはありません。

## 18. Apple Design / Accessibility

Apple製品の見た目をコピーしたと説明せず、次の設計判断として紹介してください。

- Safety / Predictability: Plan承認、上限、Activity、Human Review
- Agency: Stop、Goal選択、Approve / Changes requested
- Simplicity: Goal → Plan → Run → Evidence → BacklogのWayfinding
- Responsibility: SSRF、Prompt Injection、No external mutation
- Craft: system font、Size別tracking / leading、即時Feedback、明確なfocus
- Statusを色だけに依存しない
- Keyboard操作とSemantic form / dialog
- 44pxを基本とする主要Touch target
- `prefers-reduced-motion`
- `prefers-reduced-transparency`
- `prefers-contrast`
- Desktop / Tablet / Smartphone

対象サイトに対するAccessibility監査は、静的HTMLのalt、Label、Heading等の一部です。Contrastはrender後のcomputed styleが必要なためHuman Reviewです。WCAG準拠認証や完全なAccessibility監査とは書かないでください。

## 19. 使用するスクリーンショット

Vercel Productionの実画面5枚だけを、次の順序で使用してください。存在しない画像をAI生成、合成、DevToolsで改変しないでください。画像が未取得なら掲載を完了せず、公開担当へ依頼してください。

### 1. Goal / Plan — メイン画像、一覧Card thumbnail

- Path: `ai-website-improvement-agent/docs/screenshots/01-goal-plan.png`
- Caption: 改善Goalと実行上限を、8段階Planとして承認するWorkspace
- Alt: SEO、UX、Conversion、Technical Audit、リニューアル調査のGoal、URL、Max Pages、Depth、Concurrency、Timeout、8段階Planを表示するAI Webサイト改善エージェント

### 2. Crawl Progress

- Path: `ai-website-improvement-agent/docs/screenshots/02-crawl-progress.png`
- Caption: Page・Depth・Tool Callを制限しながら進むCrawlと監査Activity
- Alt: Checked、Discovered、現在URL、Depth、Tool Calls、CrawlとCheckのActivityを時系列表示する制限付きWebサイトCrawl画面

### 3. Issue Dashboard

- Path: `ai-website-improvement-agent/docs/screenshots/03-issue-dashboard.png`
- Caption: Technical、Content、UX、AccessibilityをPriorityとEvidenceで俯瞰
- Alt: Technical、Content、UX、Accessibilityの件数、High、Medium、Lowの優先順位、Issue一覧とFilterを表示する監査Dashboard

### 4. Issue Detail + Evidence

- Path: `ai-website-improvement-agent/docs/screenshots/04-issue-detail-evidence.png`
- Caption: Detected FactとAI Interpretationを分離し、修正案まで追跡するIssue Detail
- Alt: URL、Page、Detected Fact、Source、問題の意味、Business Impact、改善案、不確実性、BeforeからSuggestedへの修正案を表示するIssue詳細画面

### 5. Improvement Backlog

- Path: `ai-website-improvement-agent/docs/screenshots/05-improvement-backlog.png`
- Caption: CriticalからOptionalまでを整理し、人が最終判断する改善Backlog
- Alt: Critical、Quick Win、Medium-term、Optionalの改善Backlog、Priority計算根拠、Human ReviewのApproveとChanges requestedを表示する画面

詳細Pageでは原則`object-fit: contain`を使い、Evidence、Priority式、Guardrail、Human Reviewを切り落とさないでください。

## 20. 掲載Copy

### 一覧Card

タイトル: AI Webサイト改善エージェント

カテゴリ表示: AIエージェント / Web改善・監査エージェント

短文: URLと改善Goalから、制限付きCrawl、決定論的監査、AI解釈、再調査、優先順位、改善Backlog、Human Reviewまで進めるWeb改善エージェント。

タグ候補:

`Next.js` `TypeScript` `AI Agent` `Website Audit` `Crawler` `SEO` `UX` `Accessibility` `Structured Outputs` `SSRF Protection` `Human in the Loop` `Vercel`

Thumbnail: `ai-website-improvement-agent/docs/screenshots/01-goal-plan.png`

### Detail Hero

Eyebrow: EVIDENCE-FIRST WEBSITE IMPROVEMENT AGENT

見出し: 評価で終わらず、調査・再調査・改善判断まで。

リード: SEO、UX、Conversion、TechnicalのGoalから実行Planを作り、内部Pageを上限制御付きで探索。HTTPとHTMLのFactを通常コードで確認し、AIは意味とBusiness Impactを整理します。Patternの追加調査、Priority、改善Backlog、Human Reviewまでを一つのRunへつなぎました。

Primary CTA: `アプリを試す ↗`

Secondary CTA: `GitHubを見る`

### Problem section

見出し: 問題一覧だけでは、改善は始められない。

本文: Web監査では、StatusやMetadataを集めるだけでなく、どのGoalに影響し、どのPageが根拠で、同じPatternがどこまで広がり、何から直すかを判断する必要があります。AIへ丸投げすると、観測Fact、推測、提案が混ざりやすいことも課題でした。

### Solution section

見出し: Factはコードで。意味はAIで。判断は人に。

本文: HTTP、Redirect、Metadata、基本Accessibility Signalを通常コードで取得し、AIにはEvidenceを変更できない形でInterpretationだけを依頼。反復Patternを追加調査し、明示式でPriorityを算出、BacklogとSuggested FixをHuman Reviewへ渡します。

### Security section

見出し: 任意URLと外部本文を、安全設計の対象にする。

本文: Backend FetchではPrivate / link-local / metadata endpointを拒否し、DNS全Answerを検証して接続先IPを固定。Redirect先にも同じPolicyを適用します。Web本文は信頼できないDataとしてInstructionから分離し、Provider outputもSchemaとEvidence IDで再検証します。

### Human review section

見出し: 修正案を出す。公開サイトは変えない。

本文: Agentの出力は改善Plan、Evidence、Before → Suggestedまでです。CMS、Repository、Hostingへ書き込むToolは持たず、ApproveまたはChanges requestedをHuman Reviewとして残します。

## 21. 詳細Pageの推奨構成

1. Category / App name / Hero / CTA / Goal-Plan screenshot
2. 課題: 評価で終わらないWeb改善Workflow
3. Goal選択と8段階Planning
4. Limited CrawlとGuardrail
5. Deterministic Audit
6. Evidence-first AI Interpretation / Rule-based Mode
7. Prompt Injection / SSRF
8. Re-investigation
9. Priority式とIssue Dashboard
10. Suggested Fix / Technology qualifier
11. Improvement Backlog / Human Review
12. Compare Mode / Activity Log
13. 3 Demo
14. Architecture / Test / Production verification
15. Responsive / Accessibility / Apple Design
16. Known Limitations / CTA

各Sectionは「何を表示するか」だけでなく、「どの判断を可能にするか」を説明してください。

## 22. Known limitations

掲載では次を隠さないでください。

- 権限のあるSiteだけを監査する。利用規約、robots.txt、法的許可を自動判定しない。
- JavaScriptを実行せず、初期HTMLを解析する。
- Login / Cookie / custom Header / private network Site非対応。
- Port 80 / 443だけを許可。
- HTML bodyは先頭1,000,000 byteまで。
- Response TimeはCore Web Vitalsではない。
- Technology detectionはHint。
- Contrast、Keyboard、Screen Reader体験等はTarget SiteでHuman Reviewが必要。
- AI Interpretationは推論で、Evidence Factと区別する。
- Prompt Injection Signalは未知表現を網羅しない。
- Live AIでは上限付き本文Snippetが外部Providerへ送信される。
- Rate Limitはinstance-local。
- Database、Authentication、Team共有、長期履歴、外部サイトの自動変更なし。
- 同じURLでもNetworkや対象Site状態により結果が変わる。

## 23. 禁止事項

- AIがHTTP Status、Broken Link、Priority scoreを生成すると書かない。
- Rule-based Demo / fallbackをAI生成と書かない。
- AIがサイトを修正、Deploy、Commit、CMS更新すると書かない。
- 無制限Crawl、サイト全体の完全取得と書かない。
- Headless Browser、Core Web Vitals、Lighthouse、JavaScript renderを実装済みと書かない。
- Contrast、Keyboard、Screen Reader、WCAG準拠を自動保証すると書かない。
- Technology Hintを確定Framework / Versionと書かない。
- Prompt InjectionやSSRFを完全防止すると書かない。
- Rate Limitを分散型と書かない。
- Vercel Firewall、WAF、Penetration Testを未確認でPassと書かない。
- DemoをLive Internet Crawlや実顧客Resultと書かない。
- 実在顧客、導入成果、改善率、Conversion uplift、ROIを捏造しない。
- QAでPendingのTest件数、Deployment ID、Commitを推測しない。
- 存在しないScreenshot、Mobile画面、Export、共有、通知、履歴を追加しない。
- ScreenshotをAI生成または合成しない。
- 既存のWeb URL監査ツールを削除・上書きしない。

## 24. 受入基準

- [ ] カテゴリが`AIエージェント`、サブカテゴリが`Web改善・監査エージェント`である。
- [ ] Globe + Wrench + AI Nodesの専用Iconを使用している。
- [ ] Primary CTAが詳細Page冒頭にあり、`アプリを試す ↗`である。
- [ ] GitHub CTAがある。
- [ ] Goal → Planning → Crawl → Deterministic Audit → AI Interpretation → Re-investigation → Priority → Backlog → Human Reviewが伝わる。
- [ ] Deterministic FactとAI Interpretationを分離している。
- [ ] Rule-based ModeをAIと偽っていない。
- [ ] Max Pages、Depth、Concurrency、Timeout、Tool Call、Retry、Durationを説明している。
- [ ] EvidenceのURL、Page、Detected Fact、Sourceを説明している。
- [ ] Priority式が`Impact × Confidence ÷ Effort`で正しい。
- [ ] Critical / Quick Win / Medium-term / Optionalを説明している。
- [ ] Duplicate Title等のObservation-driven Re-investigationとLoop Limitを説明している。
- [ ] Before → SuggestedとTechnology qualifierを説明している。
- [ ] 外部サイトを自動変更しないHuman Reviewを説明している。
- [ ] Technical / Content / UX / Accessibilityの4観点がある。
- [ ] Corporate / EC / Landing Pageの3 Demoを架空Dataとして説明している。
- [ ] SSRFとPrompt Injectionの実装範囲、上限、限界を正確に説明している。
- [ ] 5枚のProduction実画面を指定順で使い、具体的なCaptionとAltがある。
- [ ] Vercel / GitHub / Test resultがQAの実測と一致する。
- [ ] 既存ポートフォリオのResponsive / Accessibility / Design Systemへ統合されている。

最終成果物は、閲覧者が「WebサイトをAIに採点させた作品」ではなく、「安全に探索し、Factを測り、AIが解釈し、Observationから追加調査し、優先順位とBacklogを人の判断へ渡すAgentic Workflow」と理解できる状態にしてください。

---
