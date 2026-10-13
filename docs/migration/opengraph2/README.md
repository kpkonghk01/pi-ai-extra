# opengraph2 遷移指南（Google AI Studio）

本指南把「Remix: OpenGraph2 圖片製作大師」（下稱 opengraph2）的兩條生圖 route 改為使用 `@hk01/pi-ai-extra-*` packages：生成 OG 圖和深度編輯（包括 AI 智能擦除 Logo）。改完後，使用者可以按 provider 分組，選擇 Google、ToAPIs、KIE 共 11 個圖片模型。對應 [DATA-4516](https://hk01-digital.atlassian.net/browse/DATA-4516)。

opengraph2 是 open-graph-single 的 **Backup app**：open-graph-single 用不到時，由用戶自行轉用；轉用是人的決定，不是 fallback（見 [CONTEXT.md](../../../CONTEXT.md)）。

DATA-4516 原本的 AC 寫的是瀏覽器端的 zip module（`listProviders()`、`generateImage()`、不加 server 程式碼）。這個方案已被 [ADR 0006](../../adr/0006-image-kit-package.md) 和 [ADR 0007](../../adr/0007-catalogue-policy-model-selection.md) 取代。opengraph2 改為跟 open-graph-single、InfoCard、auto-og 一樣，在 server 端用 `@hk01/pi-ai-extra-image-kit` 0.2，API key 不會進入瀏覽器。

文字分析（`/api/analyze-og`，`gemini-3.8-flash`）維持直接使用 Gemini SDK，只移除了它的自動重試。

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
2. 貼上 [`gemini-prompt-part1.md`](gemini-prompt-part1.md) 全文（server：安裝 package、模型設定、三條 route）。等 Gemini 改完，並回報 `npm run lint` 通過。
3. 貼上 [`gemini-prompt-part2.md`](gemini-prompt-part2.md)（UI 的模型選擇：選單、參考圖上限、temperature、遮罩提示、model 名稱顯示）。同樣等 lint 通過。
4. 貼上 [`gemini-prompt-part3.md`](gemini-prompt-part3.md)（UI 的生圖請求：開始生成、深度編輯、AI 擦除 Logo、取消、錯誤面板、費用）。

三段全部完成前，app 不能生圖，完成後才測試。原因是 server 在 Part 1 已改為 NDJSON 串流和新的 model ID，舊的 UI 讀不到。

每一步都寫成「找這段原文 → 換成這段」，`server.ts` 則整份取代。拆成三段，是因為每段都有獨立的 lint 檢查點，Gemini 較不容易漏改。

如果要手動修改或核對 Gemini 的改動，可以用以下兩份參考：

- `files/`：已驗證的完整檔案。
  - `server/imageModels.ts` 是新檔案。
  - `server.ts`、`vite.config.ts`、`src/types.ts`、`package.json`、`.env.example` 是修改後的完整版本。
- `changes.diff`：步驟 0 之後的所有改動（`package-lock.json` 除外），包括 `src/App.tsx`。`App.tsx` 有 4,128 行，所以沒有放完整版本。

注意：

- 這些檔案是根據 2026-10-13 的 opengraph2 版本修改的。之後在 AI Studio 做過的改動，若直接整份貼上 `files/` 的檔案會被覆蓋。尤其是 `server.ts`，Part 1 會整份取代它，所以請在下次修改 AI Studio 之前貼 Part 1。
- 本資料夾的 `tsconfig.json` 和 `typecheck/` 只供本 repo 用 app 的編譯設定檢查 `files/`（由 `pnpm run check:docs` 執行），不要複製到 app。

## 步驟 0：手動把 server build 改為 ESM

opengraph2 現在把 `server.ts` 打包成 CommonJS（`dist/server.cjs`）。其他已遷移的 app 都用 ESM，所以先統一改為 ESM。

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

Part 1 第一步會檢查這兩行。若仍是 CommonJS，Gemini 會停下來，請你先完成步驟 0。

## 已驗證的範圍

以下是在 2026-10-13 的 opengraph2 副本上驗證的。四個 package 都從 release URL 安裝：

- **三段 prompt 逐字套用**：步驟 0 之後，三段 prompt 的每個「Find」都在原文中剛好找到一次，套用後每段的 `npm run lint` 都通過。
  - opengraph2 沒有 `@types/react`，所以 lint 不檢查 JSX。另外補裝 React 型別再檢查，也是 0 個錯誤。
- **Build**：`npm run build` 通過。用假的 `GEMINI_API_KEY` build 後搜尋 `dist/`，找不到 key；瀏覽器 bundle 內沒有 provider package 的程式碼。
- **Server 實測**：用 `node dist/server.mjs` 實際呼叫。Google 用本機的假 endpoint，KIE 用無效 key，沒有設定 ToAPIs key。
  - `GET /api/image-models?scope=generate` 和 `?scope=edit` 各回 11 個 model，次序是 Google、ToAPIs、KIE；ToAPIs 的 5 個標示為「伺服器未設定 TOAPIS_API_KEY」。沒有 scope 或 scope 錯誤時回 400。
  - 在呼叫 provider 之前已拒絕的請求：
    - 舊的 model ID `gemini-nano-banana-2.1` 回 400（`unsupported_model`）；
    - Grok 放 6 張參考圖回 400（`reference_limit`），沒有刪圖；
    - ToAPIs 缺 key 回 503（`missing_key`）。
  - Nano Banana 2.1 生成 300x250：
    - 送出的比例是 5:4，解像度 1K，temperature 0.4；
    - 參考圖的格式按實際內容送出（樣板 JPEG、素材和 Logo PNG）；
    - 經 NDJSON 回傳圖片，server log 有 `[usage] app=opengraph2 model=google:gemini-nano-banana-2.1 …`。
  - KIE（無效 key）：temperature 不會送出；錯誤經 NDJSON 回傳，內容包含 `kie/nano-banana-2`、code `auth`。
  - 深度編輯：Google 不指定比例（保持原圖比例），不送 temperature。
  - 文字分析經假 endpoint 正常回傳。
  - NDJSON keep-alive：21 秒的任務在第 10、20 秒各收到一次 ping，之後完成。Client 中途斷線時，server 隨即中止 provider 請求。
- **一致性**：`changes.diff` 套用到步驟 0 之後的副本，結果與驗證的副本逐字相同；`files/` 直接取自該副本。

**未驗證**：UI 沒有在瀏覽器實際操作過（app 要先用 Google 登入），也沒有用真 key 出圖。這兩項要在 AI Studio 按下面的驗證清單完成。

## 前置條件

1. 四個 release 可以匿名下載：`google-v0.3.2`、`image-kit-v0.2.0`、`kie-v0.2.0`、`toapis-v0.2.0`。
2. 改動前，在 AI Studio 把整個 app 下載（Download / Export ZIP）備份。AI Studio 沒有 Git，這份 ZIP 就是 rollback 手段。
3. Settings → Secrets：
   - `KIE_API_KEY`：新增。
   - `TOAPIS_API_KEY`：新增。
   - `GEMINI_API_KEY`：已經存在，不用改。

   缺少某個 key 時，該 provider 的 model 會在選單變灰並註明原因，其他功能不受影響。

## 預估單價

`server/imageModels.ts` 裏部分 model 有 `price`，只用於 app 的預估費用和費用紀錄，不影響生圖。opengraph2 一律生成 1K，以下是 1K 的單價（USD / 張）。這些單價與 auto-og、open-graph-single 用的相同：

| Model | 1K | 來源 |
| --- | --- | --- |
| Nano Banana 2.1（Google） | 0.034 | 與 auto-og、open-graph-single 相同 |
| Nano Banana 2（Google） | 0.067 | Google 定價頁（2026-10-01），輸入 $0.50 / 百萬 token |
| Nano Banana Pro（Google） | 0.134 | Google 定價頁（2026-10-01），輸入 $2.00 / 百萬 token |
| GPT Image 2.5 Flare / Sunburst（ToAPIs） | 0.015 | ToAPIs 文件（2026-09-09） |

其餘 7 個 model 的單價未知。費用紀錄記 0，並在說明加上「（未計價）」。Firestore 規則要求 `cost` 和 `costHkd` ≥ 0，不能存 -1。

如有實際單價，貼 Part 1 之前，在 prompt 的 `server/imageModels.ts` 把對應 model 加上 `price: { perImageUsd: { '1K': … }, inputPerMillionTokensUsd: 0 }` 即可。

## 用戶會看到的改變

- **模型選單**：header 的自製下拉選單換成 image-kit 的選單。
  - 選單按 Google Gemini、ToAPIs 提供、KIE 提供分組，共 11 個 model：
    - Google：Nano Banana 2.1（預設）、Nano Banana 2、Nano Banana Pro。名稱沿用原本的。
    - ToAPIs：Nano Banana 2 Preview、GPT Image 2、GPT Image 2.5 Flare、GPT Image 2.5 Sunburst、Doubao Seedream 5.0 Pro。
    - KIE：Grok Imagine 2.0、GPT Image 2、Nano Banana 2。
  - 原本的「預設」標籤和每個 model 的說明不再顯示在選單內；說明改為滑鼠停在選單上時顯示。
  - 選單載入失敗時，會變成「模型清單載入失敗，按此重試」按鈕。
  - 之前存下的選擇會重設為 Nano Banana 2.1：model ID 改為 `provider:familyId`（例如 `google:gemini-3-pro-image`），舊 ID 不再沿用。之前選 Pro 或 Nano Banana 2 的用戶要重新選一次。
- **參考圖上限**：每次送出的參考圖 = 樣板（0 或 1 張）+ 全部素材 + Logo（0 或 1 張）。
  - 上限不夠的 model 在選單變灰，並標示原因。例如 Grok 最多 5 張、ToAPIs GPT Image 2 最多 6 張、Google 最多 14 張。
  - 已選中的 model 不夠時，「開始生成」上方會顯示紅字原因，按鈕會變灰。所以不會先付費做文字分析才失敗，也不會刪圖或自動換 model。
  - 模型清單載入完成前，「開始生成」也是灰色的。
- **AI 忠實程度（temperature）**：只有 Google 的三個 model 支援。選其他 model 時，滑桿和三個預設按鈕變灰並顯示說明，原本的數值保留。
- **比例**：送 model 原生支援的比例，沒有的話送最接近的，再照舊由前端裁切到準確尺寸。

  | UI 比例 | 原本送 | 現在（Google 和大部分 model） | 例外 |
  | --- | --- | --- | --- |
  | 300x250、336x280 | 4:3 | 5:4 | Seedream 4:3、Grok 1:1 |
  | 320x480 | 3:4 | 2:3 | |
  | 300x600 | 9:16 | 9:16 | KIE GPT Image 2 1:2 |
  | 4:5、3:4 | 不變 | 不變 | Grok 2:3、Seedream 4:5→3:4 |

  解像度維持一律 1K。
- **深度編輯和 AI 擦除 Logo**：
  - 保持原圖比例：Google 不指定比例，其他 model 送最接近畫布的比例，結果居中裁切到畫布尺寸。原本是直接拉伸。
  - 選 Nano Banana 系列以外的 model 時，編輯面板會提示顏色標記效果可能較差。
- **錯誤面板**：平時不顯示，出錯時在右下角出現。
  - 內容包括 provider、model、code、HTTP status、task id 和比例，並提供「複製錯誤資訊」。
  - 會進入面板的錯誤：生圖、深度編輯、AI 擦除 Logo、文字分析、載入模型清單失敗。登入畫面也看得到。
  - 輸入檢查（例如「請上傳素材圖片」）和資料庫錯誤照舊用頂部的紅色 banner。
  - 生圖失敗不再顯示籠統的「請檢查 API 金鑰或網路連線」。
- **不再重試或 fallback**：選哪個 model 就只用哪個，每次請求只送一次。
  - 原本 server 對任何錯誤都會重試，最多共 3 次，每次都另外收費。
  - 原本選 Nano Banana 2.1 而 Google 回 404 或「not supported」時，會靜默改用 Nano Banana 2 出圖，但費用和紀錄照舊寫 2.1。
  - 現在兩者都直接報錯。
- **費用**：按所選 model 的單價計算。
  - 原本的價格表標示為 HKD，數字其實是 Google 的 USD 價，所以 header 的「本月累計」少算了約 7.8 倍。現在按 USD × 7.8 換算為 HKD。
  - 之前的紀錄不會被改寫，所以這個月的累計會混合舊（偏低）和新的數字。
  - 費用紀錄的 tokens 欄位現在是估計的輸入 token（參考圖和 prompt），不再是固定的輸出 token。
- **History 和費用紀錄**：新紀錄存 model ID，顯示時換成名稱；舊紀錄照原本存的名稱顯示。

## 順手修正的錯誤

- **「取消」按鈕**：原本只是隱藏進度，生成迴圈照樣跑完並收費。現在會中止進行中的請求，餘下的比例不再生成。已提交給 provider 的任務仍會收費。
- **兩個比例**：原本第二個比例失敗時，第一張已生成的圖不會存入 history，但它的費用已經記了。現在兩個比例互不影響：成功的照常存入 history，失敗的各自進入錯誤面板。
- **參考圖格式**：原本所有參考圖都當作 JPEG 送出，包括深度編輯確認後的 PNG 樣板和素材。現在按實際格式送出。
- **`vite.config.ts`**：刪除把 `GEMINI_API_KEY` 注入瀏覽器 bundle 的 `define`。現在沒有程式讀它，所以未洩漏；刪除是為了防止日後洩漏。

## 已知問題（這次沒有改）

- **深度編輯寫回 history 會失敗**：在 history 圖片上做深度編輯並確認後，`updateDoc` 會被 `firestore.rules` 的 `allow update: if false` 擋住，只在 console 留下警告。要修就要改安全規則，或改為另建一筆新紀錄，兩者都是產品決定。這與 provider 遷移無關。
- **CORS 說明的 bucket 名稱**：畫布被跨域圖片污染時，說明叫用戶設定 `gs://hk01-ai-image-6202-jun23.appspot.com`，但 app 設定的 bucket 是 `hk01-ai-image-6202-jun23.firebasestorage.app`。無法確認哪個正確，所以沒有改。
- **Temperature 說明的用語**：image-kit 的說明文字提到 "catalogue"，對一般用戶較難明白。要改需要發佈新版 image-kit，InfoCard、open-graph-single、auto-og 也會一併受影響。

## 驗證清單（在 AI Studio，用真 key）

1. 每個 provider 各選一個 model，各跑一次生成：
   - 有樣板、2 張素材和 Logo，比例 16:9；
   - 只有素材，比例 300x250。
2. 一次選兩個比例，其中一個用會失敗的設定（例如錯誤的 `KIE_API_KEY`）：另一張應照常生成並存入 history，失敗的進入錯誤面板。
3. 深度編輯：Nano Banana 2.1 和 KIE GPT Image 2 各做一次顏色標記修改。結果應保持原圖尺寸；選 KIE 時面板顯示遮罩提示。
4. 在 Logo 模式做一次「AI 智能擦除並替換」。
5. 放 1 個樣板 + 5 張素材 + Logo（共 7 張）：
   - ToAPIs GPT Image 2（上限 6 張）和 Grok（上限 5 張）在選單應變灰；
   - 若已選中其中一個，「開始生成」應變灰並顯示紅字原因。
6. 選 KIE 或 ToAPIs 的 model：「AI 忠實程度」應變灰並顯示說明；切回 Google 後恢復原值。
7. 生成途中按「取消」：進度消失，server log 出現 `request cancelled by the client`，不再生成餘下的比例。
8. 用錯誤的 `KIE_API_KEY` 生成一次：右下角應出現錯誤面板，內容包含 `kie/…` 和 code `auth`；「複製錯誤資訊」可以複製完整報告。
9. 選一個 KIE GPT Image 2 的長任務（通常超過 60 秒），確認不會中途斷線。
10. Server log 有 `[usage] app=opengraph2 …` 行，ToAPIs 有 `ref=opengraph2:<uuid>`。
11. 登入、漫畫化、樣板組合、Logo 即時套用、下載、history 和費用紀錄照常運作；「本月累計」按新單價增加。
12. 若有錯，把「複製錯誤資訊」的內容和 server log 貼回來。

## 注意事項

- 已提交給 provider 的任務，即使 client 中途斷線或按取消，也會照常收費；server 只會停止輪詢。
- 每次 request 只送一次，不會自動重送已計費的請求。
- 長任務的上限由各 package 決定（KIE 10 分鐘、ToAPIs 6 分鐘、Google 5 分鐘）。60 秒的 proxy idle timeout 由 NDJSON ping 處理。
- image-kit 是共用 package，升級或 rollback 只需改 `package.json` 的 URL。不要把它的程式碼複製進 app 修改；需要改動時在 pi-ai-extra 發佈新版本。

## Rollback

- **整個 app**：用前置條件第 2 步的 ZIP 還原。
- **只換 package 版本**：把 `package.json` 四條 URL 改回舊版本號後重新 build。已發佈的 release 不會被覆蓋，同一條 URL 永遠安裝同一份檔案。
