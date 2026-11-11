# Part 2 of 2: update the code that names image models outside the policy

You are still editing the same Google AI Studio app. In Part 1 you upgraded `@hk01/pi-ai-extra-kie` and `@hk01/pi-ai-extra-toapis` and added four image models to the catalogue policy:

| Model key | Label you chose in Part 1 |
| --- | --- |
| `toapis:gpt-image-2.6-flare` | (for example `GPT Image 2.6 Flare (ToAPIs)`) |
| `toapis:gpt-image-2.6-sunburst` | (for example `GPT Image 2.6 Sunburst (ToAPIs)`) |
| `toapis:doubao-seedream-5-5` | (for example `Seedream 5.5 (ToAPIs)`) |
| `kie:seedream-5-5` | (for example `Seedream 5.5 (KIE)`) |

Some apps also name image models in code outside the policy: conditions that change the prompt for one model, price calculations, or tables of display names. This part makes the new models take the same path as the models they sit beside: GPT Image 2.6 follows GPT Image 2.5, and Seedream 5.5, on ToAPIs and on KIE, follows Seedream 5.0 Pro.

## Rules

1. **Change only what the steps say.** Do not change any prompt wording: change only conditions, lists, tables and prices, and add only the lines Step 3 gives.
2. **No fallback and no retry.** Do not add an alternative model or provider anywhere.
3. **Do not edit history.** Do not edit Markdown files (`*.md`), and do not edit anything inside a folder whose name contains `migration`.
4. **Do not change** `package.json`, the catalogue policy you edited in Part 1, or the app's default image model.
5. If something does not fit these steps, do not guess. Describe it in your final report.

## Step 1: find the code

Search all `.ts` and `.tsx` files for these texts. Skip `node_modules`, `dist`, `*.md`, every folder whose name contains `migration`, and the policy file from Part 1:

- `gpt-image-2.5`
- `seedream` and `doubao` (in any letter case)

## Step 2: handle each match

Handle each match by what the code does with it:

| What the code does | What to do |
| --- | --- |
| A condition that chooses behaviour for GPT Image 2.5, such as `appModelId.includes('gpt-image-2.5')` or a comparison with `'toapis:gpt-image-2.5-flare'` | Make GPT Image 2.6 take the same branch by extending the same condition (example below the table). Change nothing inside the branch. |
| A condition that chooses behaviour for Seedream with `doubao`, such as `appModelId.includes('doubao')` | Leave it for Step 3. |
| A condition that matches `seedream` without a provider, such as `id.includes('seedream')` | Change nothing, and list it in your report: it now also matches `kie:seedream-5-5`. |
| A price or cost calculation by model ID, outside the policy | Change the GPT Image 2.5 Flare / Sunburst prices to 0.0225 USD (1K), 0.03 USD (2K) and 0.0375 USD (4K). Then add the new models, in the same style as the other branches (same exchange rate, rounding and return type): GPT Image 2.6 Flare and Sunburst 0.018 / 0.024 / 0.03 USD; `toapis:doubao-seedream-5-5` 0.016 / 0.028 USD; `kie:seedream-5-5` 0.018 / 0.0315 USD, plus 0.0072 USD for each input image if the function already receives the number of input images. Use the 4K price only where the code already handles 4K; do not widen the app's resolution types. |
| A table that turns a model ID into a display name | Keep every existing entry. Add the four new model keys with the labels from Part 1. |
| A default model ID | Do not change it. |
| A TypeScript type or list that names every model the app offers | Add the four new keys. |
| A comment | Leave it. |

Example of an extended GPT Image 2.5 condition:

```ts
// Before
if (appModelId.includes('gpt-image-2.5')) {
// After
if (appModelId.includes('gpt-image-2.5') || appModelId.includes('gpt-image-2.6')) {
```

Then open `.env.example`, if the app has one. Where a comment lists the ToAPIs image models, add `GPT Image 2.6` and `Seedream 5.5` to the list; where a comment lists the KIE image models, add `Seedream 5.5`. If the ToAPIs list still says `Nano Banana 2 Preview`, change it to `Nano Banana 2.1`. Change nothing else in that file.

## Step 3: the Seedream prompt branch

Do this step only if the app has the file `server/imagePrompts.ts` and its ToAPIs part has a branch `} else if (appModelId.includes('doubao')) {`. Otherwise skip it and say so in your report.

That branch writes a short Seedream prompt, because ByteDance recommends Seedream prompts of at most 300 Chinese characters or 600 English words. `toapis:doubao-seedream-5-5` already takes it. Make `kie:seedream-5-5` take it too, in both functions below. Each "find" text must appear exactly once in its function; if it does not, stop and report instead of guessing.

**3a. In `buildGenerationParts`:**

1. Find the line `const provider = model?.provider ?? (appModelId.split(':')[0] as any) ?? 'google';` and add these two lines right after it:

   ```ts
     // Seedream on any provider takes the short Seedream prompt (ByteDance: at most 300 Chinese characters or 600 English words).
     const isSeedream = appModelId.includes('seedream');
   ```

2. Replace `if (provider === 'kie') {` with `if (provider === 'kie' && !isSeedream) {`.
3. Replace `if (provider === 'toapis') {` with `if (provider === 'toapis' || isSeedream) {`.
4. Replace `} else if (appModelId.includes('doubao')) {` with `} else if (isSeedream) {`.

**3b. In `buildEditParts`:**

1. Find the line `const provider = model?.provider ?? (appModelId.split(':')[0] as any) ?? 'google';` and add the same two lines right after it.
2. Replace `if (provider === 'toapis') {` with `if (provider === 'toapis' || isSeedream) {`.
3. Replace `} else if (appModelId.includes('doubao')) {` with `} else if (isSeedream) {`.

Change nothing else in these functions: the prompt texts and the order of the images stay as they are.

## Step 4: check and report

1. Run `npm run lint`. It must pass.
2. In your final report, list every match from Step 1, with its file and line, and what you did with it (changed, or left unchanged and why), and anything that did not fit these steps.
