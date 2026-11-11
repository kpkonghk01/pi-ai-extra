# ToAPIs: image model prices (GPT Image 2.5 / 2.6, Seedream 5.5)

> Fetched 2026-11-11 16:11 HKT. ToAPIs' API reference pages do not carry current prices (the GPT Image 2.5 page still shows its 2026-09-09 prices), so these come from the pricing catalogue and the model guides. Values are copied as published; USD per generated image. 200 credits are USD 1.

## Pricing catalogue

Source: the model entries embedded in https://toapis.com/pricing. `quota_type` 1 bills per request; `model_price` is USD per request at the lowest tier.

| `model_name` | `quota_type` | `model_price` | `enable_groups` |
| --- | --- | --- | --- |
| `gpt-image-2.5-flare` | 1 | 0.0225 | default, vip, svip |
| `gpt-image-2.5-sunburst` | 1 | 0.0225 | default, vip, svip |
| `gpt-image-2.6-flare` | 1 | 0.018 | default, svip, vip |
| `gpt-image-2.6-sunburst` | 1 | 0.018 | svip, vip, default |
| `doubao-seedream-5-5` | 1 | 0.016 | svip, default, vip |

## Per-resolution prices in the model guides

| Model | USD per image | Source |
| --- | --- | --- |
| `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst` | 1K 0.0225 / 2K 0.03 / 4K 0.0375 | https://toapis.com/model-guide/gpt-image-2-5 (`heroPricing`) |
| `gpt-image-2.6-flare` | 1K 0.018 / 2K 0.024 / 4K 0.03 | https://toapis.com/model-guide/gpt-image-2-6-flare (`heroPricing`) |
| `gpt-image-2.6-sunburst` | 1K 0.018 / 2K 0.024 / 4K 0.03 | https://toapis.com/model-guide/gpt-image-2-6-sunburst (`heroPricing`) |
| `doubao-seedream-5-5` | 1K / 1.5K 0.016 / 2K 0.028 | https://toapis.com/model-guide/doubao-seedream-5-5 (`pricing.rows`) |

The Seedream 5.5 guide also says: "Pricing is per generated image at 20% below the official list price: $0.016 per image for 1K and 1.5K outputs (official $0.02) and $0.028 per image at 2K (official $0.035)."

The GPT Image 2.6 guides also embed an older `rows` table (1K 0.015 / 2K 0.02 / 4K 0.025, the same values as the GPT Image 2.5 reference page's 2026-09-09 prices). It is not shown on the page and disagrees with the catalogue's `model_price` of 0.018; the requests of 2026-11-11 were billed 0.018 at 1K, so the `heroPricing` tiers above are the current ones.
