# Seedream 5.5 和 GPT Image 2.6 升級指南（所有 image-kit app 通用）

kie 0.8 和 toapis 0.7 加入了四個圖片模型：KIE 和 ToAPIs 的 Seedream 5.5，以及 ToAPIs 的 GPT Image 2.6 Flare / Sunburst。本指南用兩段通用的 Gemini prompt，把已接入 image-kit 的 AI Studio app 升級到 kie 0.8.1、toapis 0.7.1 和 image-kit 0.2.1，並為新模型加上名稱和價錢。

對應 [DATA-4688](https://hk01-digital.atlassian.net/browse/DATA-4688)，每個 app 一張 sub-ticket：

| App | Ticket |
| --- | --- |
| open-graph-single | [DATA-4689](https://hk01-digital.atlassian.net/browse/DATA-4689) |
| InfoCard 多功能製圖大師 | [DATA-4690](https://hk01-digital.atlassian.net/browse/DATA-4690) |
| Auto OG（OG 拼貼大師自動駕駛版） | [DATA-4691](https://hk01-digital.atlassian.net/browse/DATA-4691) |
| opengraph2（OpenGraph2 圖片製作大師，open-graph-single 的 Backup app） | [DATA-4692](https://hk01-digital.atlassian.net/browse/DATA-4692) |
| og-master（OG 拼貼大師，Auto OG 的 Backup app） | [DATA-4693](https://hk01-digital.atlassian.net/browse/DATA-4693) |

## 版本

| Package | 版本 | 改動 |
| --- | --- | --- |
| `@hk01/pi-ai-extra-kie` | 0.8.1 | 0.8.0：加入 Seedream 5.5（`kie:seedream-5-5`）；`costTime` 改為正確地由秒換算成毫秒。0.8.1：GPT Image 2 可用 1:1 配 4K，以及 `auto` 配 2K、4K；Grok Imagine Image 2.0 文生圖的 prompt 上限 8,000 字 |
| `@hk01/pi-ai-extra-toapis` | 0.7.1 | 0.7.0：加入 GPT Image 2.6 Flare / Sunburst 和 Seedream 5.5；預設 host 由 `toapis.com` 改為 `api.toapis.com`。0.7.1：GPT Image 2 的參考圖上限由 6 張改為 14 張 |
| `@hk01/pi-ai-extra-image-kit` | 0.2.1 | 新模型會自動出現在選單；選比例時不再避開 KIE GPT Image 2 已放寬的組合。要求 kie 0.8.1 或以上，所以三個 package 要一起升級 |
| `@hk01/pi-ai-extra-google` | 不變 | |

ToAPIs 改 host 對 app 沒有影響：image-kit 不讓 app 設定 ToAPIs 的 host，新版 package 會自動用 `api.toapis.com`。

## 怎樣使用

1. 三個 release 都已發佈，下面三條 URL 都可以下載：
   - `https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.8.1/hk01-pi-ai-extra-kie-0.8.1.tgz`
   - `https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.7.1/hk01-pi-ai-extra-toapis-0.7.1.tgz`
   - `https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.1/hk01-pi-ai-extra-image-kit-0.2.1.tgz`
2. 在 AI Studio 匯出整個 app 的 ZIP 備份。
3. 依序貼上兩段 prompt。貼完一段，等 Gemini 回報 `npm run lint` 的結果和改動清單，檢查過才貼下一段：
   1. [`gemini-prompt-part1.md`](gemini-prompt-part1.md)：升級 kie、toapis 和 image-kit，在 policy 加入四個新模型的名稱、`maskEditing` 和價錢，並更新 GPT Image 2.5 的價錢。
   2. [`gemini-prompt-part2.md`](gemini-prompt-part2.md)：處理 policy 以外按 model ID 寫的程式碼，例如 prompt 分支、價錢計算、顯示名稱表和 `.env.example` 的說明；open-graph-single 另有一步，讓 KIE Seedream 5.5 也用 Seedream 的 prompt。
4. 對照 Gemini 的報告和下面「各 app 要留意的地方」，檢查它有沒有漏改或改錯。
5. 按「驗證清單」在 AI Studio 測試。

**升級 URL 和修改 policy 必須一起做**（都在 Part 1）。policy 寫了新模型、URL 卻仍是舊版時，image-kit 會報 `references unknown model family`，模型選單會載入失敗。只升級 URL、不改 policy 不會出錯，但新模型會用 catalogue 的預設名稱，也沒有價錢。

image-kit 0.2.1 要求 kie 0.8.1 或以上：只升級其中一個，`npm install` 會報 peer dependency 錯誤（`ERESOLVE`）。不要用 `--force` 或 `--legacy-peer-deps` 繞過，要把三條 URL 都改好。

Part 1 的名稱跟隨各 app 現有的寫法。例如 app 把 Seedream 5.0 Pro 叫「Doubao Seedream 5.0 Pro (ToAPIs)」，ToAPIs 的新模型就叫「Doubao Seedream 5.5 (ToAPIs)」。KIE 的一律叫「Seedream 5.5 (KIE)」，因為 KIE 不是用 Doubao 的名義出售。

## 已用 kie 0.8.0 / toapis 0.7.0 套用過本指南的 app

policy 和程式碼都不用再改，只要把三條 URL 換成新版本。在 AI Studio 匯出 ZIP 備份後，把下面這段貼給 Gemini：

```text
Open package.json. Replace every URL of these three packages, wherever it appears (dependencies, and also overrides, resolutions or any other section), with these exact URLs, and change nothing else:

- @hk01/pi-ai-extra-kie: https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.8.1/hk01-pi-ai-extra-kie-0.8.1.tgz
- @hk01/pi-ai-extra-toapis: https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.7.1/hk01-pi-ai-extra-toapis-0.7.1.tgz
- @hk01/pi-ai-extra-image-kit: https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.1/hk01-pi-ai-extra-image-kit-0.2.1.tgz

Then run npm install (do not use --force or --legacy-peer-deps) and npm run lint, and report each package.json line you changed.
```

## 各 app 要留意的地方

以下根據本機的 clone，open-graph-single、InfoCard 和 Auto OG 的 clone 是 2026-10 的版本，可能跟 AI Studio 現況不同。

| App | 留意 |
| --- | --- |
| open-graph-single | <ul><li>價錢不在 policy，在 `src/lib/pricing.ts` 按 model ID 寫死：要把 GPT Image 2.5 改為新價，並加入四個新模型。這個函數會收到參考圖張數，所以 KIE Seedream 5.5 的每張參考圖費用（US$0.0072）可以計算進去。</li><li>`server/imagePrompts.ts` 有兩處 `includes('gpt-image-2.5')`，要加上 2.6。</li><li>`includes('doubao')` 是 Seedream 專用的精簡 prompt（生圖和編輯各一段），放在 ToAPIs 分支之內。字節建議 Seedream 的 prompt 不超過 300 個中文字或 600 個英文詞，其他分支的 prompt 長得多，所以保留這段。Part 2 Step 3 把條件改為 `isSeedream`（`appModelId.includes('seedream')`），讓 KIE Seedream 5.5 也用它；prompt 文字不變。這段 prompt 沒有 logo 鎖定和參考圖角色的說明，Seedream 5.0 Pro 現在已是如此。</li><li>`src/models.config.ts` 的顯示名稱表要加入四個新模型。</li></ul> |
| InfoCard | <ul><li>`package.json` 的 `overrides` 也寫了 provider URL。</li><li>`convertReference` 按模型接受的格式轉檔，ToAPIs Seedream 5.5 只收 PNG / JPEG，WebP 和 GIF 參考圖會自動轉換，不用改。</li><li>`.env.example` 仍寫「Nano Banana 2 Preview」，Part 2 會順帶改為「Nano Banana 2.1」。</li></ul> |
| Auto OG | Seedream 5.0 Pro 的名稱是「Seedream 5.0 Pro (ToAPIs)」，沒有「Doubao」，新模型跟隨。預設模型 GPT Image 2.5 Flare 不變。`collage` 和 `edit` scope 只排除 Grok，新模型會出現在所有 scope。 |
| opengraph2 | `package.json` 的 `dependencies`、`overrides` 和 `resolutions` 三處都有 provider URL。費用預估一律按 1K 計。 |
| og-master | 改用 image-kit 後的 policy 應該跟 Auto OG 相同。本機沒有那個版本的 clone，要按 Gemini 的報告確認。 |

## 用戶會看到的改變

- **模型選單**：多了 GPT Image 2.6 Flare、GPT Image 2.6 Sunburst、Seedream 5.5（ToAPIs）和 Seedream 5.5（KIE）。
- **Seedream 5.5 最高 2K**：兩個 provider 都沒有 4K。app 讓用戶選 4K 時，image-kit 會回「不支援 4K 解像度」。
- **保留原圖比例**：只放一張參考圖並要求保留比例時，Seedream 5.5 會用 `auto`。實測 Seedream 5.5（KIE 和 ToAPIs）把 640×360 的參考圖輸出為 1360×768，比例保持不變。GPT Image 2.6 跟 2.5 一樣，改用最接近的比例：2.6 的標準層不支援 `auto`（實測回 503，ToAPIs 的文件現在也寫明了），所以 package 不提供它。
- **KIE GPT Image 2**：可以用 1:1 配 4K；在 2K、4K「保留原圖比例」時改送 `auto`，實測 16:9 的參考圖在 2K 輸出 2736×1536，比例保持不變。
- **ToAPIs GPT Image 2**：參考圖上限由 6 張改為 14 張。
- **KIE Grok Imagine Image 2.0 文生圖**：prompt 超過 8,000 字時，在送出前就報錯。
- **GPT Image 2.5 加價**：ToAPIs 已把 2.5 調到 4.5 credits 一張（sheet 上寫 ¥0.16），即 1K / 2K / 4K 為 US$0.0225 / 0.03 / 0.0375，各 app 的預估跟着更新。
- **費用預估**（USD / 張，2026-11-11 在線上讀取，存於 [`toapis-image-pricing-doc.md`](../../../referenc-docs/toapis/toapis-image-pricing-doc.md) 和 [`kie-seedream-5-5-pricing-doc.md`](../../../referenc-docs/kie/kie-seedream-5-5-pricing-doc.md)）：

  | Model | 1K | 2K | 4K | 參考圖 | 來源 |
  | --- | --- | --- | --- | --- | --- |
  | GPT Image 2.6 Flare / Sunburst（ToAPIs） | 0.018 | 0.024 | 0.03 | 不收 | ToAPIs 價目頁和 model guide |
  | Seedream 5.5（ToAPIs） | 0.016 | 0.028 | — | 不收 | ToAPIs 價目頁和 model guide（3.2 / 5.6 credits） |
  | Seedream 5.5（KIE） | 0.018 | 0.0315 | — | 每張 0.0072 | KIE 價目 API（3.6 / 6.3 credits，參考圖 1.44 credits） |
  | GPT Image 2.5 Flare / Sunburst（ToAPIs） | 0.0225 | 0.03 | 0.0375 | 不收 | ToAPIs 價目頁和 model guide |

  image-kit 的價錢格式只有每張圖價和每百萬 input token 價，表達不到 KIE 按參考圖張數收的費用，所以 policy 的預估不包括它。用 KIE Seedream 5.5 編輯時，實際收費會比預估多（每張參考圖 US$0.0072），所以 Part 1 把這筆費用寫在 KIE 模型的 description，讓用戶在選單看到。open-graph-single 自己計價，可以計算進去。

## 本機測試

- **離線 smoke test**：用 npm 把 kie 0.8.1、toapis 0.7.1、google 0.8.0 和 image-kit 0.2.1 的 release 裝到空項目。
  - ESM 和 CommonJS 都能載入；
  - 選單列出四個新模型，參考圖上限、解像度和 policy 的價錢都正確；image-kit 為 KIE GPT Image 2 選 1:1 配 4K；
  - policy 寫了不存在的 key 時，報 `unknown model family`；
  - image-kit 0.2.1 配 kie 0.8.0 時，`npm install` 以 `ERESOLVE` 失敗。
- **實測**（2026-11-11，用 portal 的 key，每個模型一張 1K）：
  - KIE Seedream 5.5 文生圖 16:9 輸出 1424×800，收 3.6 credits；編輯收 5.04 credits（3.6 + 1.44）。
  - ToAPIs Seedream 5.5 選了比例時以像素送出，16:9 送 1424×800，輸出也是 1424×800，收 US$0.016（1K 價）。
  - GPT Image 2.6 Flare 和 Sunburst 都成功（Sunburst 有試過帶參考圖），各收 US$0.018，但每張要約 4 分鐘。
  - 兩個 2.6 模型收到 `size: "auto"` 時都回 503「請求的模型暫無可用服務」，所以 package 不提供 `auto`。
  - KIE GPT Image 2：1:1 配 4K 輸出 2880×2880，`auto` 配 2K、4K 都成功；ToAPIs GPT Image 2 帶 14 張參考圖成功。

## 驗證清單（在 AI Studio，用真 key）

1. `npm install` 沒有 peer dependency 錯誤；兩段 prompt 之後 `npm run lint` 都通過；Gemini 報告裏的每一處改動都合理。
2. 模型選單：有四個新模型，名稱跟 app 其他模型的寫法一致，費用預估顯示上表的價錢。
3. 用四個新模型各生成一張圖，都成功。GPT Image 2.6 每張要約 4 分鐘。
4. 選 Seedream 5.5（KIE 或 ToAPIs）配 2K，成功；選 4K 時顯示不支援。
5. 用 Seedream 5.5 放一張參考圖編輯，成功，比例跟參考圖一致。
6. GPT Image 2.5 的費用預估顯示新價錢。
7. open-graph-single：舊歷史紀錄仍顯示 model 名稱；GPT Image 2.6 用 2.5 那套 prompt；兩個 Seedream 5.5 都用 Seedream 的精簡 prompt（可在 server log 或 Gemini 報告核對）。
8. Server log 沒有 `unknown model family`。

## Rollback

- **整個 app**：用 ZIP 還原。
- **只想退回舊版**：kie、toapis 和 image-kit 三條 URL 一起改回舊版本，**同時**刪除 policy 裏四個新模型的 entry。只改其中一樣，選單會載入失敗或 `npm install` 報錯（見「怎樣使用」）。
