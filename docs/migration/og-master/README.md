# og-master 遷移指南（Google AI Studio）

本指南把「Remix: OG 拼貼大師」（下稱 og-master）的兩條生圖 route 改為使用 `@hk01/pi-ai-extra-*` packages：拼貼生成（`/api/generate-collage`）和圖片編輯（`/api/edit-image`，包括 AI 擦除 Logo）。改完後，使用者可以按 provider 分組，選擇 Google、ToAPIs、KIE 共 11 個圖片模型。對應 [DATA-4517](https://hk01-digital.atlassian.net/browse/DATA-4517)。

og-master 是 Auto OG（「OG 拼貼大師（自動駕駛版）」）的 **Backup app**：Auto OG 用不到時，由用戶自行轉用；轉用是人的決定，不是 fallback（見 [CONTEXT.md](../../../CONTEXT.md)）。兩者出自同一個舊版本，所以這次沿用 [auto-og](https://github.com/kpkonghk01/pi-ai-extra/tree/4f87f16/docs/migration/auto-og) 的做法：模型設定、解像度表、費用計算和錯誤處理都相同。

DATA-4517 原本的 AC 寫的是瀏覽器端的 zip module。這個方案已被 [ADR 0006](../../adr/0006-image-kit-package.md) 和 [ADR 0007](../../adr/0007-catalogue-policy-model-selection.md) 取代。og-master 改為跟其他 app 一樣，在 server 端用 `@hk01/pi-ai-extra-image-kit` 0.2，API key 不會進入瀏覽器。og-master 沒有文字模型的呼叫，只有生圖和編輯。

## 版本

| Package | 版本 |
| --- | --- |
| `@hk01/pi-ai-extra-image-kit` | 0.2.0 |
| `@hk01/pi-ai-extra-google` | 0.3.2 |
| `@hk01/pi-ai-extra-kie` | 0.2.0 |
| `@hk01/pi-ai-extra-toapis` | 0.2.0 |

四個 package 都以 GitHub Release 的 `.tgz` URL 安裝，版本固定在 URL 裏（見 `files/package.json`）。

## 怎樣使用這個資料夾

依序做以下步驟：

1. **手動把 server build 改為 ESM**（見下面「步驟 0」）。改完先確認 app 照常運作。
2. 貼上 [`gemini-prompt-part1.md`](gemini-prompt-part1.md)（server：安裝 package、模型設定、兩條 route）。等 Gemini 改完，並回報 `npm run lint` 通過。
3. 貼上 [`gemini-prompt-part2.md`](gemini-prompt-part2.md)（UI 的模型選擇：選單、參考圖上限、temperature、費用、遮罩提示）。同樣等 lint 通過。
4. 貼上 [`gemini-prompt-part3.md`](gemini-prompt-part3.md)（UI 的生圖請求：串流、取消、錯誤面板、裁切）。完成後 app 可以正常使用。
5. 貼上 [`gemini-prompt-part4.md`](gemini-prompt-part4.md)（順手修正：樣板組合改存 IndexedDB、下載副檔名、舊文字、AI Logo 遮罩）。這段與遷移無關，每一步都獨立。

Part 1–3 全部完成前，app 不能生圖，完成後才測試。原因是 server 在 Part 1 已改為 NDJSON 串流和新的 model ID，舊的 UI 讀不到。

每一步都寫成「找這段原文 → 換成這段」或「由這段到那段整段取代」，Gemini 較不容易漏改；prompt 文字和 system instruction 一律不改。

如果要手動修改或核對 Gemini 的改動，可以用以下兩份參考：

- `files/`：已驗證的完整檔案。
  - 新檔案：`server/imageModels.ts`、`shared/imageOutput.ts`、`shared/imageModels.ts`、`services/presetService.ts`。
  - 修改後的完整版本：`server.ts`、`services/geminiService.ts`、`services/usageService.ts`、`types.ts`、`vite.config.ts`、`package.json`、`.env.example`、`index.html`、`metadata.json`。
- `changes.diff`：步驟 0 之後的所有改動（`package-lock.json` 除外），包括 `App.tsx` 和 `components/ImageEditor.tsx`。這兩個檔案太大，沒有放完整版本。

注意：

- 這些檔案是根據 2026-10-13 的 og-master 版本修改的。之後在 AI Studio 做過的改動，若直接整份貼上 `files/` 的檔案會被覆蓋。prompt 用「找這段原文」描述修改，並要求 Gemini 在對不上時按意圖修改，較不受影響。
- 本資料夾的 `tsconfig.json` 和 `typecheck/` 只供本 repo 用 app 的編譯設定檢查 `files/`（由 `pnpm run check:docs` 執行），不要複製到 app。

## 步驟 0：手動把 server build 改為 ESM

og-master 現在把 `server.ts` 打包成 CommonJS（`dist/server.cjs`）。其他已遷移的 app 都用 ESM，所以先統一改為 ESM。

1. 在 AI Studio 的檔案樹打開 `package.json`。
2. 在 `"build"` 這一行：
   - 把 `--format=cjs` 改為 `--format=esm`；
   - 把 `--outfile=dist/server.cjs` 改為 `--outfile=dist/server.mjs`。
3. 把 `"start": "node dist/server.cjs"` 改為 `"start": "node dist/server.mjs"`。
4. 其他不用改：`"type": "module"` 已經存在，`server.ts` 沒有用 `require` 或 `__dirname`。
5. 重新 build / 部署，確認 app 可以開啟，並生成一張圖。

改完後兩行應該是：

```json
"build": "vite build && esbuild server.ts --bundle --platform=node --format=esm --packages=external --sourcemap --outfile=dist/server.mjs",
"start": "node dist/server.mjs",
```

在本機副本驗證過：只改這兩行，`npm run build` 成功，`node dist/server.mjs` 可以啟動。Part 1 第一步會檢查這兩行；若仍是 CommonJS，Gemini 會停下來，請你先完成步驟 0。

## 已驗證的範圍

以下是在 2026-10-13 的 og-master 副本上驗證的。四個 package 都從 release URL 安裝：

- **四段 prompt 逐字套用**：步驟 0 之後，四段 prompt 的每個「Find」都在原文中剛好找到一次，套用後每段的 `npm run lint` 都通過。
  - og-master 沒有 `@types/react`，所以 lint 不檢查 JSX。另外補裝 React 型別再檢查，遷移前後都是 0 個錯誤。
- **Build**：`npm run build` 通過。用假的 `GEMINI_API_KEY` build 後搜尋 `dist/`，找不到 key；瀏覽器 bundle 內沒有 provider package 的程式碼。
- **Server 實測**：用 `node dist/server.mjs` 實際呼叫。Google 用本機的假 endpoint，KIE 用無效 key，沒有設定 ToAPIs key。
  - `GET /api/image-models?scope=collage` 和 `?scope=edit` 各回 11 個 model，次序是 Google、ToAPIs、KIE；ToAPIs 的 5 個標示為「伺服器未設定 TOAPIS_API_KEY」。沒有 scope 時回 400。
  - 在呼叫 provider 之前已拒絕的請求：舊的 model ID（`nano-banana-2`）、未知比例（`7:3`）、Grok 放 6 張參考圖、ToAPIs 缺 key、以 http 網址代替圖片。
  - Nano Banana 2.1 生成 4:5：直接送 4:5、2K、temperature 0.4；Nano Banana 2 生成 300x250：送 5:4、1K。server log 有 `[usage] app=og-master …`。
  - 編輯：有遮罩時送最接近原圖的比例（1600:2000 → 4:5），沒有遮罩時 Google 保持原比例；不送 temperature。
  - KIE（無效 key）：temperature 不會送出；錯誤經 NDJSON 回傳，內容包含 `kie/nano-banana-2`、code `auth`。
- **UI 實測**（headless Chrome，登入改為假用戶，Google 用假 endpoint）：
  - 選單分三組共 11 個 model，預設 Nano Banana 2.1，沒有 key 的 model 變灰並註明原因。
  - 4:5 生成的結果是 1600×2000；預估和「Cost」按 2.1 的單價計算（HK$0.39）。
  - 編輯該結果後仍是 1600×2000。
  - 選 KIE：AI 忠實程度變灰並顯示說明；預估顯示「單價未知（未計價）」；假 key 的錯誤進入右下角錯誤面板。
  - 選 Grok 後放 1 個樣板 + 5 張素材：「開始拼貼」變灰，紅字顯示「最多 5 張參考圖，已選 6 張」。
  - 生成途中按「取消」：頁面沒有重新載入，圖片仍在，server log 顯示請求已中止。
  - 樣板組合：舊的 localStorage 組合在第一次載入時搬到 IndexedDB；9.7 MB（30 張）的組合 localStorage 存不下，IndexedDB 可以，重新整理後仍在。
- **一致性**：`changes.diff` 套用到步驟 0 之後的副本，結果與驗證的副本逐字相同；`files/` 直接取自該副本。

**未驗證**：真實的 Firebase 登入，以及用真 key 出圖。這兩項要在 AI Studio 按下面的驗證清單完成。

## 前置條件

1. 四個 release 可以匿名下載：`google-v0.3.2`、`image-kit-v0.2.0`、`kie-v0.2.0`、`toapis-v0.2.0`。
2. 改動前，在 AI Studio 把整個 app 下載（Download / Export ZIP）備份。AI Studio 沒有 Git，這份 ZIP 就是 rollback 手段。
3. Settings → Secrets：
   - `KIE_API_KEY`：新增。
   - `TOAPIS_API_KEY`：新增。
   - `GEMINI_API_KEY`：已經存在，不用改。

   缺少某個 key 時，該 provider 的 model 會在選單變灰並註明原因，其他功能不受影響。

## 預估單價

`server/imageModels.ts` 裏部分 model 有 `price`，只用於預估費用和用量紀錄，不影響生圖。單價與 Auto OG 相同（USD / 張）：

| Model | 1K | 2K | 來源 |
| --- | --- | --- | --- |
| Nano Banana 2.1（Google） | 0.034 | 0.05 | 與 Auto OG、open-graph-single 相同 |
| Nano Banana 2（Google） | 0.067 | 0.101 | Google 定價頁（2026-10-01），輸入 $0.50 / 百萬 token |
| Nano Banana Pro（Google） | 0.134 | 0.134 | Google 定價頁（2026-10-01），輸入 $2.00 / 百萬 token |
| GPT Image 2.5 Flare / Sunburst（ToAPIs） | 0.015 | 0.02 | ToAPIs 文件（2026-09-09） |

其餘 7 個 model 的單價未知：預估顯示「—」，用量不計入金額，在「費用歷史紀錄」另計「未計價」張數。

如有實際單價，貼 Part 1 之前，在 prompt 的 `server/imageModels.ts` 把對應 model 加上 `price: { perImageUsd: { '1K': …, '2K': … }, inputPerMillionTokensUsd: 0 }` 即可。

## 用戶會看到的改變

- **模型選單**：頂部的三個按鈕換成下拉選單。
  - 按 Google Gemini、ToAPIs 提供、KIE 提供分組，共 11 個 model：
    - Google：Nano Banana 2.1（預設）、Nano Banana 2（2代平衡）、Nano Banana Pro（Pro 思考）。
    - ToAPIs：Nano Banana 2 Preview、GPT Image 2、GPT Image 2.5 Flare、GPT Image 2.5 Sunburst、Seedream 5.0 Pro。
    - KIE：Grok Imagine 2.0、GPT Image 2、Nano Banana 2。
  - 選單載入失敗時，會變成「模型清單載入失敗，按此重試」按鈕。
- **不再 fallback**：選哪個 model 就只用哪個，每次請求只送一次。原本選定的 model 失敗時，會靜默改用另一個 model 出圖（例如 2.1 → Nano Banana 2 → Pro），費用卻照舊按選定的 model 記錄。
- **參考圖上限**：每次送出的參考圖 = 已點亮的樣板（1 張）+ 全部素材。
  - 上限不夠的 model 在選單變灰，並標示原因。例如 Grok 最多 5 張、ToAPIs GPT Image 2 最多 6 張、Google 最多 14 張。
  - 已選中的 model 不夠時，「開始拼貼」上方顯示紅字原因，按鈕變灰。不會刪圖，也不會自動換 model。
- **AI 忠實程度（temperature）**：只有 Google 的三個 model 支援。選其他 model 時，滑桿和按鈕變灰並顯示說明，原本的數值保留。
- **解像度**：按比例決定，與比例清單上的 1K / 2K 標籤一致：16:9、1:1 和廣告尺寸用 1K，4:5、9:16 用 2K。原本一律送 2K，費用卻按 1K 記錄。
- **比例**：送 model 原生支援的比例，沒有的話送最接近的，再居中裁切到輸出尺寸。原本是拉伸。

  | UI 比例 | 原本送 | 現在（Google、ToAPIs GPT Image） | 例外 |
  | --- | --- | --- | --- |
  | 4:5 | 3:4，再橫向拉闊約 7% | 4:5 | KIE GPT Image 2、Seedream 3:4；Grok 2:3 |
  | 300x250 | 4:3，再壓扁約 10% | 5:4 | Seedream 4:3；Grok 1:1 |
  | 16:9、9:16、1:1、300x300 | 不變 | 不變 | |

- **編輯**：
  - 保持原圖的比例和像素尺寸。原本編輯後的圖會變成 model 回傳的尺寸。
  - 選 Nano Banana 系列以外的 model 時，編輯器會提示筆劃 / 遮罩效果可能較差。
- **錯誤面板**：平時不顯示，出錯時在右下角出現。
  - 內容包括 provider、model、code、HTTP status、task id 和比例，並提供「複製錯誤資訊」。拼貼和編輯的錯誤都會進入面板，登入和選 key 畫面也看得到。
  - 「Authentication Required」選 key 畫面只在 Google 回 403 / PERMISSION_DENIED 時出現，與原本相同；KIE、ToAPIs 的錯誤只進錯誤面板。
- **取消**：原本「取消」會重新載入整個頁面，已上傳的樣板、素材、標題和設定都會消失，server 仍繼續生成。現在只中止進行中的請求，其他東西都保留；已提交給 provider 的任務仍會收費。
- **費用**：按所選 model 的單價和實際解像度計算，USD × 7.8 換算為 HKD。原本輸入 token 一律按 $5 / 百萬計算，現在改用各 model 的實際單價。
- **圖片送出方式**：原本 Gemini 收到「圖片、標籤、圖片、標籤…」交錯的內容；現在所有 model 都收到一段文字，以 `[Reference image N]` 標示每張圖的位置，圖片按次序附在後面。標籤和 prompt 文字完全保留，與其他已遷移的 app 相同。建議用驗證清單第 1 項比較出圖效果。

## 順手修正的錯誤

- **API key 洩漏風險**：`vite.config.ts` 的 `define` 會把 `GEMINI_API_KEY` 放進瀏覽器 bundle（如果 build 時有 `.env`）。已刪除，連同 `App.tsx` 讀 `process.env.API_KEY` 的後備檢查。
- **`/api/edit-image` 會抓取任何網址**：server 原本會下載 request 裏的任何 http(s) 網址。瀏覽器一向送 data URL，所以 server 現在只接受 data URL，其他回 400。
- **拉伸變形**：輸出改為居中裁切。
- **編輯器卡住**：編輯後的圖片無法解碼時，編輯器原本會一直停在載入中；現在會顯示錯誤。AI 擦除 Logo 的同類問題也一併修正。
- **樣板組合存不下**：5 組 × 6 張的樣板組合約 10 MB，超出 localStorage 的上限（約 5 MB），存不下時畫面卻顯示「已成功儲存」，重新整理後組合就不見了。現在改存 IndexedDB（圖庫本來就用 IndexedDB）。舊的 localStorage 組合會在第一次載入時自動搬過去，舊資料保留不刪。儲存失敗時會顯示錯誤。
- **下載副檔名**：圖庫下載和 ZIP 原本一律用 `.jpg`，編輯器下載一律用 `.png`；現在按圖片實際格式決定。
- **AI 擦除 Logo 的遮罩**：遮罩方框的闊度和高度從未加 padding 的角落計算，在圖片邊緣附近會不夠或超出圖片；已修正。
- **舊文字**：選 key 畫面、`index.html` 和 `metadata.json` 仍寫「Gemini 3 Pro Image Preview」，已改為不指定 model 的說法；也刪除了指向不存在的 `/index.css` 的連結。

## 已知問題（這次沒有改）

- **兩條生圖 route 沒有登入驗證**：登入只擋住畫面，任何人只要知道網址，就可以直接呼叫 `/api/generate-collage` 和 `/api/edit-image`，用 app 的 key 生圖。要修，server 需要驗證 Firebase 登入憑證；但 image-kit 的 `postImageRequest()` 現在不能加自訂 header，所以要先在 image-kit 加入這個功能，再一併修正所有 app（Auto OG、opengraph2、InfoCard、open-graph-single 也有同樣問題）。
- **`/api/config` 只檢查 Gemini key**：沒有 `GEMINI_API_KEY` 時，app 會顯示選 key 畫面，即使 KIE 或 ToAPIs 的 key 已設定。og-master 預設用 Google，所以維持原狀。
- **編輯不計費用**：與原本相同，用量紀錄只計拼貼。

## 驗證清單（在 AI Studio，用真 key）

1. 每個 provider 各選一個 model，各跑一次拼貼：1 張樣板 + 2 張素材，比例 16:9 和 4:5 各一次。
2. 選 300x250 生成一次：結果是 300×250，沒有變形。
3. 編輯：
   - 用 Nano Banana 2.1 和 KIE GPT Image 2 各做一次「單一修圖」（筆刷）和「文字修改」，結果保持原圖尺寸；選 KIE 時編輯器顯示遮罩提示。
   - 在 Logo 模式做一次「AI 智能擦除並替換」。
4. 放 1 個樣板 + 5 張素材（共 6 張）：Grok（上限 5 張）在選單應變灰；若已選中它，「開始拼貼」應變灰並顯示紅字原因。
5. 選 KIE 或 ToAPIs 的 model：「AI 忠實程度」應變灰並顯示說明；切回 Google 後恢復原值。
6. 生成途中按「取消」：頁面不會重新載入，樣板和素材仍在；server log 出現 `request cancelled by the client`。
7. 用錯誤的 `KIE_API_KEY` 生成一次：右下角應出現錯誤面板，內容包含 `kie/…` 和 code `auth`；「複製錯誤資訊」可以複製完整報告。
8. 選一個 KIE GPT Image 2 的長任務（通常超過 60 秒），確認不會中途斷線。
9. 樣板組合：把樣板存到 5 個組合，重新整理頁面，5 個組合都還在。
10. Server log 有 `[usage] app=og-master …` 行，ToAPIs 有 `ref=og-master:<uuid>`。
11. 登入、漫畫化、標題、檔案小於 2MB、圖庫、ZIP 下載、裁切和 Logo 即時套用照常運作；「Cost」按新單價增加。
12. 若有錯，把「複製錯誤資訊」的內容和 server log 貼回來。

## 注意事項

- 已提交給 provider 的任務，即使 client 中途斷線或按取消，也會照常收費；server 只會停止輪詢。
- 每次 request 只送一次，不會自動重送已計費的請求。
- 長任務的上限由各 package 決定（KIE 10 分鐘、ToAPIs 6 分鐘、Google 5 分鐘）。60 秒的 proxy idle timeout 由 NDJSON ping 處理。
- `@google/genai` 已不再被使用，但仍留在 `package.json`，以免改動 lock 檔；之後可以手動移除。
- image-kit 是共用 package，升級或 rollback 只需改 `package.json` 的 URL。不要把它的程式碼複製進 app 修改；需要改動時在 pi-ai-extra 發佈新版本。

## Rollback

- **整個 app**：用前置條件第 2 步的 ZIP 還原。
- **只換 package 版本**：把 `package.json` 四條 URL 改回舊版本號後重新 build。已發佈的 release 不會被覆蓋，同一條 URL 永遠安裝同一份檔案。
