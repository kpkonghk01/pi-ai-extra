# GPT-Image-2 Image Generation

> Generate images with gpt-image-2, supporting text-to-image and reference_images based image generation

**API:** POST https://toapis.com/v1/images/generations

**Note:**

**Note for users in mainland China:** Please use `https://toapis.cn` as the API endpoint (Base URL). Replace `https://toapis.com` with `https://toapis.cn` in the examples in this document.

- Unified image generation API
- Select the `gpt-image-2` model via the `model` parameter
- Supports text-to-image, single-reference, and multi-reference image generation
- Async task management with task ID based result lookup

**Warning:**

**Important Change**: For better performance and cost control, base64 image data is no longer supported in `image_urls` or `reference_images`. Please use the [Upload Image API](/docs/en/api-reference/uploads/images) first to upload images and obtain a URL.

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

Default: "gpt-image-2"

Image generation model name

Example: `"gpt-image-2"`

**prompt (string, required)**

Text prompt for image generation

Maximum 32,000 characters for GPT image models

**size (string)**

Default: "1:1"

Output image aspect ratio

Currently supported ratios:

`1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `5:4`, `4:5`, `16:9`, `9:16`, `2:1`, `1:2`, `21:9`, `9:21`

You can pass `auto` to let the upstream provider choose the dimensions, but the final aspect ratio and pixel dimensions are not guaranteed.

**resolution (string)**

Default: "1k"

Output resolution tier

Supported values: `1k`, `2k`, `4k`

**background (string)**

Optional background setting. Set `"transparent"` to generate an image with a transparent background. Omit this field for normal image generation.

Works with both text-to-image requests and requests containing `reference_images`. For normal generation, omit the field instead of sending `auto` or `opaque`.

In Playground, select `gpt-image-2` and switch Background from Normal to Transparent. Switching back to Normal removes `background` from the request.

### Size Reference

| size | 1k | 2k | 4k |
| --- | --- | --- | --- |
| `1:1` | `1024x1024` | `2048x2048` | `2880x2880` |
| `3:2` | `1536x1024` | `2048x1360` | `3520x2336` |
| `2:3` | `1024x1536` | `1360x2048` | `2336x3520` |
| `4:3` | `1024x768` | `2048x1536` | `3312x2480` |
| `3:4` | `768x1024` | `1536x2048` | `2480x3312` |
| `5:4` | `1280x1024` | `2560x2048` | `3216x2576` |
| `4:5` | `1024x1280` | `2048x2560` | `2576x3216` |
| `16:9` | `1536x864` | `2048x1152` | `3840x2160` |
| `9:16` | `864x1536` | `1152x2048` | `2160x3840` |
| `2:1` | `2048x1024` | `2688x1344` | `3840x1920` |
| `1:2` | `1024x2048` | `1344x2688` | `1920x3840` |
| `21:9` | `2016x864` | `2688x1152` | `3840x1648` |
| `9:21` | `864x2016` | `1152x2688` | `1648x3840` |

**n (integer)**

Default: 1

Number of images to generate

Default: 1

**response_format (string)**

Default: "url"

Response format

The API returns image URLs, so `url` is the recommended value

**reference_images (string[])**

Reference image URLs for image-to-image generation

**⚠️ URL format only (base64 no longer supported)**

- Publicly accessible URLs (`http://` or `https://`)
- You can use the [Upload Image API](/docs/en/api-reference/uploads/images) to upload local files and get URLs
- Supports single-image and multi-image reference
- Maximum 14 images

**image_urls (string[])**

Backward-compatible reference image field

ToAPIs automatically normalizes it to `reference_images`

## Response

**id (string)**

Unique task identifier for status queries

**object (string)**

Object type, always `generation.task`

**model (string)**

Model name used

**status (string)**

Task status
- `queued`
- `in_progress`
- `completed`
- `failed`

**progress (integer)**

Task progress percentage (0-100)

**created_at (integer)**

Task creation timestamp (Unix timestamp)

## Request Examples

```bash cURL
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2",
    "prompt": "Generate a futuristic city night poster with neon lighting and cinematic composition",
    "n": 1,
    "size": "1:1",
    "resolution": "1k",
    "response_format": "url"
  }'
```

```bash cURL (Image-to-Image)
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2",
    "prompt": "保留主体结构，把画面改成赛博朋克风格，增强光影和细节",
    "n": 1,
    "size": "1:1",
    "resolution": "1k",
    "image_urls": [
      "https://example.com/source.png",
       "https://example.com/source.png",
      "https://example.com/source.png"
    ],
    "response_format": "url"
  }'
```

```javascript JavaScript
const response = await fetch('https://toapis.com/v1/images/generations', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-ToAPIs-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-image-2',
    prompt: 'Generate a futuristic city night poster with neon lighting and cinematic composition',
    n: 1,
    size: '1:1',
    resolution: '1k',
    response_format: 'url'
  })
});

const task = await response.json();
console.log(task.id, task.status);
```
```bash cURL (Transparent background)
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gpt-image-2",
    "prompt": "Generate a cute cat sticker with a transparent background",
    "n": 1,
    "size": "1:1",
    "resolution": "1k",
    "background": "transparent",
    "response_format": "url"
  }'
```


## Response Examples

```json 200
{
  "id": "task_img_abc123def456",
  "object": "generation.task",
  "model": "gpt-image-2",
  "status": "queued",
  "progress": 0,
  "created_at": 1703884800,
  "metadata": {}
}
```

