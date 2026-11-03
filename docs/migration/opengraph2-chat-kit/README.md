# opengraph2 遷移指南：Analysis step 改用 chat-kit（Google AI Studio）

本指南把「Remix: OpenGraph2 圖片製作大師」（下稱 opengraph2）的 **Analysis step**（`/api/analyze-og`）從 Gemini SDK 改為 `@hk01/pi-ai-extra-chat-kit`，讓用戶在 header 自行選擇分析用的 provider 和 model。對應 [DATA-4630](https://hk01-digital.atlassian.net/browse/DATA-4630)。

## 為甚麼要改

opengraph2 分兩個階段工作：先由文字模型讀樣板、素材圖和 logo，寫出生圖指令（Analysis step）；再由圖片模型生圖。Analysis step 固定用 Google 的 `gemini-3.8-flash`，受 Tier 2 限制回 429，所以整個流程無法開始。生圖早已走 image-kit，可用 KIE 和 ToAPIs，不受影響。（背景見 [Slack 討論](https://hk01.slack.com/archives/C0ASAHJUK40/p1793444521624199?thread_ts=1793343039.774739&cid=C0ASAHJUK40)。）

opengraph2 是 open-graph-single 的 **Backup app**：open-graph-single 用不到時，由用戶自行轉用；轉用是人的決定，不是 fallback（見 [CONTEXT.md](../../../CONTEXT.md)）。同一個原則用在 Analysis step：app 不會替用戶換 model 或 provider，失敗時由用戶決定。

## 分析模型清單

清單由 server 擁有（`server/analysisModels.ts`），browser 只送 key，不認識的 key 回 400。缺 key 的 provider 會標示為不可選。

| Key | 模型 | 用的 secret |
| --- | --- | --- |
| `kie:gemini-3-8-flash`（預設） | KIE 的 Gemini 3.8 Flash（與原本相同的模型） | `KIE_API_KEY` |
| `kie:gemini-3-6-flash` | KIE 的 Gemini 3.6 Flash | `KIE_API_KEY` |
| `kie:gemini-4-argon` | KIE 的 Gemini 4 Argon | `KIE_API_KEY` |
| `kie:claude-sonnet-5-5` | KIE 的 Claude Sonnet 5.5 | `KIE_API_KEY` |
| `kie:gpt-6-luna` | KIE 的 GPT-6 Luna | `KIE_API_KEY` |
| `google:gemini-3.8-flash` | Google 的 Gemini 3.8 Flash（額度恢復後可用） | `GEMINI_API_KEY` |

KIE 的 Gemini 為甚麼走 Chat Completions，而不走 Gemini 原生 route：見 [ADR 0010](../../adr/0010-kie-gemini-chat-completions-route.md)。

## 版本

| Package | 版本 | 備註 |
| --- | --- | --- |
| `@hk01/pi-ai-extra-chat-kit` | 0.4.1 | 新增 |
| `@earendil-works/pi-ai` | 1.2.0 | 新增，chat-kit 要求剛好這個版本 |
| `@hk01/pi-ai-extra-kie` | 0.7.0 | 由 0.6.0 升級，加入 KIE 的三個 Gemini 模型 |
| `@hk01/pi-ai-extra-google` | 0.8.0 | 由 0.7.0 升級 |
| `@hk01/pi-ai-extra-image-kit` | 0.2.0（不變） | |
| `@hk01/pi-ai-extra-toapis` | 0.6.0（不變） | |

## 怎樣使用

1. **確認 kie 0.7.0 已發佈**：下面三條 URL 都要能下載。kie 0.7.0 未發佈前，Part 1 的 `npm install` 會失敗。
   - `https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.7.0/hk01-pi-ai-extra-kie-0.7.0.tgz`
   - `https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.8.0/hk01-pi-ai-extra-google-0.8.0.tgz`
   - `https://github.com/kpkonghk01/pi-ai-extra/releases/download/chat-kit-v0.4.1/hk01-pi-ai-extra-chat-kit-0.4.1.tgz`
2. 在 AI Studio 匯出整個 app 的 ZIP 備份。
3. 依序貼上三段 prompt。**每段貼完，等 Gemini 回報 `npm run lint` 的結果，才貼下一段：**
   1. [`gemini-prompt-part1.md`](gemini-prompt-part1.md)：升級 package，刪除三個多餘的 workaround。
   2. [`gemini-prompt-part2.md`](gemini-prompt-part2.md)：server，Analysis step 改用 chat-kit，新增 `/api/analysis-models`。
   3. [`gemini-prompt-part3.md`](gemini-prompt-part3.md)：UI，header 的分析模型選單、失敗 modal、刪除生圖的自動重試。
4. 三段都完成後，按下面「驗證清單」測試。

每步都寫成「找這段原文 → 換成這段」。Gemini 找不到原文、或原文出現次數不對時，prompt 要求它停下來報告，不要自行猜測。

需要核對 Gemini 的改動時，用這兩份參考：

- `files/`：已驗證的完整檔案：`package.json`、`.env.example`、`server.ts`、`server/analysisModels.ts`、`server/imageModels.ts`、`src/types.ts`。
- `changes.diff`：全部改動（`package-lock.json` 除外），包括 4,239 行的 `src/App.tsx`（所以沒有放完整版本）。

注意：這些檔案是根據 2026-11-03 的 opengraph2 版本寫的。在 AI Studio 做過其他改動後，不要整份貼上 `files/` 的檔案，會覆蓋那些改動；照 prompt 一步一步做。

## 用戶會看到的改變

- **Header 多了一個分析模型選單**，在圖片模型選單旁邊，樣式相同，按 provider 分組。預設是 KIE 的 Gemini 3.8 Flash。缺 key 的選項顯示為灰色並寫明原因。選擇存在瀏覽器，重新載入後保留；清單裏沒有的舊選擇會回到預設。
- **分析失敗不再靜默略過。** 以前選 KIE 或 ToAPIs 圖片模型時，分析失敗只在 console 警告，然後用原始指令生圖；選 Google 圖片模型時則整個流程報錯。現在任何分析失敗都會：
  1. 在現有的錯誤面板顯示詳情（provider、model、code、status，可複製）；
  2. 彈出 modal，三個選擇：**重新分析**、**略過分析，用原始指令繼續生圖**、**取消**。
  - 不會自動重試，也不會改用其他模型。
- **生圖不再自動重試。** 以前網絡中斷時，同一張圖會自動再送一次；現在只送一次，失敗時由錯誤面板顯示。
- **取消**也會中止進行中的分析請求。
- 分析費用不在 UI 顯示，也不計入每張圖的 HKD 費用。server 每次分析印一行 log：模型、耗時、provider 報的費用（例如 `[analyze-og] kie:gemini-3-8-flash stop 19.4s cost=US$0.00135`），不印 prompt 或圖。

## 順手清理的三項

| 項目 | 原因 |
| --- | --- |
| `server/imageModels.ts` 的 `patchedFetch` | 把 Google 2.1 的 `/v1/` 改寫成 `/v1beta/`。用 AI Studio key 實測過：`/v1` 對 Nano Banana 2.1 正常（`GET /v1/models/gemini-nano-banana-2.1` 回 200，真實出圖請求到達模型，沒有 404）。image-kit 也沒有設定 base URL 的選項，google package 才是 2.1 transport 的唯一負責人（[ADR 0007](../../adr/0007-catalogue-policy-model-selection.md)）。 |
| `scripts/patch-google-extra.cjs` 和 `postinstall` | 同一個 patch，直接改 `node_modules` 裏的 google package。 |
| `src/App.tsx` 生圖迴圈的 `maxAttempts = 2` | 網絡錯誤時把同一個請求再送一次，違反這個 app「一次請求、失敗由用戶決定」的規則。 |

另外移除了 `@google/genai`：只有舊的分析 route 用它。

## 已知問題

- **樣板、素材圖和 logo 會送到 KIE**（用 KIE 的分析模型時）。Slack 討論中已接受這個風險（這些圖片較少敏感資料）。
- **Gemini 4 Argon 的回覆夾帶 `[cite: n]` 標記**，可能混進送給生圖模型的指令，所以它不是預設。
- **KIE 的 Gemini 限時折扣會結束**：Gemini 4 Argon 在 2026-11-30，Gemini 3.8 / 3.6 Flash 在 2026-12-31，之後價格會變。app 不計分析費用，只在 server log 印 KIE 報的數字。
- **KIE 的 Gemini 沒有 live model list**，由 package 的定義直接提供。KIE 日後下架某個模型時，用戶會在分析失敗的 modal 看到 KIE 自己的錯誤訊息（例如 `The model is not supported`）。
- **KIE 的 Gemini 不回報 `finish_reason`**，所以回覆在 token 上限被截斷時也會顯示為正常結束。
- `npm run lint` 在 opengraph2 一向有一個既有的錯誤：`'ErrorBoundary' cannot be used as a JSX component`（`src/App.tsx`）。與本次遷移無關，沒有處理。

## 已驗證的範圍

在 opengraph2 的副本上做的，不是在 AI Studio。副本是 2026-11-03 的 clone，沒有改動 clone 本身。kie 0.7.0 當時未發佈，副本用本機打包的 tarball。

- **逐字回放**：把三段 prompt 的 Markdown 文字（只用 Find / Replace 的內容）套用到全新的副本，28 個編輯每個 Find 都按文字所說的次數找到；結果的 7 個檔案和 `files/` 完全一致。
- **Lint**：只有上面那個既有的錯誤，改動前的原版同樣有。
- **Build**：`npm run build` 通過。搜尋 `dist/assets/`，找不到 provider package 的程式碼，也找不到 `KIE_API_KEY`、`GEMINI_API_KEY` 這些名稱。
- **Server 實測**：用 `node dist/server.mjs` 實際呼叫，只給它 `KIE_API_KEY`。
  - `GET /api/analysis-models`：六個模型，預設 `kie:gemini-3-8-flash`，Google 的標示為「伺服器未設定 GEMINI_API_KEY」，回應不含 key。
  - 不認識的 key 回 400；缺 key 的 Google 回 503（`missing_key`）。
  - 預設模型，4.4 MB 的圖（1 張樣板、3 張素材、1 個 logo，共 5 張）：回 200，兩次實測分別 19.4 秒和 39.9 秒（120 秒 timeout 之內），`TITLE_KEYWORD` 和 `REFINED_PROMPT` 解析正確。
  - Claude Sonnet 5.5：回 200。
  - 客戶端取消：server 中止了分析（log 為 `aborted`）。
  - 無效的 KIE key：回 502，訊息帶 KIE 的原文（`KIE code 401`），`details` 有 provider、model 和 status。

**沒有驗證的**：UI 在瀏覽器的行為（要 Firebase 登入）。選單、失敗 modal 三個按鈕、取消、生圖不再重試，都只通過了 lint 和 build，沒有實際點過。Google 的分析模型也沒有實際呼叫（Gemini 3.8 Flash 在 Tier 2 本來就會回 429）。這兩項要在 AI Studio 測。

## 驗證清單

在 AI Studio 的 Secrets 確認 `KIE_API_KEY` 已設定（`GEMINI_API_KEY` 有的話，Google 的選項才可選）。

- [ ] Header 有分析模型選單，預設是 KIE 的 Gemini 3.8 Flash；Google 的選項在沒有 key 時是灰色並寫明原因。
- [ ] 用預設模型生圖：進度先顯示「正在分析樣板與指令」，再顯示「正在生成圖片」，出圖正常。
- [ ] 重新載入頁面，分析模型的選擇保留。
- [ ] 選 Google 的 Gemini 3.8 Flash（Tier 2 下預期 429）：彈出 modal，錯誤面板同時顯示 `google/gemini-3.8-flash`、code 和 status。
  - 按「重新分析」：再呼叫一次，不多於一次。
  - 按「略過分析，用原始指令繼續生圖」：繼續生圖。
  - 按「取消」：整個流程停止，沒有圖片。
  - modal 開著時按畫面上原有的「取消」按鈕：同樣停止。
- [ ] 分析進行中按取消：流程停止，server log 看到 `aborted`。
- [ ] 生圖途中斷網（或用瀏覽器開發工具的 offline）：只顯示錯誤，沒有第二次請求。
- [ ] 深度編輯和 AI 智能擦除 Logo 照常運作（這次沒有改動這兩條 route）。
