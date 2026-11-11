# Seedream-5.5 Image Generation

> Generate and edit images with Seedream 5.5, including 1K/1.5K/2K, transparent PNG, and layer decomposition

**API:** POST https://toapis.com/v1/images/generations

**Note:**

**Note for users in mainland China:** Please use `https://toapis.cn` as the API endpoint (Base URL). Replace `https://toapis.com` with `https://toapis.cn` in the examples in this document.

Use `doubao-seedream-5-5` for text-to-image generation, reference-guided editing, or layer decomposition. Submissions return a task ID; query the task to retrieve its results.

Ordinary generation returns one image. Layer decomposition returns a base image and layers.

## Authorizations

**Authorization (string, required)**

All endpoints require Bearer Token authentication

Get your API Key from the [API Key Management Page](https://toapis.com/console/token)

Add to request header:
  ```
  Authorization: Bearer YOUR_API_KEY
  ```


## Body

**model (string, required)**

Default: "doubao-seedream-5-5"

Image generation model name

Example: `"doubao-seedream-5-5"`

**prompt (string)**

Text description, required for ordinary generation and editing. With `layer_decomposition` enabled, omit it to let the model identify elements automatically.

**size (string)**

Accepts `1K`, `1.5K`, `2K` resolution tiers, or explicit pixels such as `2048x2048`. Tiers do not fix the aspect ratio; explicit sizes for ordinary generation must total 921600-4624220 pixels. Ordinary generation uses the model's configured default resolution, or `2K` if none is configured. Layer decomposition defaults to `auto` when size is omitted. Examples explicitly use `2K`, which is not the layer-mode default.

Layer decomposition accepts only `auto`, `1K`, `1.5K`, or `2K`, preserves the input aspect ratio, and does not accept explicit pixel dimensions. Explicit dimensions for ordinary generation must have a width-to-height ratio between 1/16 and 16.

**n (integer)**

Default: "1"

Use `1` or omit it for one ordinary output image. This is not the layer count; omit it or use `1` for layer decomposition as well.

**image_urls (string[])**

Reference image URLs for image editing or multiple-image references.

- Up to 10 reference images.
- Use publicly accessible HTTP/HTTPS URLs; inline base64 data is not supported.
- Upload local images through the [image upload API](/docs/en/api-reference/uploads/images) first.
- The `reference_images` and `images` array fields are also supported.
- Each reference image must be at most 30 MB. Layer decomposition accepts JPEG or PNG references only.

**image (string)**

A URL string for one reference image. For multiple images, use `image_urls`; do not put an array in `image`.

**layer_decomposition (boolean)**

Default: false

For ordinary text-to-image and image editing, omit this parameter or set it to `false`. Enabling it without a reference image or with multiple reference images makes the request invalid.

Set `true` to decompose exactly one reference image. You may omit `prompt`; omit sequential generation parameters. Results include a base image and transparent PNG layers with `z_index`, placement information, and names.

**layer_decomposition_options (object)**

Use only with `layer_decomposition=true`. `max_images` is an integer from 2 to 100, defaults to `30`, and caps the total number of outputs including the base image. The model determines the actual count, which may be lower. `text_recognition` is a boolean that defaults to `false`. You can also pass this object as `metadata.layer_decomposition_options`.

**optimize_prompt_options (object)**

Prompt optimization options. Use `{"mode": "standard"}`. Seedream 5.5 rejects `fast`.

**metadata (object)**

Channel-specific parameters for advanced Seedream 5.5 model configuration

**metadata properties**

**output_format (string)**

Default: "png"

Accepts `png` or `jpeg`, defaulting to `png`. Transparency requires PNG and rejects JPEG. In layer mode, this controls only the base image; other layers are always transparent PNG.

**background (string)**

When `layer_decomposition=true`, omit `background` entirely, including an explicit `opaque` value. This parameter is only supported for ordinary image generation and editing.

Accepts `auto`, `opaque`, or `transparent`. A transparent background cannot be combined with `output_format=jpeg`. With `transparent` and no format, PNG is selected.

When omitted for ordinary generation, defaults to `auto`; the model determines transparency from the prompt and output format. JPEG output is always opaque.

**watermark (boolean)**

Default: false

Controls the visible `AI generated` watermark. Set `false` to disable it or `true` to enable it. This does not imply removal of provenance metadata or invisible markers.

**response_format (string)**

Default: "url"

This page uses `url` mode. Retrieve image URLs from the asynchronous task result.

## Parameter limitations

Ordinary multi-image generation is not supported. Omit `sequential_image_generation` and `sequential_image_generation_options`; even `disabled` is rejected upstream. `stream=true` is not supported; omit `stream` or use `false`. The current API does not support `tools` web-search parameters or `seed`.

## Query the task

A successful submission does not mean generation is complete. Query with the same API Key. Status may be `pending`, `queued`, `in_progress`, `completed`, or `failed`. Read `result.data` on completion, or `error` on failure.

```bash
curl "https://toapis.com/v1/images/generations/TASK_ID" \
  -H "Authorization: Bearer $TOAPIS_API_KEY"
```

## Response

**id (string)**

Unique task identifier for status queries

**object (string)**

Object type, always `generation.task`

**model (string)**

Model name used

**status (string)**

Task status
- `pending`, `queued` - Queued for processing
- `in_progress` - Processing
- `completed` - Successfully completed
- `failed` - Failed

**progress (integer)**

Task progress percentage (0-100)

**created_at (integer)**

Task creation timestamp (Unix timestamp)

**metadata (object)**

Task metadata

**result.data (array)**

Completed image list: one item for ordinary generation, multiple items for layer decomposition.

**result.data[] (object)**

Image URL, actual pixel dimensions, and output format.

**result.data[].z_index (integer)**

Layer stacking order. `0` is the base image; other layers may also include `bounding_box`, `name`, and `description`.

**result.data[].background (string)**

Actual background type, when supplied by the provider: `opaque` or `transparent`. In layer mode, the base is `opaque` and other layers are `transparent`. Omitted for older tasks or models that do not supply it.

**result.data[].text_recognition (object)**

Text recognition result for this layer, included when supplied by the provider. This field may be absent even when `text_recognition` is enabled.

The object contains full `text` and a `lines` array. Each line includes `bounding_box` and `runs`; `runs[].style` preserves the provider's font, color, and other style information.

Set the `TOAPIS_API_KEY` environment variable before running these examples. Replace the `example.com` reference placeholders with accessible image URLs.

## Request Examples

```bash Transparent PNG
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
  "model": "doubao-seedream-5-5",
  "prompt": "A red toy sailboat and a small yellow sun, isolated objects, no text.",
  "size": "2K",
  "metadata": {
    "output_format": "png",
    "background": "transparent",
    "watermark": false,
    "response_format": "url"
  }
}'
```

```bash Reference-guided editing
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
  "model": "doubao-seedream-5-5",
  "prompt": "Combine the subjects from both references into one product illustration.",
  "size": "2K",
  "image_urls": [
    "https://example.com/reference-front.png",
    "https://example.com/reference-side.jpg"
  ],
  "metadata": {
    "output_format": "png",
    "watermark": false,
    "response_format": "url"
  }
}'
```

```bash Layer decomposition
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header "Authorization: Bearer $TOAPIS_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
  "model": "doubao-seedream-5-5",
  "image": "https://example.com/composition.png",
  "layer_decomposition": true,
  "layer_decomposition_options": {"max_images": 30, "text_recognition": true},
  "size": "2K",
  "metadata": {
    "output_format": "png",
    "watermark": false,
    "response_format": "url"
  }
}'
```


## Response Examples

```json 200 Submission accepted
{
  "id": "tsk_img_example",
  "object": "generation.task",
  "model": "doubao-seedream-5-5",
  "status": "pending",
  "progress": 0,
  "created_at": 1794300000,
  "metadata": {}
}
```

```json 200 Ordinary generation completed
{
  "id": "tsk_img_example",
  "object": "generation.task",
  "model": "doubao-seedream-5-5",
  "status": "completed",
  "progress": 100,
  "created_at": 1794300000,
  "metadata": {},
  "result": {
    "type": "image",
    "data": [
      {
        "url": "https://files.toapis.com/images/example/seedream-5-5.png",
        "size": "2512x1680",
        "output_format": "png"
      }
    ]
  }
}
```

