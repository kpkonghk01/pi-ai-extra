# open-graph-single 遷移指南（Google AI Studio）

將 open-graph-single（即 Jira 上的 remix-open-graph-single）的 KIE、ToAPIs、Gemini 生圖邏輯，換成 `@hk01/pi-ai-extra-*` packages。對應 [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512) P0。

有兩種做法：

- **建議：交給 AI Studio 的 Gemini 改。** 把 [`gemini-prompt.md`](gemini-prompt.md) 整份貼給 AI Studio 的 Gemini。它包含已驗證的 `imageClient.ts`，也包含 server 和 UI 的逐步修改要求：
  - 完全禁止 fallback；
  - 錯誤連同 provider、model、code、task id 持續顯示在 UI，並提供「複製錯誤資訊」；
  - 移除前端自動重試。
- **手動：** `files/` 內是改好的 server 端完整檔案，`changes.diff` 是差異，供 review 或比對 Gemini 的改動。使用前注意：
  - 這些檔案是根據 2026-09-28 從 AI Studio 取得的版本修改的。你之後在 AI Studio 做過的改動（例如改用 ESM build），整份貼上時會被覆蓋。
  - UI 端的錯誤顯示修改不在 `files/` 內，請按 `gemini-prompt.md` 第 7 步自行修改。
  - 本資料夾的 `tsconfig.json` 和 `typecheck/` 只供本 repo 檢查 `files/` 的型別：以 app 的編譯設定，對照已發佈 package 的型別宣告（由 `pnpm run check` 執行）。不要複製到 app。

這些檔案都已在原 app 的副本上驗證過（套件從 release URL 安裝）：
- `tsc --noEmit` 通過。
- `npm run build` 成功，ESM（`dist/server.mjs`）和 CommonJS（`dist/server.cjs`）兩種 server build 都已測試。
- 用 `node dist/server.cjs` 實際呼叫 `/api/gemini/generate` 和 `/api/gemini/edit`：KIE、ToAPIs、Gemini 都能完成驗證、上傳，並到達真正的 provider。測試用的是無效金鑰，所以最後都停在 provider 的 401 / 400。

## 前置條件

1. 三個 release 已發佈：`kie-v0.1.0`、`toapis-v0.1.0`、`google-v0.1.0`。`files/package.json` 和 `gemini-prompt.md` 內的 URL 都可以匿名下載，並已實際用 `npm install` 驗證。
2. GitHub repo 需要是 public，AI Studio 安裝時才能匿名下載 release asset。
3. 改動前先在 AI Studio 把整個 app 下載（Download / Export ZIP）備份。AI Studio 沒有 Git，這份 ZIP 就是 rollback 手段。

## 步驟

1. **Secrets**：確認 Settings → Secrets 有以下三個值。`WOKEY_API_KEY`、`OPENROUTER_API_KEY` 不再使用，可以保留。
   - `KIE_API_KEY`
   - `TOAPIS_API_KEY`
   - `GEMINI_API_KEY`（AI Studio 會自動注入）
2. **package.json**：只在 `dependencies` 加入三個 `@hk01/pi-ai-extra-*`，指向 release `.tgz`（見 `files/package.json`）。不要整份取代，以免覆蓋你的 `build` / `start` 設定。現在的 ESM build（`dist/server.mjs`）不用改；CommonJS build 也可以使用。
3. **新增** `server/providers/imageClient.ts`，貼上 `files/server/providers/imageClient.ts`。這是 app 唯一直接呼叫 packages 的地方，負責：
   - model 對應
   - 比例轉換
   - 讀取 Secrets
   - 錯誤訊息
   - 用量 log
4. **整份取代**以下四個檔案，內容取自 `files/` 對應路徑：
   - `server/providers/kie.ts`：prompt 保持原文。原本的多候選 model 輪試、上傳、輪詢都交由 package 處理。
   - `server/providers/toapis.ts`：prompt 保持原文。移除了：
     - 上傳到 KIE 的後備
     - GPT Image 2.5 → GPT Image 2 的後備
     - 失敗時靜默丟圖
     - 多 host 輪試
   - `server.ts`：
     - Gemini 兩段改由 `@hk01/pi-ai-extra-google` 處理。
     - KIE 呼叫加上 `signal`（原本關閉分頁不會取消）。
     - 移除 `@google/genai` 的 import 和 `getGeminiAspectRatio`。
   - `src/models.config.ts`：只把兩個 Wokey 模型改為 `enabled: false`。它們原本其實被偷偷轉給 Gemini 或 KIE 處理，屬於隱藏的後備。
5. **刪除** `server/providers/wokey.ts`。它從未被 import，而且依賴已移除的 helper，保留會令 `tsc` 失敗。
6. 重新啟動 / Build，然後按下面的清單驗證。

## 用戶會看到的行為改變

- **不再有 fallback**：選哪個 provider / model 就只用它。失敗時錯誤訊息會標明，例如：
  - `kie/gpt-image-2-image-to-image 金鑰無效或未授權…`
  - `參考圖片數量超出 kie/grok-imagine-image-2-0/image-edit 的上限…`
- **參考圖上限是硬性限制**：模板 + 素材 + Logo 合計計算，超過就報錯，不會自動刪圖。

  | 模型 | 上限 |
  | --- | --- |
  | Grok Imagine 2.0 edit | 5 |
  | ToAPIs GPT Image 2 | 6 |
  | ToAPIs Gemini 3.1 Flash | 6 |
  | Seedream 5.0 Pro | 10（JPEG / PNG） |
  | Nano Banana 2（KIE） | 14 |
  | Gemini | 14 |
  | KIE GPT Image 2 | 16 |
  | GPT Image 2.5 | 無文件上限 |

- **比例**：自動選該模型支援、最接近的比例。前端 `processFinalImage` 仍會按目標尺寸裁切或補邊。例如：
  - Grok 的 4:5 → 2:3
  - KIE GPT Image 2 在 2K 下的 4:5 → 3:4
  - 300x250 → 5:4（Grok 沒有 5:4，會變 1:1）
- **Gemini prompt 結構**：原本文字和圖片交錯傳送，現在是一段文字（圖片以 `[Reference image N]` 標示位置）加上按序排列的圖片。標籤文字完全保留，但建議實測比較出圖效果。
- **ToAPIs 安全審查**：原本被擋時會自動改用簡化 prompt 重試，現已移除。安全審查錯誤會直接顯示給用戶，由用戶決定改 prompt 再試。
- **錯誤顯示**：
  - server 回傳 `{ error, details }`，`details` 包含 provider、model、code、HTTP status、task id；
  - UI 的錯誤框會持續顯示，直到用戶關閉，並附「複製錯誤資訊」按鈕；
  - 前端不再自動重試，因為每次重試都是一個新的付費任務，而且會蓋掉第一次的錯誤。
- **用量**：server log 每次會多一行 `[usage] provider/model task=… ref=… usage=…`。ToAPIs 請求會帶一個唯一的 `client_business_id`（`open-graph-single:<uuid>`），日後 proxy 可以按 task id 補查計費。

## 驗證清單

1. 每個已啟用的模型各跑一次：只有 prompt、模板 + 1 張素材、模板 + 多張素材 + Logo。
2. DeepEditor 編輯（edit）各模型跑一次。
3. 選 Grok Imagine 2.0，放模板 + 5 張素材：應看到上限錯誤，而不是少了素材的圖。
4. 生成途中關閉分頁：server log 應出現 `aborted`，不會繼續輪詢。
5. server log 有 `[usage]` 行。KIE 有 `credits` 與 `providerDurationMs`，ToAPIs 有 `billingStatus` 等欄位，Gemini 有 `tokens`。
6. 用錯誤的 `KIE_API_KEY` 生成一次：應看到持續顯示的錯誤框，內容包含 `kie / …` 和錯誤代碼 `auth`；按「複製錯誤資訊」可以複製完整報告。
7. 若某模型出錯，把「複製錯誤資訊」的內容和 server log 貼回來。

## 可選的後續改善

- 在 UI 按 package 的 catalogue（`KIE_IMAGE_MODELS` 等）限制可上傳的素材數量，讓用戶在送出前就知道上限。
- ToAPIs 的 `billingStatus: "pending"` 補查（`getToapisTask()`），留待 proxy service 處理。

## Rollback

- **整個 app**：用前置條件第 3 步的 ZIP 還原。
- **只換 package 版本**：把 `package.json` 三條 URL 改回舊版本號後重新 build。已發佈的 release 不會被覆蓋，同一條 URL 永遠安裝同一份檔案。
