# Upgrade the image provider packages: Nano Banana 2 → Nano Banana 2.1

You are editing this Google AI Studio app. Its server already generates images through the image kit package (`@hk01/pi-ai-extra-image-kit`) and three provider packages: `@hk01/pi-ai-extra-google`, `@hk01/pi-ai-extra-kie` and `@hk01/pi-ai-extra-toapis`.

The providers are retiring their Nano Banana 2 image models. New versions of the three provider packages remove them and add Nano Banana 2.1:

| Removed model key | Replacement model key |
| --- | --- |
| `google:gemini-3.1-flash-image` | `google:gemini-nano-banana-2.1` (already in the app) |
| `toapis:gemini-3.1-flash-image-preview` | `toapis:gemini-nano-banana-2.1` (new) |
| `kie:nano-banana-2` | `kie:nano-banana-2-1` (new) |

After the upgrade, the image kit refuses to start if the app's catalogue policy still names a removed key ("references unknown model family"). So the package upgrade (Step 1) and the policy change (Step 2) must both be done before you run the app.

## Rules

1. **Change only what the steps say.** Keep every prompt text, system instruction, label of other models, layout and styling exactly as it is.
2. **No fallback and no retry.** Do not add an alternative model or provider anywhere.
3. **Do not edit history.** Do not edit Markdown files (`*.md`), and do not edit anything inside a folder whose name contains `migration` (for example `pi-ai-migration/` or `pi-ai-extra-migration/`). They hold notes and code snapshots from earlier migrations.
4. **Do not change the image kit URL** (`@hk01/pi-ai-extra-image-kit`). It stays at its current version.
5. Watch out when you search: `gemini-nano-banana-2.1` and `nano-banana-2-1` contain the text `nano-banana-2`. They are the new models. Never change them.
6. Some apps also use `'nano-banana-2'` as the **name of a prompt wording profile**, not as a model ID. For example, Auto OG has `type PromptProfile = 'nano-banana-2' | 'default'` in `server/imageModels.ts` and compares with `"nano-banana-2"` in `server.ts`. Leave these profile names unchanged.
7. If something does not fit these steps, do not guess. Describe it in your final report.

## Step 1: upgrade the three provider packages

Open `package.json`. Replace **every** URL of the three provider packages, wherever it appears (`dependencies`, and also `overrides` or any other section), with these exact URLs:

| Package | New URL |
| --- | --- |
| `@hk01/pi-ai-extra-google` | `https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.7.0/hk01-pi-ai-extra-google-0.7.0.tgz` |
| `@hk01/pi-ai-extra-kie` | `https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.6.0/hk01-pi-ai-extra-kie-0.6.0.tgz` |
| `@hk01/pi-ai-extra-toapis` | `https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.6.0/hk01-pi-ai-extra-toapis-0.6.0.tgz` |

Then run `npm install` so that `package-lock.json` is updated.

## Step 2: update the catalogue policy

Find the file that calls `createImageClient` (usually `server/imageModels.ts`). It defines a `CataloguePolicy` with `overrides`, and maybe `exclude` lists and `scopes`.

**2a.** Delete the whole `'google:gemini-3.1-flash-image'` entry from `overrides`.

**2b.** Replace the whole `'toapis:gemini-3.1-flash-image-preview'` entry (key and value) with:

```ts
    'toapis:gemini-nano-banana-2.1': {
      label: 'Nano Banana 2.1 (ToAPIs)',
      description: 'ToAPIs 提供的 Gemini Nano Banana 2.1。',
      maskEditing: 'supported',
      // ToAPIs pricing API (2026-10-30): $0.015 per request at every resolution.
      price: { perImageUsd: { '1K': 0.015, '2K': 0.015, '4K': 0.015 }, inputPerMillionTokensUsd: 0 },
    },
```

**2c.** Replace the whole `'kie:nano-banana-2'` entry (key and value) with:

```ts
    'kie:nano-banana-2-1': {
      label: 'Nano Banana 2.1 (KIE)',
      description: 'KIE 提供的 Nano Banana 2.1。',
      maskEditing: 'supported',
      // kie.ai/pricing (2026-10-30): 4 / 6 / 9 credits per image.
      price: { perImageUsd: { '1K': 0.02, '2K': 0.03, '4K': 0.045 }, inputPerMillionTokensUsd: 0 },
    },
```

**2d.** In the `'google:gemini-nano-banana-2.1'` entry, keep `label`, `description` and `maskEditing`. Set its `price` (and its comment) to:

```ts
      // Google pricing page (2026-10-30): $0.0336 / $0.0504 / $0.113 per 1K / 2K / 4K image, input $1.50 / 1M tokens.
      price: { perImageUsd: { '1K': 0.0336, '2K': 0.0504, '4K': 0.113 }, inputPerMillionTokensUsd: 1.5 },
```

If the entry has no `price` at all, do not add one here. The app then prices models somewhere else, and Step 3 handles that.

**2e.** If any `exclude` list (in the policy or in a scope) names a removed key, replace it with its replacement key from the table at the top. For `google:gemini-3.1-flash-image`, just delete it from the list.

## Step 3: find every other use of the removed models

Search all `.ts` and `.tsx` files, and `.env.example`, for these texts. Skip `node_modules`, `dist`, `*.md` and every folder whose name contains `migration`:

- `gemini-3.1-flash-image` (this also finds `gemini-3.1-flash-image-preview`)
- `kie:nano-banana-2'` and `kie:nano-banana-2"`
- `'nano-banana-2'`, `"nano-banana-2"`, `'kie-nano-banana-2'` and `"kie-nano-banana-2"` (old model IDs from before the image kit)

Handle each match by what the code does with it:

| What the code does | What to do |
| --- | --- |
| A list, set or condition that changes behaviour by model, such as which models get special prompt wording | Replace each removed key with its replacement key. Do not add a key twice. Example: Auto OG's `NANO_BANANA_2_FAMILIES` must end up with exactly `'google:gemini-nano-banana-2.1'`, `'kie:nano-banana-2-1'` and `'toapis:gemini-nano-banana-2.1'`. |
| A table that only turns a stored model ID into a display name, for example for old history records | Keep the old entries, so that old records still show a name. Add `'toapis:gemini-nano-banana-2.1': 'Nano Banana 2.1 (ToAPIs)'` and `'kie:nano-banana-2-1': 'Nano Banana 2.1 (KIE)'` if they are missing. |
| A price or cost calculation by model ID, outside the policy | Delete the branch for the removed model. If this code also prices `google:gemini-nano-banana-2.1`, change its per-image prices to 0.0336 USD (1K), 0.0504 USD (2K) and 0.113 USD (4K); add 1.50 USD per 1M input tokens only if this code already prices input tokens. If this code prices other models by ID, also add the two new models with the per-image prices from Step 2b and 2c. Do not widen the app's own resolution types: use the 4K price only where the code already handles 4K. |
| A default model ID | If it is a removed key, change it to `'google:gemini-nano-banana-2.1'`. |
| A TypeScript type that lists model IDs | Replace each removed key with its replacement key. |
| A comment, or text in `.env.example` | Update the model name, for example "Nano Banana 2 (KIE)" → "Nano Banana 2.1 (KIE)". |

The model a user selected before is saved in their browser. You do not need to migrate it: when it is no longer in the list, the image kit's model selector switches back to the app's default model by itself.

## Step 4: check and report

1. Run `npm run lint`. It must pass.
2. Search again for the texts from Step 3. The only matches left may be in display-name tables for old records (Step 3, second row) and prompt profile names (Rule 6).
3. In your final report, list:
   - each `package.json` line you changed;
   - each policy entry you deleted, replaced or changed;
   - every match from Step 3, with its file and line, and what you did with it;
   - anything that did not fit these steps.
