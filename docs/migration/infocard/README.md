# InfoCard 遷移指南（Google AI Studio）

本指南把「InfoCard 多功能製圖大師」（下稱 InfoCard）全部五條生圖 route 改為使用 `@hk01/pi-ai-extra-*` packages，讓四個工具（OG 拼貼、InfoCard 圖卡、OG 奪舍、批量修圖）和圖片編輯器都可以按 provider 分組選擇 Google、ToAPIs、KIE 共 10 個圖片模型。對應 [DATA-4515](https://hk01-digital.atlassian.net/browse/DATA-4515)。

文字模型（文章分析、素材提取、Prompt Magic）維持直接使用 Gemini SDK，不在這次改動範圍內。

這次第一次使用新的 [`@hk01/pi-ai-extra-image-kit`](../../../packages/image-kit/README.md) 0.1.0。它是各 app 共用的圖片 client，負責模型清單、請求檢查、串流、選單和錯誤面板，和其他 package 一樣以 release URL 安裝。InfoCard 自己只保留模型清單和設定（`server/imageModels.ts`）。

## 怎樣使用這個資料夾

依序做以下步驟：

1. **手動把 server build 改為 ESM**（見下面「步驟 0」）。改完先確認 app 照常運作。
2. 貼上 [`gemini-prompt-part1.md`](gemini-prompt-part1.md) 全文（server 端，包括安裝四個 package）。等 Gemini 改完，並回報 `npm run lint` 通過。
3. 貼上 [`gemini-prompt-part2.md`](gemini-prompt-part2.md)（共用 client 程式、OG 拼貼、編輯器、費用紀錄）。
4. 貼上 [`gemini-prompt-part3.md`](gemini-prompt-part3.md)（InfoCard 圖卡、OG 奪舍、批量修圖）。完成後才測試；三段未全部完成前，生圖功能不能正常使用。

拆成三段，是因為整份約 2,600 行，一次貼上容易被截斷或漏改。每段都有一個 lint 檢查點。

如果要手動修改或核對 Gemini 的改動，可以用以下兩份參考：

- `files/`：已驗證的檔案。`server/imageModels.ts` 是新檔案，可以直接複製；`server.ts`、`vite.config.ts`、`src/main.tsx`、`src/store.ts`、`src/types/*`、`src/lib/*`、`src/components/TokenHistory.tsx` 是修改後的完整版本。
- `changes.diff`：步驟 0 之後的所有改動（`package-lock.json` 除外），包括 `App.tsx`、`DeepEditor.tsx`、`InfoCardExpert.tsx`、`PossessionExpert.tsx`、`BatchExpert.tsx`。這五個檔案太大，沒有放完整版本。

注意：

- 這些檔案是根據 2026-10-05 本機的 InfoCard 版本修改的。之後在 AI Studio 做過的改動，若直接整份貼上 `files/` 的檔案會被覆蓋。prompt 用 diff 描述修改，並要求 Gemini 在對不上時按意圖修改，較不受影響。
- 本資料夾的 `tsconfig.json` 和 `typecheck/` 只供本 repo 用 app 的編譯設定檢查 `files/`（由 `pnpm run check:docs` 執行），不要複製到 app。

## 步驟 0：手動把 server build 改為 ESM

InfoCard 現在把 `server.ts` 打包成 CommonJS（`dist/server.cjs`）。pi-ai 只有 ESM，其他已遷移的 app 也都用 ESM，所以先改為 ESM。

1. 在 AI Studio 的檔案樹打開 `package.json`。
2. 在 `"build"` 這一行，把 `--format=cjs` 改為 `--format=esm`，把 `--outfile=dist/server.cjs` 改為 `--outfile=dist/server.mjs`。
3. 把 `"start": "node dist/server.cjs"` 改為 `"start": "node dist/server.mjs"`。
4. 其他不用改：`"type": "module"` 已經存在，`server.ts` 沒有用 `require` 或 `__dirname`，`opencc-js` 有 ESM 版本。
5. 重新 build / 部署，確認 app 可以開啟，隨便用一個工具生成一張圖。

改完後兩行應該是：

```json
"build": "vite build && esbuild server.ts --bundle --platform=node --format=esm --packages=external --sourcemap --outfile=dist/server.mjs",
"start": "node dist/server.mjs",
```

在本機副本驗證過：只改這兩行，`npm run build` 成功，`node dist/server.mjs` 可以啟動並提供頁面和 API。

## 已驗證的範圍

以下是在 InfoCard 的副本上驗證的。三個 provider package 從 release URL 安裝；image kit 未發佈，用本 repo 打包的 `hk01-pi-ai-extra-image-kit-0.1.0.tgz` 安裝，內容與將要發佈的相同：

- `npm run lint`（tsc）和 `npm run build` 通過。
- 用假的 key build 後搜尋 `dist/`，找不到任何 key；瀏覽器 bundle 內沒有 provider package 的程式碼。
- 用 `node dist/server.mjs` 實際呼叫（假 key）：
  - `GET /api/image-models`：10 個 model，參考圖上限、解像度、temperature 和 key 可用性都正確；沒有 `TOAPIS_API_KEY` 時，ToAPIs 的 5 個 model 標示為不可用並附上原因。
  - 驗證錯誤在呼叫 provider 之前回覆：ToAPIs 缺 key 回 503；KIE 帶 temperature 回 400；已移除的 `openrouter-gpt-image-2` 回 400；Grok 6 張參考圖回 400；Grok 用 4K 回 400。
  - Google、KIE（無效 key）經 NDJSON 回傳含 provider、model、code 的錯誤。
- 以假的 Gemini endpoint 跑完整成功流程，確認送出的參數和輸出尺寸：
  - OG 300x250 送 5:4（原本 4:3），輸出 300×250；temperature 0.4 有送出。
  - 編輯 300×250 的廣告圖，Gemini 不指定比例，輸出仍是 300×250（原本會變成 1200×900）。
  - InfoCard 9:16 2K 輸出 1350×2400；OG 奪舍 16:9 輸出 1200×675，回應附 `metadata`。
  - 批量 4:5 4K 送 `4K`，輸出 3200×4000；沒有底圖的格子用 1:1；Logo 壓印照常。
  - 批量「保持原圖尺寸」：只有底圖時 Gemini 不指定比例；另有風格參考圖時明確送最接近底圖的比例（例如 4:5）；結果一律居中裁切到底圖的準確比例（300×250 底圖 → 1024×853）。
  - 手機相片的 EXIF 旋轉：存成 400×300、顯示為 300×400 的相片，送出時已轉正為 300×400，結果為 3:4。
- NDJSON keep-alive：21 秒的任務在第 10、20 秒各收到一次 ping，第 21 秒完成；client 中途取消時，server 隨即中止 provider 請求。
- 參考圖轉換：WebP 轉 JPEG（有透明度則轉 PNG），超過 10 MB 的圖會縮小到上限內。
- image kit：51 個測試和 strict 型別檢查通過；打包後的 `.tgz` 連同三個 provider package 和 React 安裝到全新專案，以 `require()` 和 `import()` 載入四個入口都正常（與 release workflow 的 smoke test 相同）。
- 一致性：prompt 內嵌的程式碼和 diff 由已驗證的副本直接產生，與 `files/`、`changes.diff` 逐字相同。

**未驗證**：UI 沒有在瀏覽器實際操作過，也沒有用真 key 出圖。這兩項要在 AI Studio 按下面的驗證清單完成。

## 前置條件

1. 四個 release 可以匿名下載：`google-v0.2.0`、`kie-v0.1.0`、`toapis-v0.1.0`，以及**新的 `image-kit-v0.1.0`**（本 PR merge 後打 tag 發佈）。
2. 改動前，在 AI Studio 把整個 app 下載（Download / Export ZIP）備份。AI Studio 沒有 Git，這份 ZIP 就是 rollback 手段。
3. Settings → Secrets：
   - `KIE_API_KEY`：新增。
   - `TOAPIS_API_KEY`：InfoCard 原本用 `TOAPI_API_KEY`（少一個 S），兩個名字都接受，已有的不用改。
   - `GEMINI_API_KEY`：已經存在，不用改。
   - `OPENROUTER_API_KEY`：不再使用，可以保留或刪除。

   缺少某個 key 時，該 provider 的 model 會在選單變灰，其他功能不受影響。

## 先確認預估單價

`server/imageModels.ts` 每個 model 有一個 `price` 欄位，只用於 OG 拼貼的預估費用和費用紀錄，不影響生圖。目前只填了查證過的單價（USD / 張）：

| Model | 1K | 2K | 4K | 來源 |
| --- | --- | --- | --- | --- |
| Nano Banana 2（Google） | 0.067 | 0.101 | 0.151 | [Google 定價頁](https://ai.google.dev/gemini-api/docs/pricing)（2026-10-06），輸入 $0.50 / 百萬 token |
| Nano Banana Pro（Google） | 0.134 | 0.134 | 0.24 | 同上，輸入 $2.00 / 百萬 token |
| GPT Image 2.5 Flare / Sunburst（ToAPIs） | 0.015 | 0.020 | 0.025 | ToAPIs 文件（2026-09-09） |

其餘 6 個 model 的單價未知，費用紀錄會顯示「—」，並另計「未計價」張數。InfoCard 原本的估值如下，但未經核實，也沒有區分解像度：

| Model | InfoCard 原本估值（USD / 張） |
| --- | --- |
| GPT Image 2（ToAPIs） | 0.08 |
| Doubao Seedream 5.0（ToAPIs，非 Pro） | 0.05 |
| Nano Banana Pro 1K | 0.096 + 每張參考圖 0.0011（與 Google 定價不符，已改為 0.134） |

如有實際單價，貼 Part 1 之前在 prompt 的 `server/imageModels.ts` 裏，把對應的 `price: null` 改成 `{ perImageUsd: { '1K': …, '2K': … }, inputPerMillionTokensUsd: 0 }` 即可。

Firestore 規則要求費用紀錄的 `costHKD` 是數字，所以未計價的圖片存為 `-1`，加總時會略過；不需要改 Firestore 規則。

## 用戶會看到的改變

- **模型選單**：四個工具各自有選單（仍然各自記住選擇），內容相同，按 Google Gemini、ToAPIs 提供、KIE 提供分組，次序跟 open-graph-single 一樣。模型清單載入完成前不能生成；載入失敗時選單變成「按此重試」按鈕，任何一個工具重試都會更新全部工具：
  - Google：Nano Banana 2、Nano Banana Pro。
  - ToAPIs：GPT Image 2.5 Flare、GPT Image 2.5 Sunburst、GPT Image 2、Doubao Seedream 5.0 Pro、Nano Banana 2 Preview。
  - KIE：Grok Imagine 2.0、GPT Image 2、Nano Banana 2。
  - 移除 GPT Image 2（OpenRouter）：沒有對應的 package，open-graph-single 也已停用。
  - Doubao Seedream 5.0 改為 package 支援的 Seedream 5.0 Pro。
  - 之前存下的已移除 model（OpenRouter、Seedream 5.0）會自動回到 Nano Banana 2。
  - OG 奪舍原本只有 3 個 model，現在也有全部 10 個。
- **參考圖上限**：各工具按實際要送的圖計算（樣板 + 素材 + Logo；批量修圖是風格參考圖 + 底圖 + 遮罩）。
  - 上限不夠的 model 在選單變灰，並標示「最多 N 張參考圖，已選 M 張」。
  - 已選中的 model 不夠時，顯示紅字提示，生成按鈕變灰或提示原因，不會自動換 model，也不會刪圖。
  - 批量修圖逐格檢查、InfoCard 逐張檢查：放不下的格子／圖卡直接標示失敗及原因，不會送出，其餘照常生成。
- **Grok Imagine 2.0**：有參考圖時最多 5 張，prompt 上限 8,000 字元。InfoCard 的固定 prompt 約 900–4,700 字元，一般不會超過；超過時在送出前報錯，不會收費。沒有參考圖的批量文生圖沒有字數上限。
- **Temperature**：只有 OG 拼貼有這個設定，而且只有 Google 直連的 Nano Banana 2 / Pro 會用到。選其他 model 時滑桿變灰並說明，原本的數值會保留。
- **比例**：送 model 原生支援的比例，否則送最接近的，再由 server 居中裁切到目標尺寸。例如 300x250 原本送 4:3，現在送 5:4（Seedream 送 4:3）；320x480 原本送 9:16，現在送 2:3。
- **解像度**：
  - 每個 model 都按 UI 的選擇送出。原本 ToAPIs GPT Image 2 一律用 1K、Seedream 一律用 2K。
  - 批量修圖的「頂級 4K」現在真的是 4K：送 4K，輸出 4:5 3200×4000、3:4 3072×4096、1:1 4096×4096、16:9 3840×2160、9:16 2160×3840。原本實際只輸出 1K。選 4K 時，Seedream 和 Grok 變灰。KIE GPT Image 2 在 4K 不支援 1:1，會送 5:4 再裁切。
  - Grok 沒有解像度選項，1K / 2K 時用它的預設尺寸，再 resize。
- **批量修圖「保持原圖尺寸」**：結果的比例與底圖完全相同。沒有該比例的 model（例如 Seedream）會先生成最接近的比例，再居中裁切；解像度照所選的 1K / 2K / 4K。手機相片按 EXIF 方向轉正後才送出，與在畫面上畫的遮罩一致。
- **編輯（DeepEditor）**：保持原圖的比例和像素尺寸。原本會把比例歸類到最接近的預設值再裁切，例如 300×250 的廣告圖編輯後變成 1200×900。Google 編輯照舊用 2K 生成。非 Nano Banana 系列的 model 會提示筆劃／遮罩效果可能較差。
- **參考圖格式**：Seedream 只接受 PNG / JPEG。WebP 等格式，或超過單張 10 MB 上限的圖片，server 會自動轉檔或縮小後才送出。
- **錯誤面板**：平時不顯示。出錯時在右下角出現，內容包括 provider、model、code、HTTP status、task id 和第幾張，並提供「複製錯誤資訊」、收起和關閉。登入畫面也看得到。生圖失敗不再用 `alert`。
- **批量**：
  - 批量修圖和 InfoCard「一鍵生成全部」照舊逐張順序執行。單張失敗不會中斷整批，也不會自動重試或換 model。
  - 批量修圖的失敗訊息顯示在該格（包括 provider / model）。InfoCard 失敗的圖卡會列在紅色方框，直到關閉；原本只寫在 console，用戶看不到。
  - 只有成功的格子才算入完成數。
- **OG 拼貼兩個比例**：逐個比例生成，其中一個失敗不會令另一個不生成；每個失敗各自進入錯誤面板。
- **取消**：OG 拼貼的「取消」按鈕原本沒有作用，現在會中止請求；批量修圖的取消照舊。兩者都會令 server 停止輪詢（已提交的任務仍會收費）。若在送出前已斷線，server 不會送出。
- **不再 fallback 或自動重試**：選哪個 model 就只用哪個。ToAPIs 安全審查被擋時，原本會改用簡化 prompt 自動重送一次，現在直接顯示錯誤，由用戶決定改 prompt 再試。
- **Prompt**：每個工具的 prompt 所有 model 共用，即原本 Gemini 路徑的 prompt。原本 ToAPIs / OpenRouter 路徑會把 InfoCard 圖卡和 OG 奪舍的 prompt 包進「OG 拼貼」的規則，丟失卡片內文、Reels 安全區等指示。
- **圖片在 prompt 中的位置**：原本 Gemini 收到「標籤、圖片、標籤、圖片…」交錯的內容；現在所有 model（包括 Google）都收到一段文字，以 `[Reference image N]` 標示每張圖的位置，圖片按次序附在後面。標籤文字完全保留。這與 open-graph-single、auto-og 的做法相同，建議用驗證清單第 1 項比較出圖效果。
- **費用**：OG 拼貼按所選 model 的單價、解像度和輸入估算；未知單價顯示「—」。

## 順手修正的錯誤

以下是原本的錯誤，這次一併修正：

- OG 拼貼、DeepEditor、批量修圖沒有把簡繁設定傳給 server，選簡體在這三處不會生效。
- 批量修圖的 Prompt Magic 呼叫不存在的 `/api/batch-edit/expand-prompt`，按了沒有反應。現在改為呼叫 `/api/batch-edit/prompt-magic`；失敗時會顯示訊息。
- 批量修圖「保持原圖尺寸」：Google 被強制送 1:1，ToAPIs 被強制送 4:5。
- 批量修圖 server 端用 `.slice(0, 5)` 靜默丟棄多於 5 張的參考圖。
- OpenRouter 的編輯根本沒有把原圖送出（隨 OpenRouter 一併移除）。
- OG 拼貼選兩個比例時，第一個失敗就不會生成第二個。
- 批量修圖的手機相片沒有按 EXIF 轉正：model 收到的方向可能與畫面上不同，遮罩也會對不上。
- InfoCard 全自動模式在文章分析完成後，仍然用分析前的標題和圖卡生成（React state 尚未更新）。現在直接用分析結果生成。
- OG 拼貼的生成紀錄存不進 Firebase 時，原本會當作「生成失敗」；現在另外報告「儲存生成紀錄」失敗，圖片照常顯示。
- 刪除 client 端未使用的 `@google/genai` import，以及 `vite.config.ts` 把 `GEMINI_API_KEY` 注入瀏覽器的 `define`。現在 client 沒有讀它，所以未洩漏；刪除是為了防止日後洩漏。

## 已知問題（這次沒有改）

- DeepEditor 的「AI 智慧抹除舊 Logo」（`applyLogoWithAIErase`）在同一個 render 內先設定 prompt 再執行編輯，所以送出的是上一次輸入的指令，而不是「抹除舊 Logo 並合成新 Logo」。新 Logo 圖片也沒有送給 model。只修 prompt 會令 model 憑空畫一個它沒看過的 Logo，結果可能更差，所以留待確認需求後再改。這與 provider 遷移無關。

## 驗證清單（在 AI Studio，用真 key）

1. 每個工具各選三個 provider 的一個 model 跑一次：OG 拼貼、InfoCard 單張和「一鍵生成全部」、OG 奪舍、批量修圖（有底圖、無底圖、有遮罩、有風格參考圖）。
2. DeepEditor：在 OG 拼貼、InfoCard、OG 奪舍各編輯一次，確認輸出尺寸和原圖相同（可以試 300x250 廣告圖）。
3. OG 拼貼放 1 張樣板 + 6 張素材（共 7 張）：選單裏的 ToAPIs GPT Image 2（上限 6 張）和 Grok（上限 5 張）應變灰。
4. 批量修圖選 4K：Seedream 和 Grok 應變灰；用 Nano Banana 2 出一張 4K，確認輸出 3200×4000（4:5）。
5. OG 拼貼選 KIE 或 ToAPIs 的 model：Temperature 滑桿應變灰並顯示說明；切回 Google 後恢復原值。
6. 用錯誤的 `KIE_API_KEY` 生成一次：右下角應出現錯誤面板，內容包含 `kie/…` 和 code `auth`，「複製錯誤資訊」可以複製完整報告。
7. 選一個 KIE GPT Image 2 的長任務（通常超過 60 秒），確認不會中途斷線。
8. 批量修圖跑 3 格，其中一格故意令它失敗（例如放超過上限的參考圖），確認其餘格子照常完成。
9. 簡體模式下用 OG 拼貼、批量修圖生成，確認圖中文字是簡體。
10. Server log 有 `[usage] app=infocard …` 行，ToAPIs 有 `ref=infocard:<uuid>`。
11. 文章分析、素材提取、Prompt Magic、Logo 壓印、ZIP 下載、Firebase 歷史照常運作。
12. 若有錯，把「複製錯誤資訊」的內容和 server log 貼回來。

## 注意事項

- 已提交給 provider 的任務，即使 client 中途斷線或按取消，也會照常收費；server 只會停止輪詢。
- 每次 request 只送一次，不會自動重送已計費的請求。
- 長任務的上限由各 package 決定（KIE 10 分鐘、ToAPIs 6 分鐘、Google 5 分鐘）。60 秒的 proxy idle timeout 由 NDJSON ping 處理。
- ToAPIs Seedream 預設會加浮水印，這裏固定送 `watermark: false`，與原本一致。
- 4K 較貴（Nano Banana 2 約 $0.151 / 張，Pro 約 $0.24 / 張），輸出檔案也較大。
- image kit 是共用 package，升級或 rollback 只需改 `package.json` 的 URL。不要把它的程式碼複製進 app 修改；需要改動時在 pi-ai-extra 發佈新版本。

## Rollback

- **整個 app**：用前置條件第 2 步的 ZIP 還原。
- **只換 package 版本**：把 `package.json` 四條 URL 改回舊版本號後重新 build。已發佈的 release 不會被覆蓋，同一條 URL 永遠安裝同一份檔案。
