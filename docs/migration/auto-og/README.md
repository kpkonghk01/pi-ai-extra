# Auto OG 遷移指南（Google AI Studio）

本指南把 Auto: OG 拼貼大師（自動駕駛版，下稱 auto-og）的 collage 和 edit 生圖，改為使用 `@hk01/pi-ai-extra-*` packages，讓使用者可以按 provider 分組選擇 Google、KIE、ToAPIs 的圖片模型。對應 [DATA-4514](https://hk01-digital.atlassian.net/browse/DATA-4514)；它依賴 [DATA-4534](https://hk01-digital.atlassian.net/browse/DATA-4534)，即 `@hk01/pi-ai-extra-google` 0.2.0。

標題生成和讀取文章維持直接使用 Gemini SDK，不在這次改動範圍內。

## 怎樣使用這個資料夾

建議做法是把三段 prompt **依序**交給 AI Studio 的 Gemini：

1. 貼上 [`gemini-prompt-part1.md`](gemini-prompt-part1.md) 全文（server 端）。等 Gemini 改完，並回報 `npm run lint` 通過。
2. 貼上 [`gemini-prompt-part2.md`](gemini-prompt-part2.md)（client 端新增的模組，只新增檔案，不改變現有行為）。
3. 貼上 [`gemini-prompt-part3.md`](gemini-prompt-part3.md)（UI 接線）。完成後才測試；三段未全部完成前，app 不能正常使用。

拆成三段，是因為整份約 2,800 行，一次貼上容易被截斷或漏改。每段都有一個 lint 檢查點。

如果要手動修改或核對 Gemini 的改動，可以用以下兩份參考：

- `files/`：已驗證的檔案。新增的檔案可以直接複製；`server.ts`、`vite.config.ts`、`services/geminiService.ts`、`services/usageService.ts`、`components/TemperatureControl.tsx` 是修改後的完整版本。
- `changes.diff`：所有改動的 diff，包括 `App.tsx`、`components/AutopilotStudio.tsx`、`components/ImageEditor.tsx`。這三個檔案太大，沒有放完整版本。

注意：
- 這些檔案是根據 2026-10-01 本機的 auto-og 版本修改的。之後在 AI Studio 做過的改動，若直接整份貼上 `files/` 的檔案會被覆蓋。prompt 用 diff 描述修改，並要求 Gemini 在對不上時按意圖修改，較不受影響。
- 本資料夾的 `tsconfig.json` 和 `typecheck/` 只供本 repo 用 app 的編譯設定檢查 `files/`（由 `pnpm run check` 執行），不要複製到 app。

## 已驗證的範圍

以下是在 auto-og 的副本上驗證的，KIE、ToAPIs 從 release URL 安裝，Google 用本機打包的 0.2.0：

- `npm run lint`（tsc）和 `npm run build` 通過，`build` / `start` scripts 不變（ESM，`dist/server.mjs`）。
- 用假的 `GEMINI_API_KEY` build 後搜尋 `dist/`，找不到 key。
- 用 `node dist/server.mjs` 實際呼叫：
  - `GET /api/image-models`：9 個 model，上限、temperature 支援和 key 可用性都正確；沒有 `TOAPIS_API_KEY` 時，ToAPIs 的 5 個 model 標示為不可用並附上原因。
  - collage：Google（無效 key）經 NDJSON 回傳含 provider、model、code 的錯誤；ToAPIs 缺 key 回 503；KIE 帶 temperature 回 400；舊的 `nano-banana-2-lite` 回 400；16 張參考圖對上限 14 張的 model 回 400（不會刪圖）。
  - edit：Google（無效 key）經 NDJSON 回傳錯誤；KIE 帶 temperature 回 400。送圖順序 base → mask → extra 由 route 程式碼確認。
- 各 model 實際送出的比例、解像度、temperature，以及規則放在 `systemInstruction` 還是 prompt 開頭，都已逐一檢查（見下面「用戶會看到的改變」）。
- NDJSON keep-alive：21 秒的任務在第 10、20 秒各收到一次 ping，第 21 秒完成；client 中途斷線時，server 會停止輪詢。

**未驗證**：UI 沒有在瀏覽器實際操作過，也沒有用真 key 出圖。這兩項要在 AI Studio 按下面的驗證清單完成。

## 前置條件

1. `google-v0.2.0` 已發佈（PR #4 merge 後打 tag）。prompt 的 Step 1 會安裝這個 URL，它必須可以匿名下載。
2. 改動前，在 AI Studio 把整個 app 下載（Download / Export ZIP）備份。AI Studio 沒有 Git，這份 ZIP 就是 rollback 手段。
3. Settings → Secrets 加入：
   - `KIE_API_KEY`
   - `TOAPIS_API_KEY`
   - `GEMINI_API_KEY` 已經存在，不用改。

   缺少某個 key 時，該 provider 的 model 會在選單變灰，其他功能不受影響。

## 先確認預估單價

`files/server/imageModels.ts` 每個 model 有一個 `price` 欄位，只用於 UI 的預估費用和用量表，不影響生圖。目前只填了查證過的單價：

| Model | 1K | 2K | 來源 |
| --- | --- | --- | --- |
| Nano Banana 2（Google） | $0.067 | $0.101 | Google 定價頁（2026-10-01），輸入 $0.50 / 百萬 token |
| Nano Banana Pro（Google） | $0.134 | $0.134 | Google 定價頁（2026-10-01），輸入 $2.00 / 百萬 token |
| GPT Image 2.5 Flare / Sunburst（ToAPIs） | $0.015 | $0.020 | ToAPIs 文件（2026-09-09） |

其餘 5 個 model 的單價未知，UI 會顯示「—」，用量表會另計「未計價」張數。ToAPIs 和 KIE 的定價頁需要登入或 JavaScript，查不到。open-graph-single 現在用的估值如下，但未經核實，也沒有區分解像度：

| Model | open-graph-single 估值（USD / 張） |
| --- | --- |
| Nano Banana 2（KIE） | 0.032 |
| GPT Image 2（KIE） | 0.02 |
| Nano Banana 2 Preview（ToAPIs） | 0.03 |
| GPT Image 2（ToAPIs） | 0.08 |
| Seedream 5.0 Pro（ToAPIs） | 0.05 |

如有實際單價，貼 Part 1 之前在 prompt 的 `server/imageModels.ts` 裡，把對應的 `price: null` 改成 `{ perImageUsd: { '1K': …, '2K': … }, inputPerMillionTokensUsd: 0 }` 即可。

## 用戶會看到的改變

- **模型選單**：頂部選單按 Google Gemini、KIE 提供、ToAPIs 提供分組，共 9 個 model：
  - Google：Nano Banana 2、Nano Banana Pro（沿用原本的 ID）。
  - KIE：Nano Banana 2、GPT Image 2。
  - ToAPIs：Nano Banana 2 Preview、GPT Image 2、GPT Image 2.5 Flare、GPT Image 2.5 Sunburst、Seedream 5.0 Pro。
  - 不提供 Grok：collage 的規則併入 prompt 後有 11.6k 至 16.4k 字元，必定超過 Grok 的 8,000 字元上限。
- **參考圖上限**：
  - 選擇前已超限：上限不夠的 model 變灰，並標示「最多 N 張參考圖，已選 M 張」。
  - 選擇後再加圖導致超限：不擋加圖，Generate 按鈕變灰並顯示紅字提示，不會自動換 model。
  - 全自動模式擷取網頁圖：只取 model 還容得下的張數（最多 5 張），並用 toast 告知。
- **Temperature**：只有 Google 直連的 Nano Banana 2 / Pro 可調。其他 model 的控制項會變灰並說明原因，原本設定的值會保留。
- **錯誤面板**：平時不顯示。出錯時在右下角出現，蓋在編輯器之上，內容包括 provider、model、code、HTTP status、task id 和批次中的第幾張，並提供「複製錯誤資訊」、收起和關閉。標題生成和讀取文章的錯誤也會進入面板。
- **不再 fallback**：選哪個 model 就只用哪個，不會再在 Pro、Flash、Lite 之間自動輪試。
- **比例和解像度**：
  - 送 model 原生支援的比例，否則送最接近的比例。例如 4:5 直接送；300x250 送 5:4，Seedream 則送 4:3；KIE GPT Image 2 在 2K 不支援 4:5，所以送 3:4。
  - 後處理改為居中裁切，4:5 圖不再被橫向拉闊約 7%。
  - 解像度按輸出尺寸決定：16:9、1:1 和廣告尺寸用 1K；4:5、9:16 用 2K。
- **Edit**：
  - 送圖順序固定為 base → mask → extra，prompt 的圖片編號隨之修正。
  - 保持原圖比例：Google 不指定比例，KIE 用 `auto`，ToAPIs 選最接近的比例。
  - 非 Nano Banana 系列的 model 會提示遮罩效果可能較差。
- **手動模式修正**：原本手動 collage 的參數錯位（實際一直用 Pro、temperature 無效、標題設定錯置），這次一併修好。
- **費用預估**：按所選 model 的單價和實際解像度計算。舊版的輸入 token 單價（$5 / 百萬）也改為 Google 的實際單價。

## 驗證清單（在 AI Studio，用真 key）

1. 每個 model 各跑一次 collage：手動模式（模板 + 素材）、Autopilot 半自動、全自動。
2. 每個 provider 各跑一次 edit：遮罩、多色遮罩、替換 Logo。
3. 手動模式選 2 張模板、放 5 張素材（共 7 張），選單裡的 ToAPIs GPT Image 2（上限 6 張）應變灰；若已選中它，Generate 應變灰並顯示紅字。
4. 選 KIE 或 ToAPIs 的 model：temperature 控制項應變灰並顯示說明；切回 Google 後恢復原值。
5. 用錯誤的 `KIE_API_KEY` 生成一次：右下角應出現錯誤面板，內容包含 `kie/…` 和 code `auth`，「複製錯誤資訊」可以複製完整報告。
6. 選一個 KIE GPT Image 2 的長任務（通常超過 60 秒），確認不會中途斷線。
7. Server log 有 `[usage] app=auto-og …` 行，ToAPIs 的 `ref=auto-og:<uuid>`。
8. 標題生成、讀取文章、圖庫和 2MB 壓縮照常運作。
9. 若有錯，把「複製錯誤資訊」的內容和 server log 貼回來。

## 注意事項

- 已提交給 provider 的任務，即使 client 中途斷線也會照常收費；server 只會停止輪詢。
- 每次 request 只送一次，不會自動重送已計費的請求。
- 遷移後 Google 也改為把模板、素材圖片放在一段 prompt 加依序排列的參考圖，文字標籤原樣保留（與 open-graph-single 相同的做法）。

## Rollback

- **整個 app**：用前置條件第 2 步的 ZIP 還原。
- **只換 package 版本**：把 `package.json` 的 URL 改回舊版本號後重新 build。已發佈的 release 不會被覆蓋，同一條 URL 永遠安裝同一份檔案。
