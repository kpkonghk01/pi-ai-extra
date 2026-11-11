# Part 1 of 2: upgrade the KIE and ToAPIs packages and add the new image models to the policy

You are editing this Google AI Studio app. Its server already generates images through the image kit package (`@hk01/pi-ai-extra-image-kit`) and three provider packages: `@hk01/pi-ai-extra-google`, `@hk01/pi-ai-extra-kie` and `@hk01/pi-ai-extra-toapis`.

New versions of the KIE and ToAPIs packages add four image model families. Once the new versions are installed, the image kit offers them in the model menu by itself:

| Model key | Model |
| --- | --- |
| `toapis:gpt-image-2.6-flare` | GPT Image 2.6 Flare, on ToAPIs |
| `toapis:gpt-image-2.6-sunburst` | GPT Image 2.6 Sunburst, on ToAPIs |
| `toapis:doubao-seedream-5-5` | Seedream 5.5, on ToAPIs |
| `kie:seedream-5-5` | Seedream 5.5, on KIE |

This part upgrades the two packages, gives the four new models their labels and prices in the catalogue policy, and updates the GPT Image 2.5 prices. Part 2, a separate prompt, handles other code that names models.

The image kit refuses to start if the policy names a model key that the installed packages do not have ("references unknown model family"). So do Step 1 and Step 2 together, before you run the app.

## Rules

1. **Change only what the steps say.** Keep every prompt text, system instruction, label of other models, layout and styling exactly as it is.
2. **No fallback and no retry.** Do not add an alternative model or provider anywhere.
3. **Do not edit history.** Do not edit Markdown files (`*.md`), and do not edit anything inside a folder whose name contains `migration` (for example `pi-ai-migration/` or `pi-ai-extra-migration/`).
4. **Do not change the URLs of `@hk01/pi-ai-extra-image-kit` and `@hk01/pi-ai-extra-google`.** They stay at their current versions.
5. **Do not change the app's default image model.**
6. If something does not fit these steps, do not guess. Describe it in your final report.

## Step 1: upgrade the KIE and ToAPIs packages

Open `package.json`. Replace **every** URL of these two packages, wherever it appears (`dependencies`, and also `overrides`, `resolutions` or any other section), with these exact URLs:

| Package | New URL |
| --- | --- |
| `@hk01/pi-ai-extra-kie` | `https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.8.0/hk01-pi-ai-extra-kie-0.8.0.tgz` |
| `@hk01/pi-ai-extra-toapis` | `https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.7.0/hk01-pi-ai-extra-toapis-0.7.0.tgz` |

Then run `npm install` so that `package-lock.json` is updated.

## Step 2: update the catalogue policy

Find the file that calls `createImageClient` (usually `server/imageModels.ts`). It defines a `CataloguePolicy` with an `overrides` object, and maybe `scopes`.

**2a. Update the GPT Image 2.5 prices.** In the `'toapis:gpt-image-2.5-flare'` and `'toapis:gpt-image-2.5-sunburst'` entries, wherever they appear (also inside `scopes`), replace the `price` line and its comment with:

```ts
      // ToAPIs pricing (2026-11-11): $0.0225 / $0.03 / $0.0375 per 1K / 2K / 4K image.
      price: { perImageUsd: { '1K': 0.0225, '2K': 0.03, '4K': 0.0375 }, inputPerMillionTokensUsd: 0 },
```

If an entry has no `price`, do not add one.

**2b. Choose the labels.** Look at the labels this app already gives two entries in the top-level `overrides`, and name the new models the same way:

| New entry | Label | Example |
| --- | --- | --- |
| `'toapis:gpt-image-2.6-flare'` | the label of `'toapis:gpt-image-2.5-flare'`, with `2.5` changed to `2.6` | `'GPT Image 2.5 Flare (ToAPIs)'` → `'GPT Image 2.6 Flare (ToAPIs)'` |
| `'toapis:gpt-image-2.6-sunburst'` | the label of `'toapis:gpt-image-2.5-sunburst'`, with `2.5` changed to `2.6` | `'GPT Image 2.5 Sunburst (ToAPIs)'` → `'GPT Image 2.6 Sunburst (ToAPIs)'` |
| `'toapis:doubao-seedream-5-5'` | the label of `'toapis:doubao-seedream-5-0-pro'`, with `5.0 Pro` changed to `5.5` | `'Doubao Seedream 5.0 Pro (ToAPIs)'` → `'Doubao Seedream 5.5 (ToAPIs)'` |
| `'kie:seedream-5-5'` | the label you chose for `'toapis:doubao-seedream-5-5'`, with `(ToAPIs)` changed to `(KIE)` | `'Doubao Seedream 5.5 (ToAPIs)'` → `'Doubao Seedream 5.5 (KIE)'` |

If the entry that a label comes from is missing or has no `label`, use `'GPT Image 2.6 Flare (ToAPIs)'`, `'GPT Image 2.6 Sunburst (ToAPIs)'`, `'Seedream 5.5 (ToAPIs)'` and `'Seedream 5.5 (KIE)'`.

**2c. Choose `maskEditing`.** The two GPT Image 2.6 entries take the `maskEditing` value of `'toapis:gpt-image-2.5-flare'`. The two Seedream 5.5 entries take the `maskEditing` value of `'toapis:doubao-seedream-5-0-pro'`. If that entry has no `maskEditing`, leave the `maskEditing` line out of the new entries.

**2d. Add the four entries** to the top-level `overrides` object: the two GPT Image 2.6 entries right after `'toapis:gpt-image-2.5-sunburst'`, the ToAPIs Seedream 5.5 entry right after `'toapis:doubao-seedream-5-0-pro'`, and the KIE entry after the last `'kie:…'` entry. If one of those anchors is missing, add the entry at the end of `overrides`. Use the labels from 2b and the `maskEditing` values from 2c in place of the ones below; keep the descriptions, comments and prices exactly as written:

```ts
    'toapis:gpt-image-2.6-flare': {
      label: 'GPT Image 2.6 Flare (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.6 Flare，速度較快。',
      maskEditing: 'reference-only',
      // ToAPIs pricing (2026-11-11): $0.018 / $0.024 / $0.03 per 1K / 2K / 4K image; reference images are not billed.
      price: { perImageUsd: { '1K': 0.018, '2K': 0.024, '4K': 0.03 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:gpt-image-2.6-sunburst': {
      label: 'GPT Image 2.6 Sunburst (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.6 Sunburst，適合精細編輯和複雜指示。',
      maskEditing: 'reference-only',
      // ToAPIs pricing (2026-11-11): $0.018 / $0.024 / $0.03 per 1K / 2K / 4K image; reference images are not billed.
      price: { perImageUsd: { '1K': 0.018, '2K': 0.024, '4K': 0.03 }, inputPerMillionTokensUsd: 0 },
    },
```

```ts
    'toapis:doubao-seedream-5-5': {
      label: 'Seedream 5.5 (ToAPIs)',
      description: 'ToAPIs 提供的 ByteDance Seedream 5.5，最高 2K。',
      maskEditing: 'reference-only',
      // ToAPIs pricing (2026-11-11): $0.016 / $0.028 per 1K / 2K image; reference images are not billed.
      price: { perImageUsd: { '1K': 0.016, '2K': 0.028 }, inputPerMillionTokensUsd: 0 },
    },
```

```ts
    'kie:seedream-5-5': {
      label: 'Seedream 5.5 (KIE)',
      description: 'KIE 提供的 ByteDance Seedream 5.5，最高 2K；每張參考圖另收 US$0.0072。',
      maskEditing: 'reference-only',
      // KIE model pricing (2026-11-11): 3.6 / 6.3 credits ($0.018 / $0.0315) per 1K / 2K image.
      // Each reference image costs 1.44 credits ($0.0072) more; this estimate leaves that out.
      price: { perImageUsd: { '1K': 0.018, '2K': 0.0315 }, inputPerMillionTokensUsd: 0 },
    },
```

Do not add any of the four keys to an `exclude` list, and do not add them to `scopes`.

## Step 3: check and report

1. Run `npm run lint`. It must pass.
2. In your final report, list:
   - each `package.json` line you changed;
   - each policy entry you changed or added, with the label and `maskEditing` you chose and the entry you took them from;
   - anything that did not fit these steps.

Stop after the report. Part 2 follows as a separate prompt.
