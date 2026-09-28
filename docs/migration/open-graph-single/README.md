# open-graph-single 遷移指南（Google AI Studio）

將 open-graph-single（即 Jira 上的 remix-open-graph-single）的 KIE、ToAPIs、Gemini 生圖邏輯，換成 `@hk01/pi-ai-extra-*` packages。對應 [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512) P0。

`files/` 內是改好的完整檔案，直接整份貼上即可。`changes.diff` 是對原檔的完整差異，供 review。

這些檔案都已在原 app 的副本上驗證過：
- `tsc --noEmit` 通過。
- `npm run build`（Vite + esbuild CommonJS server bundle）成功。
- 用 `node dist/server.cjs` 實際呼叫 `/api/gemini/generate` 和 `/api/gemini/edit`：KIE、ToAPIs、Gemini 都能完成驗證、上傳，並到達真正的 provider。測試用的是無效金鑰，所以最後都停在 provider 的 401 / 400。

## 前置條件

1. 在 pi-ai-extra 發佈三個 release：`kie-v0.1.0`、`toapis-v0.1.0`、`google-v0.1.0`（見 repo README 的 Release 一節）。發佈後，`files/package.json` 裡的三條 URL 才能下載。
2. GitHub repo 需要是 public，AI Studio 安裝時才能匿名下載 release asset。
3. 改動前先在 AI Studio 把整個 app 下載（Download / Export ZIP）備份。AI Studio 沒有 Git，這份 ZIP 就是 rollback 手段。

## 步驟

1. **Secrets**：確認 Settings → Secrets 有以下三個值。`WOKEY_API_KEY`、`OPENROUTER_API_KEY` 不再使用，可以保留。
   - `KIE_API_KEY`
   - `TOAPIS_API_KEY`
   - `GEMINI_API_KEY`（AI Studio 會自動注入）
2. **package.json**：用 `files/package.json` 整份取代。唯一改動是 `dependencies` 加了三個 `@hk01/pi-ai-extra-*`，指向 release `.tgz`。build 仍然是 CommonJS，不用改。
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
- **ToAPIs 安全審查**：被擋時仍會用簡化 prompt 再試一次，但只限同一 provider 和 model。這是 app 的明確選擇，會多一次計費。
- **用量**：server log 每次會多一行 `[usage] provider/model task=… ref=… usage=…`。ToAPIs 請求會帶一個唯一的 `client_business_id`（`open-graph-single:<uuid>`），日後 proxy 可以按 task id 補查計費。

## 驗證清單

1. 每個已啟用的模型各跑一次：只有 prompt、模板 + 1 張素材、模板 + 多張素材 + Logo。
2. DeepEditor 編輯（edit）各模型跑一次。
3. 選 Grok Imagine 2.0，放模板 + 5 張素材：應看到上限錯誤，而不是少了素材的圖。
4. 生成途中關閉分頁：server log 應出現 `aborted`，不會繼續輪詢。
5. server log 有 `[usage]` 行。KIE 有 `credits` 與 `providerDurationMs`，ToAPIs 有 `billingStatus` 等欄位，Gemini 有 `tokens`。
6. 若某模型出錯，把前端紅色錯誤訊息和 server log 貼回來。訊息已包含 provider、model 和錯誤代碼。

## 可選的後續改善

- `src/lib/gemini.ts` 的 `generateOgImage` / `editOgImage` 會在非安全錯誤時自動重試一次。每次重試都會建立一個新的付費任務。建議只在網絡錯誤時重試，或乾脆取消重試。
- 在 UI 按 package 的 catalogue（`KIE_IMAGE_MODELS` 等）限制可上傳的素材數量，讓用戶在送出前就知道上限。
- ToAPIs 的 `billingStatus: "pending"` 補查（`getToapisTask()`），留待 proxy service 處理。

## Rollback

- **整個 app**：用前置條件第 3 步的 ZIP 還原。
- **只換 package 版本**：把 `package.json` 三條 URL 改回舊版本號後重新 build。已發佈的 release 不會被覆蓋，同一條 URL 永遠安裝同一份檔案。
