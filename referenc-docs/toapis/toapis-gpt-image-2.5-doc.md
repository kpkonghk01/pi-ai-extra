> ## Documentation Index
> Fetch the complete documentation index at: https://docs.toapis.com/llms.txt
> Use this file to discover all available pages before exploring further.

# GPT-Image-2.5 Image Generation

> Access guide for the standard gpt-image-2.5-flare and gpt-image-2.5-sunburst tiers, including async tasks, reference images, transparent backgrounds, fixed high quality, and resolution-based pricing

The standard tier creates an image task through `POST /v1/images/generations` and returns a task ID. After the task finishes, retrieve the image URL through the status endpoint. Both models use the same request format:

| Model    | `model` in the request   |
| -------- | ------------------------ |
| Flare    | `gpt-image-2.5-flare`    |
| Sunburst | `gpt-image-2.5-sunburst` |

`gpt-image-2.5` is the series name. Always pass the full model name from the table.

<Note>
  This page covers the standard tier. To pay by actual token usage, use the separate [GPT-Image-2.5 VIP documentation](../gpt-image-2.5-vip/generation). Both tiers run as async tasks; the main differences are the size format and the billing model.
</Note>

<Note>
  **Note for users in mainland China:** Please use `https://toapis.cn` as the API endpoint (Base URL). Replace `https://toapis.com` with `https://toapis.cn` in the examples in this document.
</Note>

Create an API Key in the [console](https://toapis.com/dashboard).

## Quick Start

Set your ToAPIs API Key as the `TOAPIS_API_KEY` environment variable, then submit the task:

```bash theme={null}
curl --fail-with-body --request POST \
  --url https://toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2.5-flare",
    "prompt": "Children's picture book style, a veterinarian listening to a baby otter's heartbeat with a stethoscope",
    "quality": "high",
    "size": "1:1",
    "resolution": "1K",
    "n": 1
  }'
```

Example submit response:

```json theme={null}
{
  "id": "tsk_img_example",
  "object": "generation.task",
  "model": "gpt-image-2.5-flare",
  "status": "pending",
  "progress": 0,
  "created_at": 1788951900,
  "metadata": {}
}
```

Save the returned `id`, replace `TASK_ID` below with that value, and query the result:

```bash theme={null}
curl --fail-with-body \
  --url https://toapis.com/v1/images/generations/TASK_ID \
  --header "Authorization: Bearer $TOAPIS_API_KEY"
```

A task moves through `pending`, `queued`, and `in_progress`, and finally reaches `completed` or `failed`. On `completed`, read the image URL from `result.data`; on `failed`, read `error`. Poll every few seconds. The full set of fields is documented in [Image Task Status](../../tasks/image-status).

A successful submit only means the task was created. Wait until `completed` before downloading the image, and keep polling the same task ID while you wait.

## Request Parameters

<ParamField header="Authorization" type="string" required>
  Authenticate with `Bearer YOUR_TOAPIS_API_KEY`.
</ParamField>

<ParamField body="model" type="string" required>
  `gpt-image-2.5-flare` or `gpt-image-2.5-sunburst`.
</ParamField>

<ParamField body="prompt" type="string" required>
  Description of the image. When you use reference images, describe the subject to keep and the content to change.
</ParamField>

<ParamField body="quality" type="string" default="high">
  The standard tier currently pins quality to `high`, so you can omit this parameter. Any other string value is ignored and `high` is used instead. The Playground does not expose a quality option.

  The standard tier is currently priced by resolution.
</ParamField>

<ParamField body="size" type="string" default="1:1">
  Aspect ratio, for example `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `5:4`, `4:5`, `16:9`, `9:16`, `21:9`.

  We recommend using a ratio and passing `resolution` explicitly. The service calculates the output pixel dimensions from both values. The standard tier uses ratios, while the VIP tier uses pixel dimensions.
</ParamField>

<ParamField body="resolution" type="string" default="1K">
  Resolution tier. `1K`, `2K`, and `4K` are supported, and lowercase values are also accepted. This field determines the pricing tier for the standard tier.
</ParamField>

<ParamField body="background" type="string">
  Optional background setting. Set `"transparent"` to generate an image with a transparent background. Omit this field for normal image generation.

  Works with both text-to-image requests and requests containing `reference_images`.
</ParamField>

<ParamField body="n" type="integer" default={1}>
  Use `1` per request to generate one image.
</ParamField>

<ParamField body="reference_images" type="string[]">
  Optional list of reference image URLs for image-to-image generation. The images must be reachable by the server. Only image URLs are supported: local file uploads and base64 images are not accepted. For local images, obtain a URL first through the [Upload Image API](../../uploads/images).

  `image_urls` is also accepted. Use one of the two fields.
</ParamField>

## Transparent Background

Add `"background": "transparent"` to the generation request to get an image with a transparent background. Omit the field for normal generation.

```bash theme={null}
curl --fail-with-body --request POST \
  --url https://toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2.5-flare",
    "prompt": "A red circular sticker on a transparent background",
    "quality": "high",
    "size": "1:1",
    "resolution": "1K",
    "background": "transparent",
    "n": 1
  }'
```

The task is queried by task ID as usual; read the image URL from `result.data`.

## Ratio and Resolution Examples

| size   | 1K          | 2K          | 4K          |
| ------ | ----------- | ----------- | ----------- |
| `1:1`  | `1024x1024` | `2048x2048` | `2880x2880` |
| `3:2`  | `1536x1024` | `2048x1360` | `3520x2336` |
| `2:3`  | `1024x1536` | `1360x2048` | `2336x3520` |
| `16:9` | `1536x864`  | `2048x1152` | `3840x2160` |
| `9:16` | `864x1536`  | `1152x2048` | `2160x3840` |

`4K` is a resolution tier; the actual width and height depend on the aspect ratio. A square 4K output, for example, is `2880x2880`.

## Generation with Reference Images

Use the same generation endpoint and add `reference_images`. The example below uses Sunburst and still returns an async task:

```bash theme={null}
curl --fail-with-body --request POST \
  --url https://toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2.5-sunburst",
    "prompt": "Keep the baby otter and the veterinarian from the reference image, and add a yellow scarf to the baby otter",
    "reference_images": ["https://example.com/otter.png"],
    "quality": "high",
    "size": "1:1",
    "resolution": "2K",
    "n": 1
  }'
```

Replace `https://example.com/otter.png` with your own reference image URL, then query the result with the returned task ID.

## Pricing

The prices below are standard prices verified on 2026-09-09, for one generated image per request. Both standard models cost the same:

| resolution | USD/image |
| ---------- | --------: |
| 1K         |     0.015 |
| 2K         |     0.020 |
| 4K         |     0.025 |

All three prices apply to `low`, `medium`, `high`, `xhigh`, and `max`. Reference image input currently has no additional per-image fee. Account-specific pricing or discounts may differ; check the [model pricing page](https://toapis.com/pricing) and your account configuration for the latest prices.

## Differences from the VIP Tier

| Item             | Standard                                        | VIP                                            |
| ---------------- | ----------------------------------------------- | ---------------------------------------------- |
| Model name       | Without `-vip`                                  | With `-vip`                                    |
| Task mode        | Async task; query by task ID for the image URL  | Async task; query by task ID for the image URL |
| size             | Ratio, such as `16:9`                           | Pixel dimensions, such as `1536x1024`          |
| resolution       | `1K`, `2K`, `4K`                                | Omitted; `size` expresses the dimensions       |
| Billing          | Per-image price for the resolution              | Actual text and image tokens                   |
| Reference images | Reference image URLs in the generation endpoint | Image file upload through the edits endpoint   |

When switching to VIP, change the model name and the parameters together. See [GPT-Image-2.5 VIP](../gpt-image-2.5-vip/generation) for details.
