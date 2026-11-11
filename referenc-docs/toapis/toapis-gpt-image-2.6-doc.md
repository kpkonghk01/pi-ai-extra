# GPT-Image-2.6 Image Generation

> Access guide for the standard gpt-image-2.6-flare and gpt-image-2.6-sunburst tiers, including async tasks, fixed high quality, reference images, GIF and SVG output, and resolution-based pricing

**API:** POST https://api.toapis.com/v1/images/generations

The standard tier creates an image task through `POST /v1/images/generations` and returns a task ID. After the task finishes, retrieve the image URL through the status endpoint. Both models use the same request format:

| Model | `model` in the request |
| --- | --- |
| Flare | `gpt-image-2.6-flare` |
| Sunburst | `gpt-image-2.6-sunburst` |

`gpt-image-2.6` is the series name. Always pass the full model name from the table.

**Note:**

**Note for users in mainland China:** Please use `https://api.toapis.cn` as the API endpoint (Base URL). Replace `https://api.toapis.com` with `https://api.toapis.cn` in the examples in this document.

Create an API Key in the [console](https://toapis.com/dashboard).

## Quick Start

Set your ToAPIs API Key as the `TOAPIS_API_KEY` environment variable, then submit the task:

```bash
curl --fail-with-body --request POST \
  --url https://api.toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2.6-flare",
    "prompt": "Children's picture book style, a veterinarian listening to a baby otter's heartbeat with a stethoscope",
    "quality": "high",
    "size": "1:1",
    "resolution": "1K",
    "n": 1
  }'
```

Example submit response:

```json
{
  "id": "tsk_img_example",
  "object": "generation.task",
  "model": "gpt-image-2.6-flare",
  "status": "pending",
  "progress": 0,
  "created_at": 1788951900,
  "metadata": {}
}
```

Save the returned `id`, replace `TASK_ID` below with that value, and query the result:

```bash
curl --fail-with-body \
  --url https://api.toapis.com/v1/images/generations/TASK_ID \
  --header "Authorization: Bearer $TOAPIS_API_KEY"
```

A task moves through `pending`, `queued`, and `in_progress`, and finally reaches `completed` or `failed`. On `completed`, read the image URL from `result.data`; on `failed`, read `error`. Poll every few seconds. The full set of fields is documented in [Image Task Status](/docs/en/api-reference/tasks/image-status).

A successful submit only means the task was created. Wait until `completed` before downloading the image, and keep polling the same task ID while you wait.

## Request Parameters

**Authorization (string, required)**

Authenticate with `Bearer YOUR_TOAPIS_API_KEY`.

**model (string, required)**

`gpt-image-2.6-flare` or `gpt-image-2.6-sunburst`.

**prompt (string, required)**

Description of the image. When you use reference images, describe the subject to keep and the content to change.

**quality (string)**

Default: "high"

Always uses `high`. This field is optional; other string values such as `medium` are ignored and generation still uses `high`. Standard-tier pricing depends on `resolution`, not `quality`.

**size (string)**

Default: "1:1"

Aspect ratio, for example `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `5:4`, `4:5`, `16:9`, `9:16`, `21:9`.

We recommend setting `size` to an aspect ratio and passing `resolution` explicitly. The service uses both values to calculate the output dimensions in pixels.

You can pass `auto` to let the upstream provider choose the dimensions, but the final aspect ratio and pixel dimensions are not guaranteed.

**resolution (string)**

Default: "1K"

Resolution tier. `1K`, `2K`, and `4K` are supported, and lowercase values are also accepted. This field determines the pricing tier for the standard tier.

**n (integer)**

Default: 1

Use `1` per request to generate one image.

**background (string)**

Optional background setting. Set `"transparent"` to generate an image with a transparent background. Omit this field for normal image generation.

Works with both text-to-image requests and requests containing `reference_images`.

**output_format (string)**

Output format: `png`, `jpeg`, `webp`, `gif`, or `svg`. Uses the upstream default when omitted. See the GIF and SVG sections for their extra parameters and restrictions.

**frame_count (integer)**

Default: 9

GIF only. Number of frames, from `2` to `64`. Text-to-GIF honors this value; image-to-GIF output is always rendered with `9` frames.

**frame_duration_ms (integer)**

Default: 200

GIF only. Per-frame duration in milliseconds, from `20` to `2000` in steps of `10`.

**reference_images (string[])**

Optional list of reference image URLs, up to 10 images. The images must be reachable by the server. Only image URLs are supported: local file uploads and base64 images are not accepted. For local images, obtain a URL first through the [Upload Image API](/docs/en/api-reference/uploads/images).

`image_urls` is also accepted. Use one of the two fields.

Combined with `"output_format": "gif"`, reference images produce image-to-GIF output.

## Transparent Background

Add `"background": "transparent"` to the generation request to get an image with a transparent background. Omit the field for normal generation.

```bash
curl --fail-with-body --request POST \
  --url https://api.toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2.6-flare",
    "prompt": "A red circular sticker on a transparent background",
    "quality": "high",
    "size": "1:1",
    "resolution": "1K",
    "background": "transparent",
    "n": 1
  }'
```

The task is queried by task ID as usual; read the image URL from `result.data`.

## GIF output

Set `output_format` to `gif` to generate an animation. `frame_count` sets the frame count (`2` to `64`, default `9`) and `frame_duration_ms` sets the per-frame duration (`20` to `2000` milliseconds in steps of `10`, default `200`).

```bash
curl --fail-with-body --request POST \
  --url https://api.toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2.6-flare",
    "prompt": "A paper airplane looping across a blue sky, flat illustration",
    "output_format": "gif",
    "frame_count": 8,
    "frame_duration_ms": 200,
    "size": "1:1",
    "n": 1
  }'
```

### Image-to-GIF

Add `reference_images` to animate an existing image. Image-to-GIF output is always rendered with `9` frames; `frame_count` is ignored in this mode, while `frame_duration_ms` still applies.

```bash
curl --fail-with-body --request POST \
  --url https://api.toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2.6-flare",
    "prompt": "Animate the scene with gentle motion",
    "reference_images": ["https://example.com/scene.png"],
    "output_format": "gif",
    "frame_duration_ms": 200,
    "n": 1
  }'
```

## SVG output

Set `output_format` to `svg` to generate vector graphics. No additional fields are required.

```bash
curl --fail-with-body --request POST \
  --url https://api.toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2.6-flare",
    "prompt": "A minimalist mountain logo, flat vector style",
    "output_format": "svg",
    "n": 1
  }'
```

## Ratio and Resolution Examples

| size | 1K | 2K | 4K |
| --- | --- | --- | --- |
| `1:1` | `1024x1024` | `2048x2048` | `2880x2880` |
| `3:2` | `1536x1024` | `2048x1360` | `3520x2336` |
| `2:3` | `1024x1536` | `1360x2048` | `2336x3520` |
| `16:9` | `1536x864` | `2048x1152` | `3840x2160` |
| `9:16` | `864x1536` | `1152x2048` | `2160x3840` |

`4K` is a resolution tier; the actual width and height depend on the aspect ratio. A square 4K output, for example, is `2880x2880`.

## Generation with Reference Images

Use the same generation endpoint and add `reference_images`, up to 10 images. The example below uses Sunburst and still returns an async task:

```bash
curl --fail-with-body --request POST \
  --url https://api.toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2.6-sunburst",
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

The standard tier bills per generated image, and the `resolution` tier determines the price tier. GIF and SVG output are billed at the same per-image rate. Reference image input currently has no additional per-image fee. Account-specific pricing or discounts may differ; check the [model pricing page](https://toapis.com/pricing) and your account configuration for the latest prices.

## Related models

The [GPT-Image-2.6 Official](/docs/en/api-reference/images/gpt-image-2.6-official/generation) edition runs on the official channel with six quality tiers, custom pixel sizes, markup-guided editing, and token-based billing. Use the `-official` suffix model names for that channel.
