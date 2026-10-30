# Nano Banana 2.1 升級指南（所有 image-kit app 通用）

Google、KIE 和 ToAPIs 準備淘汰它們的 Nano Banana 2 圖片模型。google 0.7.0、kie 0.6.0 和 toapis 0.6.0 刪除了這些模型，改為提供 Nano Banana 2.1。本指南用一段通用的 Gemini prompt（[`gemini-prompt.md`](gemini-prompt.md)），把已接入 image-kit 的 AI Studio app 升級到這三個版本。

對應 [DATA-4601](https://hk01-digital.atlassian.net/browse/DATA-4601)，每個 app 一張 sub-ticket：

| App | Ticket |
| --- | --- |
| open-graph-single | [DATA-4602](https://hk01-digital.atlassian.net/browse/DATA-4602) |
| InfoCard 多功能製圖大師 | [DATA-4603](https://hk01-digital.atlassian.net/browse/DATA-4603) |
| Auto OG（OG 拼貼大師自動駕駛版） | [DATA-4604](https://hk01-digital.atlassian.net/browse/DATA-4604) |
| opengraph2（OpenGraph2 圖片製作大師，open-graph-single 的 Backup app） | [DATA-4605](https://hk01-digital.atlassian.net/browse/DATA-4605) |
| og-master（OG 拼貼大師，Auto OG 的 Backup app） | [DATA-4606](https://hk01-digital.atlassian.net/browse/DATA-4606) |

## 版本

| Package | 版本 | 改動 |
| --- | --- | --- |
| `@hk01/pi-ai-extra-google` | 0.7.0 | 刪除 `gemini-3.1-flash-image`（Nano Banana 2） |
| `@hk01/pi-ai-extra-kie` | 0.6.0 | `nano-banana-2` 換成 `nano-banana-2-1` |
| `@hk01/pi-ai-extra-toapis` | 0.6.0 | `gemini-3.1-flash-image-preview` 換成 `gemini-nano-banana-2.1` |
| `@hk01/pi-ai-extra-image-kit` | 0.2.0（不變） | 沒有改動 |

這個組合已在本機實際測試：用 npm 把 image-kit 0.2.0 的 release 和三個新版 provider 裝到空項目（沒有裝 pi-ai）。測試結果：
- ESM 和 CommonJS 都能載入；
- 選單列出兩個新 model，參考圖上限、遮罩設定和價錢都正確；
- policy 寫舊 key 時報 `unknown model family`；
- 用舊 ID 請求回 `unsupported_model`。

## 怎樣使用

1. 確認三個 release 已經發佈，三條 URL 都可以下載（見 `gemini-prompt.md` Step 1）。
2. 在 AI Studio 匯出整個 app 的 ZIP 備份。
3. 把 [`gemini-prompt.md`](gemini-prompt.md) 的全部內容貼給 Gemini。
4. 對照 Gemini 的報告和下面「各 app 要留意的地方」，檢查它有沒有漏改或改錯。
5. 按「驗證清單」在 AI Studio 測試。

**升級 URL 和修改 policy 必須一起做。** image-kit 遇到 policy 寫了已刪除的 model 時會直接報錯（`references unknown model family`），模型清單會載入失敗：

- 只升級 URL、不改 policy：選單載入失敗。
- 已改 policy、URL 仍是舊版：同樣失敗，因為舊版沒有兩個新 model。

Prompt 不用逐字比對原文，而是按用途描述改動，所以五個 app 共用同一段。

## 各 app 要留意的地方

| App | 留意 |
| --- | --- |
| open-graph-single | `src/lib/pricing.ts` 按 model ID 自己計價：要刪除 Nano Banana 2 的分支，改正 2.1 的單價，並加入 KIE 和 ToAPIs 2.1。`src/models.config.ts` 是歷史紀錄用的名稱表，舊 ID 要保留。 |
| InfoCard | `package.json` 的 `overrides` 也寫了三條 URL；Google 2.1 原本誤用了 Nano Banana 2 的單價（0.067 / 0.101 / 0.151）。 |
| Auto OG | `server/imageModels.ts` 的 `NANO_BANANA_2_FAMILIES` 要剛好是 Google、KIE、ToAPIs 三個 2.1。這份清單決定拼貼時哪些 model 用 Nano Banana 專用的 prompt 文字。 |
| opengraph2 | `package.json` 的 `overrides` 也寫了三條 URL。 |
| og-master | 沒有特別的地方。`.env.example` 的說明文字會順帶更新。 |

InfoCard（`pi-ai-migration/`）和 opengraph2（`pi-ai-extra-migration/`）裏有之前遷移留下的 `.ts` 快照，Auto OG 有一個叫 `'nano-banana-2'` 的 prompt profile 名稱。Prompt 已經叫 Gemini 不要改這些。

## 用戶會看到的改變

- **模型選單**：
  - Google：少了 Nano Banana 2，剩下 Nano Banana 2.1 和 Nano Banana Pro。
  - ToAPIs：Nano Banana 2 Preview 換成 Nano Banana 2.1 (ToAPIs)，參考圖上限由 6 張變成 14 張。
  - KIE：Nano Banana 2 換成 Nano Banana 2.1 (KIE)，參考圖上限由 14 張變成 **10 張**。超過 10 張時，這個 model 會在選單變灰。
- **之前選了舊 model 的用戶**：瀏覽器記住的 model 已不在清單內時，選單會自動切回 app 的預設 model（Nano Banana 2.1），不用另外處理。
- **費用預估**：

  | Model | 1K | 2K | 4K | 輸入 | 來源（2026-10-30） |
  | --- | --- | --- | --- | --- | --- |
  | Nano Banana 2.1（Google） | 0.0336 | 0.0504 | 0.113 | $1.50 / 百萬 token | Google 定價頁 |
  | Nano Banana 2.1（KIE） | 0.02 | 0.03 | 0.045 | 不收 | kie.ai/pricing（4 / 6 / 9 credits） |
  | Nano Banana 2.1（ToAPIs） | 0.015 | 0.015 | 0.015 | 不收 | ToAPIs 價目 API，每次請求固定價 |

  單位是 USD / 張。KIE 和 ToAPIs 的舊 model 原本沒有價錢（「未計價」），現在有了。Google 2.1 的輸入價原本在各 app 都寫成 $0.50 / 百萬 token，現在改正為 $1.50。

## 驗證清單（在 AI Studio，用真 key）

1. `npm run lint` 通過；Gemini 報告裏的每一處改動都合理。
2. 模型選單：三個 provider 各有一個 Nano Banana 2.1；看不到 Nano Banana 2 和 Nano Banana 2 Preview。
3. 用 Google、KIE、ToAPIs 的 Nano Banana 2.1 各生成一張圖，都成功。費用預估顯示上表的價錢，不是「未計價」。
4. 選 KIE Nano Banana 2.1，放 11 張參考圖（如果 app 允許這麼多）：生成按鈕變灰，並顯示超出上限的原因。
5. 編輯（如果 app 有）：選 KIE 或 ToAPIs 的 2.1 時，不顯示「遮罩只作參考」的提示。
6. open-graph-single：舊的歷史紀錄仍然顯示 model 名稱。
7. Auto OG：選 KIE 或 ToAPIs 的 2.1 拼貼一次，素材圖的人物應出現在前景，跟選 Google 2.1 時一樣。
8. Server log 沒有 `unknown model family`。

## Rollback

- **整個 app**：用 ZIP 還原。
- **只想退回舊 model**：三條 URL 改回舊版本，**同時**把 policy 和 Step 3 的改動還原。只改其中一樣，選單會載入失敗（見「怎樣使用」）。
