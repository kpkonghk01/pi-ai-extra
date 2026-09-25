> ## Documentation Index
> Fetch the complete documentation index at: https://docs.toapis.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Seedream-5.0-Pro Image Generation

> Generate high-quality images using Seedream 5.0 Pro model with 1K/2K resolution

<Note>
  **Note for users in mainland China:** Please use `https://toapis.cn` as the API endpoint (Base URL). Replace `https://toapis.com` with `https://toapis.cn` in the examples in this document.
</Note>

* Seedream 5.0 Pro high-quality image generation model from ByteDance Seed team
* Use the model parameter to select `doubao-seedream-5-0-pro`
* Parameters are largely the same as `Seedream-5.0`, but Pro supports **1K** and **2K** resolutions
* Supports text-to-image, image-to-image, and multi-reference generation
* **Billing rule**: the first reference image is free; billing starts from the second reference image
* Async task management, query results by task ID

<Warning>
  **Important Change**: For better performance and cost control, we no longer support passing base64 image data directly in `image_urls`. Please use the [Upload Image API](../../uploads/images) first to upload images and get URLs, then call this endpoint.
</Warning>

## Authorizations

<ParamField header="Authorization" type="string" required>
  All endpoints require Bearer Token authentication

  Get your API Key from the [API Key Management Page](https://toapis.com/console/token)

  Add to request header:

  ```
  Authorization: Bearer YOUR_API_KEY
  ```
</ParamField>

## Body

<ParamField body="model" type="string" default="doubao-seedream-5-0-pro" required>
  Image generation model name

  Example: `"doubao-seedream-5-0-pro"`
</ParamField>

<ParamField body="prompt" type="string" required>
  Text description for image generation
</ParamField>

<ParamField body="size" type="string" default="1:1">
  Image aspect ratio

  When `layer_decomposition` is enabled, pass the `1K` or `2K` resolution preset directly in this field.

  Supported aspect ratios:

  * `1:1` - Square (default)
  * `4:3` - Landscape 4:3
  * `3:4` - Portrait 3:4
  * `16:9` - Landscape widescreen
  * `9:16` - Portrait vertical
  * `3:2` - Landscape 3:2
  * `2:3` - Portrait 2:3
  * `21:9` - Ultra-wide
  * `9:21` - Ultra-tall
</ParamField>

<ParamField body="n" type="integer" default={1}>
  Number of images to generate

  Range: 1-10 (minimum 1, maximum 10)

  Default: 1

  **Note:**

  * The total of reference images + generated images must be ≤ 15
  * **Must enter a plain number (e.g., `1`), do not use quotes or it will cause an error**

  Charges will be pre-deducted based on generated image count and reference image count, with the first reference image free
</ParamField>

<ParamField body="layer_decomposition" type="boolean" default={false}>
  Enables the layer decomposition capability available only in Seedream 5.0 Pro.

  * `false`: returns a regular flattened image (default)
  * `true`: returns a base image plus independent transparent PNG layers

  When enabled, each `result.data[]` item includes `z_index`; independent layers also include `bounding_box`, `name`, and `description`.
</ParamField>

<ParamField body="image_urls" type="string[]">
  Reference image URL list for image-to-image or image editing

  **⚠️ URL format only (base64 no longer supported)**

  * Publicly accessible image URL (http\:// or https\://)
  * You can use the [Upload Image API](../../uploads/images) to upload local images and get URLs

  **Limitations:**

  * Image count: 1-10
  * Image formats: jpeg, png
  * Aspect ratio (width/height) range: \[1/3, 3]
  * Width and height (px) > 14
  * Size: not exceeding 10MB
  * Total pixels: not exceeding 6000×6000 px

  **Billing notes:**

  * The first reference image is free
  * Billing applies from the second reference image onward
</ParamField>

<ParamField body="metadata" type="object">
  Channel-specific parameters for advanced Seedream 5.0 Pro model configuration

  <Expandable title="metadata properties">
    <ParamField body="metadata.resolution" type="string" default="2K">
      Image resolution

      Supported resolutions:

      * `1K` - Basic resolution
      * `2K` - Standard resolution (default)

      > **Note:** Seedream 5.0 Pro does not support 3K or 4K resolution; non-Pro Seedream 5.0 supports 2K and 3K
    </ParamField>

    <ParamField body="metadata.sequential_image_generation" type="string" default="disabled">
      Sequential image generation mode (Doubao-specific feature)

      Controls whether to generate multiple images:

      * `disabled`: Disable sequential mode, generates only 1 image even with multiple reference images (default)
      * `auto`: Enable sequential mode, can generate multiple images

      **Usage Notes:**

      * ✅ Set `n: 3` or use `sequential_image_generation: "auto"` + `max_images: 3`
      * ✅ Supports text-to-image sets: up to 10 images from text prompt only
      * ✅ Supports image-to-image sets: provide `image_urls` to generate multiple variations
      * ⚠️ When `n > 1`, it will automatically be set to `auto`

      **Note:**

      * Total reference images + generated images must be ≤ 15
    </ParamField>

    <ParamField body="metadata.sequential_image_generation_options" type="object">
      Sequential image generation options

      Available when `sequential_image_generation` is set to `auto`

      **Properties:**

      * `max_images` (integer): Specify the number of images to generate, Range: 1-10

      **Example:**

      ```json theme={null}
      "sequential_image_generation_options": { "max_images": 3 }
      ```
    </ParamField>

    <ParamField body="metadata.watermark" type="boolean" default={false}>
      Whether to add a watermark to the generated image

      * `true`: Add watermark
      * `false`: No watermark (default)
    </ParamField>
  </Expandable>
</ParamField>

## Response

<ResponseField name="id" type="string">
  Unique task identifier for status queries
</ResponseField>

<ResponseField name="object" type="string">
  Object type, always `generation.task`
</ResponseField>

<ResponseField name="model" type="string">
  Model name used
</ResponseField>

<ResponseField name="status" type="string">
  Task status

  * `queued` - Queued for processing
  * `in_progress` - Processing
  * `completed` - Successfully completed
  * `failed` - Failed
</ResponseField>

<ResponseField name="progress" type="integer">
  Task progress percentage (0-100)
</ResponseField>

<ResponseField name="created_at" type="integer">
  Task creation timestamp (Unix timestamp)
</ResponseField>

<ResponseField name="metadata" type="object">
  Task metadata
</ResponseField>

<ResponseField name="completed_at" type="integer">
  Task completion timestamp (Unix timestamp). Returned only after the task completes.
</ResponseField>

<ResponseField name="expires_at" type="integer">
  Result file expiration timestamp (Unix timestamp). Download or persist the files before they expire.
</ResponseField>

<ResponseField name="result" type="object">
  Generated result returned when `status` is `completed`.
</ResponseField>

<ResponseField name="result.type" type="string">
  Result type. Always `image` for image tasks.
</ResponseField>

<ResponseField name="result.data" type="array">
  Image result list. With layer decomposition enabled, the first item is normally the base image and the remaining items are independent transparent PNG layers.
</ResponseField>

<ResponseField name="result.data[].url" type="string">
  Public URL of the base image or independent layer.
</ResponseField>

<ResponseField name="result.data[].z_index" type="integer">
  Layer stacking order. With layer decomposition enabled, the base image is normally `0` and independent layers increase from there.
</ResponseField>

<ResponseField name="result.data[].size" type="string">
  Pixel dimensions of the base image or independent layer, for example `2048x2048`.
</ResponseField>

<ResponseField name="result.data[].output_format" type="string">
  File format of this result item. The base image can use the requested format; transparent independent layers use `png`.
</ResponseField>

<ResponseField name="result.data[].bounding_box" type="object">
  Layer position on the base image, with `absolute` and `normalized` coordinates.
</ResponseField>

<ResponseField name="result.data[].bounding_box.absolute" type="array">
  Absolute pixel coordinates on the base image in `[x1, y1, x2, y2]` order, representing the top-left and bottom-right corners.
</ResponseField>

<ResponseField name="result.data[].bounding_box.normalized" type="array">
  Normalized coordinates in `[x1, y1, x2, y2]` order, with values ranging from `0` to `1000`.
</ResponseField>

<ResponseField name="result.data[].name" type="string">
  Layer name.
</ResponseField>

<ResponseField name="result.data[].description" type="string">
  Description of the layer contents.
</ResponseField>

<RequestExample>
  ```bash cURL theme={null}
  curl --request POST \
    --url https://toapis.com/v1/images/generations \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "doubao-seedream-5-0-pro",
      "prompt": "A cute panda playing in a bamboo forest",
      "size": "1:1",
      "n": 1,
      "metadata": {
        "resolution": "2K"
      }
    }'
  ```

  ```bash cURL (Image-to-Image) theme={null}
  curl --request POST \
    --url https://toapis.com/v1/images/generations \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "doubao-seedream-5-0-pro",
      "prompt": "A cute panda playing in a bamboo forest",
      "size": "1:1",
      "n": 1,
      "image_urls": [
        "https://example.com/panda.jpg"
      ],
      "metadata": {
        "resolution": "1K"
      }
    }'
  ```

  ```bash cURL (Layer Decomposition) theme={null}
  curl --request POST \
    --url https://toapis.com/v1/images/generations \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "doubao-seedream-5-0-pro",
      "prompt": "Precisely separate the image into a base image and independent transparent PNG layers.",
      "image_urls": [
        "https://example.com/office-desk.png"
      ],
      "size": "2K",
      "n": 1,
      "layer_decomposition": true
    }'
  ```

  <Note>
    When `layer_decomposition` is enabled, set `size` directly to the `1K` or `2K` resolution preset. Do not use an explicit `WIDTHxHEIGHT` pixel size. After submission, query `GET /v1/images/generations/{task_id}` for the complete layer result.
  </Note>

  ```bash cURL (Batch Generation) theme={null}
  curl --request POST \
    --url https://toapis.com/v1/images/generations \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "doubao-seedream-5-0-pro",
      "prompt": "A cute panda playing in a bamboo forest",
      "size": "1:1",
      "n": 4,
      "metadata": {
        "resolution": "2K",
        "sequential_image_generation": "auto",
        "sequential_image_generation_options": { "max_images": 4 },
        "watermark": false
      }
    }'
  ```

  ```python Python theme={null}
  import requests

  response = requests.post(
      "https://toapis.com/v1/images/generations",
      headers={
          "Authorization": "Bearer your-ToAPIs-key",
          "Content-Type": "application/json"
      },
      json={
          "model": "doubao-seedream-5-0-pro",
          "prompt": "A cute panda playing in a bamboo forest",
          "size": "1:1",
          "n": 1,
          "metadata": {
              "resolution": "2K"
          }
      }
  )

  task = response.json()
  print(f"Task ID: {task['id']}")
  print(f"Status: {task['status']}")
  ```

  ```python Python (Image-to-Image) theme={null}
  import requests

  response = requests.post(
      "https://toapis.com/v1/images/generations",
      headers={
          "Authorization": "Bearer your-ToAPIs-key",
          "Content-Type": "application/json"
      },
      json={
          "model": "doubao-seedream-5-0-pro",
          "prompt": "A cute panda playing in a bamboo forest",
          "size": "1:1",
          "n": 1,
          "image_urls": ["https://example.com/panda.jpg"],
          "metadata": {
              "resolution": "1K"
          }
      }
  )

  task = response.json()
  print(f"Task ID: {task['id']}")
  print(f"Status: {task['status']}")
  ```

  ```javascript JavaScript theme={null}
  const response = await fetch('https://toapis.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer your-ToAPIs-key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'doubao-seedream-5-0-pro',
      prompt: 'A cute panda playing in a bamboo forest',
      size: '1:1',
      n: 1,
      metadata: {
        resolution: '2K'
      }
    })
  });

  const task = await response.json();
  console.log(`Task ID: ${task.id}`);
  console.log(`Status: ${task.status}`);
  ```

  ```javascript JavaScript (Image-to-Image) theme={null}
  const response = await fetch('https://toapis.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer your-ToAPIs-key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'doubao-seedream-5-0-pro',
      prompt: 'A cute panda playing in a bamboo forest',
      size: '1:1',
      n: 1,
      image_urls: ['https://example.com/panda.jpg'],
      metadata: {
        resolution: '1K'
      }
    })
  });

  const task = await response.json();
  console.log(`Task ID: ${task.id}`);
  console.log(`Status: ${task.status}`);
  ```
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
  {
    "id": "task_img_abc123def456",
    "object": "generation.task",
    "model": "doubao-seedream-5-0-pro",
    "status": "queued",
    "progress": 0,
    "created_at": 1703884800,
    "metadata": {}
  }
  ```

  ```json 200 Layer decomposition completed theme={null}
  {
    "completed_at": 1787128810,
    "created_at": 1787128650,
    "expires_at": 1787215210,
    "id": "tsk_img_example_layer_decomposition",
    "model": "doubao-seedream-5-0-pro",
    "object": "generation.task",
    "progress": 100,
    "result": {
      "type": "image",
      "data": [
        {
          "url": "https://files.toapis.com/images/example/base.jpg",
          "size": "1600x2848",
          "output_format": "jpeg",
          "z_index": 0
        },
        {
          "url": "https://files.toapis.com/images/example/layer-1.png",
          "size": "3040x955",
          "output_format": "png",
          "z_index": 1,
          "bounding_box": {
            "absolute": [0, 0, 1600, 503],
            "normalized": [0, 0, 999, 176]
          },
          "name": "Background office equipment",
          "description": "The monitor edge and file organizer extracted from the background"
        },
        {
          "url": "https://files.toapis.com/images/example/layer-2.png",
          "size": "1982x1162",
          "output_format": "png",
          "z_index": 2,
          "bounding_box": {
            "absolute": [800, 589, 1599, 1058],
            "normalized": [500, 207, 999, 371]
          },
          "name": "Stacked white papers",
          "description": "Several stacked white office papers extracted from the desk"
        }
      ]
    },
    "status": "completed"
  }
  ```
</ResponseExample>
