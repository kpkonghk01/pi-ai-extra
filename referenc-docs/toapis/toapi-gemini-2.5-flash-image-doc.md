# Gemini-2.5-Flash Image Generation

> Generate images using Google Gemini 2.5 Flash model, fast and efficient

**API:** POST https://toapis.com/v1/images/generations

**Note:**

**Note for users in mainland China:** Please use `https://toapis.cn` as the API endpoint (Base URL). Replace `https://toapis.com` with `https://toapis.cn` in the examples in this document.

- Google Gemini 2.5 Flash efficient image generation model
- Use model parameter to select `gemini-2.5-flash-image-preview` model
- Supports text-to-image generation
- Async task management, query results by task ID

**Warning:**

**Important Change**: For better performance and cost control, we no longer support passing base64 image data directly in `image_urls`. Please use the [Upload Image API](/docs/en/api-reference/uploads/images) first to upload images and get URLs, then call this endpoint.

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

Default: "gemini-2.5-flash-image-preview"

Image generation model name

Example: `"gemini-2.5-flash-image-preview"`

**prompt (string, required)**

Text description for image generation

Maximum 1000 characters

**size (string)**

Image size ratio

Supported formats:
| Value | Description | Pixels (Reference) |
|---|---|---|
| `1:1` | Square | 1024x1024 |
| `16:9` | Landscape wide | 1792x1024 |
| `9:16` | Portrait tall | 1024x1792 |
| `4:3` | Landscape standard | 1365x1024 |
| `3:4` | Portrait standard | 1024x1365 |
| `3:2` | Landscape photo | 1536x1024 |
| `2:3` | Portrait photo | 1024x1536 |

**n (integer)**

Default: 1

Number of images to generate

Fixed at 1

**⚠️ Note:** Must be a pure number (e.g. `1`), do not add quotes, otherwise it will error

**image_urls (object[])**

List of reference image URLs for image-to-image or image editing

**Detailed field description**

**url (string, required)**

Image URL address

**⚠️ URL format only (base64 no longer supported)**

- Publicly accessible image URL (http:// or https://)
- Example: `https://example.com/image.jpg`
- You can use the [Upload Image API](/docs/en/api-reference/uploads/images) to upload local images and get URLs

**Limitations:**
- Single image must not exceed 10MB
- Supported formats: .jpeg, .jpg, .png, .webp

**Limit:** Maximum 14 images

**metadata (object)**

Metadata parameters for passing additional configuration options

**Supported metadata fields**

**resolution (string)**

Default: "1K"

Output image resolution

Supported values:
- `1K` - 1K resolution (default, only supported option)

**orientation (string)**

Image orientation

Supported values:
- `landscape` - Landscape
- `portrait` - Portrait

## Response

**id (string)**

Unique task identifier for status queries

**object (string)**

Object type, always `generation.task`

**model (string)**

Model name used

**status (string)**

Task status
- `queued` - Queued for processing
- `in_progress` - Processing
- `completed` - Successfully completed
- `failed` - Failed

**progress (integer)**

Task progress percentage (0-100)

**created_at (integer)**

Task creation timestamp (Unix timestamp)

**metadata (object)**

Task metadata

## Request Examples

```bash cURL
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gemini-2.5-flash-image-preview",
    "prompt": "A cat in a spacesuit walking on the moon",
    "size": "1:1",
    "n": 1
  }'
```

```bash cURL (Image-to-Image)
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gemini-2.5-flash-image-preview",
    "prompt": "Transform this cat into cartoon style",
    "size": "1:1",
    "n": 1,
    "image_urls": ["https://example.com/cat.jpg"]
  }'
```

```python Python
import requests

response = requests.post(
    "https://toapis.com/v1/images/generations",
    headers={
        "Authorization": "Bearer your-ToAPIs-key",
        "Content-Type": "application/json"
    },
    json={
        "model": "gemini-2.5-flash-image-preview",
        "prompt": "A cat in a spacesuit walking on the moon",
        "size": "1:1",
        "n": 1
    }
)

task = response.json()
print(f"Task ID: {task['id']}")
print(f"Status: {task['status']}")
```

```python Python (Image-to-Image)
import requests

response = requests.post(
    "https://toapis.com/v1/images/generations",
    headers={
        "Authorization": "Bearer your-ToAPIs-key",
        "Content-Type": "application/json"
    },
    json={
        "model": "gemini-2.5-flash-image-preview",
        "prompt": "Transform this cat into cartoon style",
        "size": "1:1",
        "n": 1,
        "image_urls": ["https://example.com/cat.jpg"]
    }
)

task = response.json()
print(f"Task ID: {task['id']}")
print(f"Status: {task['status']}")
```

```javascript JavaScript
const response = await fetch('https://toapis.com/v1/images/generations', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-ToAPIs-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gemini-2.5-flash-image-preview',
    prompt: 'A cat in a spacesuit walking on the moon',
    size: '1:1',
    n: 1
  })
});

const task = await response.json();
console.log(`Task ID: ${task.id}`);
console.log(`Status: ${task.status}`);
```

```javascript JavaScript (Image-to-Image)
const response = await fetch('https://toapis.com/v1/images/generations', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-ToAPIs-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gemini-2.5-flash-image-preview',
    prompt: 'Transform this cat into cartoon style',
    size: '1:1',
    n: 1,
    image_urls: ['https://example.com/cat.jpg']
  })
});

const task = await response.json();
console.log(`Task ID: ${task.id}`);
console.log(`Status: ${task.status}`);
```


## Response Examples

```json 200
{
  "id": "task_img_abc123def456",
  "object": "generation.task",
  "model": "gemini-2.5-flash-image-preview",
  "status": "queued",
  "progress": 0,
  "created_at": 1703884800,
  "metadata": {}
}
```

