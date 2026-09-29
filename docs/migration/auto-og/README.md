# Auto: OG 拼貼大師遷移指南（Google AI Studio）

此文件適用於 **Auto: OG 拼貼大師（自動駕駛版）**，對應 [DATA-4514](https://hk01-digital.atlassian.net/browse/DATA-4514)。目標是把 direct Gemini image generation / edit 邏輯改為 `@hk01/pi-ai-extra-*` image helper，令使用者可按 Provider 分組選取 Google、KIE、ToAPIs 的 image model。

> 這不是 `open-graph-single` 的直接 patch。Auto OG 是「讀文章 → 產生標題 → 產生／編輯 OG」pipeline，現有文字 selector 和圖片 selector 必須保持獨立。

## 範圍

### 會改變

- Collage generation 和 image edit 都經 single server-side image client 呼叫 `pi-ai-extra`。
- 新增 image Provider／model selector，按 Google、KIE、ToAPIs 分組。
- 移除 image model fallback；每次 request 只使用使用者選取的一個 provider/model。
- 移除 direct Gemini image SDK 呼叫、image response parsing、upload/poll/fallback 邏輯。
- 移除 Vite 將 `GEMINI_API_KEY` 注入 browser bundle 的設定。
- 新增 persistent、可收起／關閉、可複製的 provider error panel。

### 不會改變

- 現有 **文字 model selector**、文章讀取、文章清理、viral title generation 仍直接使用 Gemini SDK。
- 既有 prompt 文本、template/source/logo/mask 的角色說明、client JPEG resizing/crop、canvas post-processing 必須保留。
- 本次不加入 cancellation UI、NDJSON progress UI、multi-provider text generation、Wokey 或 `pi-ai` 改動。

## 前置條件

1. 在 AI Studio 下載 app ZIP 作 rollback backup。
2. 確認 Server Secrets 已有：
   - `GEMINI_API_KEY`
   - `KIE_API_KEY`
   - `TOAPIS_API_KEY`
3. 在 `package.json` 的 `dependencies` 加入固定 release artifact：

```json
{
  "@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.1.0/hk01-pi-ai-extra-google-0.1.0.tgz",
  "@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.1.0/hk01-pi-ai-extra-kie-0.1.0.tgz",
  "@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.1.0/hk01-pi-ai-extra-toapis-0.1.0.tgz"
}
```

只從 package **main entry** import image helper。不要在這次 migration 使用 `/pi-ai` subpath，也不要改 package 內部。

## Target architecture

```text
existing text selector
  └─ direct Gemini title/article routes (unchanged)

new image selector
  └─ provider-grouped app model ID
      └─ server/providers/imageClient.ts
          ├─ generateGoogleImage()
          ├─ generateKieImage()
          └─ generateToapisImage()
              └─ selected provider/model only
```

`imageClient.ts` 是 app 唯一直接呼叫 image packages 的位置。它負責：

- app model ID → provider-native model operation mapping；
- 將 app ratio preset 映射為 model 支援的最近 ratio；
- 從 `process.env` 讀取 selected provider key；
- 依 mode 建立有順序的 reference images；
- 將 `PiAiExtraError` 轉為 UI-ready details；
- log provider-reported `taskId` 和 `usage`。

它不得做 provider/model/upload fallback、reference slicing、host loop 或 image-generation retry。

## Image model selector

建立 app-owned catalogue；不要將 provider-native model id 直接散落在 React component 或 server route。每個 app entry 至少包括：

| Provider group | UI app model ID | Package model / operation | reference max |
| --- | --- | --- | ---: |
| Google | `google-gemini-3.1-flash-image` | `gemini-3.1-flash-image` | 14 |
| Google | `google-gemini-3-pro-image` | `gemini-3-pro-image` | 14 |
| KIE | `kie-grok-imagine-2` | text: `grok-imagine-image-2-0/text-to-image`; refs: `grok-imagine-image-2-0/image-edit` | 5 for edit |
| KIE | `kie-gpt-image-2` | text: `gpt-image-2-text-to-image`; refs: `gpt-image-2-image-to-image` | 16 for edit |
| KIE | `kie-nano-banana-2` | `nano-banana-2` | 14 |
| ToAPIs | `toapis-gemini-3.1-flash-image` | `gemini-3.1-flash-image-preview` | 6 |
| ToAPIs | `toapis-gpt-image-2` | `gpt-image-2` | 6 |
| ToAPIs | `toapis-gpt-image-2.5-flare` | `gpt-image-2.5-flare` | provider validates |
| ToAPIs | `toapis-gpt-image-2.5-sunburst` | `gpt-image-2.5-sunburst` | provider validates |
| ToAPIs | `toapis-seedream-5-pro` | `doubao-seedream-5-0-pro` | 10 |

React UI 使用 `<optgroup>` 顯示 Google、KIE、ToAPIs。當目前 request 的 reference image 數超過 model documented max，該 `<option>` 必須 disabled 並標示原因；server image client 仍必須讓 package 再次驗證。

## Image request construction

### Collage

保持現有 prompt composition，reference image 順序固定：

```text
style template → source image 1…N → brand logo（如有）
```

將同一順序傳入 `referenceImages`。不可以 upload fail 後 drop image，或為符合 limit 自行 slice。

### Edit

保持現有 mask prompt 和角色標籤，reference image 順序固定：

```text
base image → mask（如有）→ extra reference（如有）
```

Mask 以 reference image 處理；selected image model 必須收到這個順序。所有 edit model 均以此 best-effort reference contract 執行，不做 Gemini fallback。

## Ratio、quality 與 output

image client 用 package model catalogue 的 `aspectRatio`／`resolution` option；app preset 不被 provider 支援時，選最接近支援 ratio。保留既有 client JPEG resizing、crop 和 target output dimension 行為，特別是廣告 ratio 如 `300x250`。

quality 只在 model 支援時傳入；例如 Seedream 只支援 1K/2K。不要向 package 傳 unsupported key 或 arbitrary metadata。

## Key boundary

- 所有 provider key 只可在 Express server `process.env` 讀取。
- Browser request body 不得包含 key、`baseUrl` 或 custom headers。
- 移除 `vite.config.ts` 的 `GEMINI_API_KEY` / `API_KEY` browser define 注入。
- 前端可向 server 查詢 provider 可用狀態，但只可得到 boolean，不可得到 key、key prefix 或 provider response body。

## Error UX

新增固定但不顯眼的 error panel：

- 正常時隱藏。
- provider error 時自動展開，顯示 `provider`、`model`、`code`、`status`、`taskId`、`message`。
- 有「複製錯誤資訊」、「收起」、「關閉」操作。
- 關閉後不影響操作；下一次 error 自動重新顯示。
- 不可將 provider error 改寫成 generic toast 或自動 retry。

`PiAiExtraError` 已提供 provider/model/code/status/taskId/providerCode；server 將其安全序列化後回傳。不要把 key、request headers 或完整 provider response body 回傳 browser。

## Required removals

從 collage 和 edit server path 移除：

- `new GoogleGenAI(...).models.generateContent(...)` image calls；
- Pro/Flash/Lite fallback list；
- 每個 fallback 的 catch-and-continue；
- image response inlineData parsing；
- direct image upload/poll/download logic；
- client-side image-generation retry；
- Vite client key injection。

保留 direct Gemini SDK 的文字／article routes。

## Validation checklist

1. 文字 selector 和 title/article generation 行為維持原樣。
2. Image selector 有 Google、KIE、ToAPIs 三個 group；選擇改變後只影響 image path。
3. 每個 enabled model 跑 collage：template + 1 source；template + 多 source + logo。
4. Edit 跑 base image、base + mask、base + mask + extra reference，確認 reference 順序不被改寫。
5. 使用超過 5 張 references 選 KIE Grok edit：UI disabled 或 server 回 `reference_limit`，不能少圖後繼續。
6. 故意使用 invalid KIE/ToAPIs key：error panel 顯示 provider/model/code，並可複製。
7. provider error 後確認沒有第二個 image task 或另一個 provider request。
8. browser bundle 搜尋不到 `GEMINI_API_KEY`、`KIE_API_KEY`、`TOAPIS_API_KEY`。
9. 既有 OG JPEG resize/crop output 與 article/title pipeline regression 正常。

## Rollback

以遷移前下載的 AI Studio ZIP 還原整個 app。package upgrade / rollback 則只改回已發佈 GitHub Release artifact URL，再重新 install/build；不要刪除已被 app 使用的 release asset。
