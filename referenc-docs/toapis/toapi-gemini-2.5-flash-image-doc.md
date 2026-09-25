> ## Documentation Index
> Fetch the complete documentation index at: https://docs.toapis.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Gemini-2.5-Flash Image Generation

> Generate images using Google Gemini 2.5 Flash model, fast and efficient

<Note>
  **Note for users in mainland China:** Please use `https://toapis.cn` as the API endpoint (Base URL). Replace `https://toapis.com` with `https://toapis.cn` in the examples in this document.
</Note>

* Google Gemini 2.5 Flash efficient image generation model (Nano banana)
* Use model parameter to select `gemini-2.5-flash-image-preview` model
* Supports text-to-image generation
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

<ParamField body="model" type="string" default="gemini-2.5-flash-image-preview" required>
  Image generation model name

  Model alias: `nano-banana`

  Example: `"gemini-2.5-flash-image-preview"`
</ParamField>

<ParamField body="prompt" type="string" required>
  Text description for image generation

  Maximum 1000 characters
</ParamField>

<ParamField body="size" type="string">
  Image size ratio

  Supported formats:

  | Value  | Description        | Pixels (Reference) |
  | ------ | ------------------ | ------------------ |
  | `1:1`  | Square             | 1024x1024          |
  | `16:9` | Landscape wide     | 1792x1024          |
  | `9:16` | Portrait tall      | 1024x1792          |
  | `4:3`  | Landscape standard | 1365x1024          |
  | `3:4`  | Portrait standard  | 1024x1365          |
  | `3:2`  | Landscape photo    | 1536x1024          |
  | `2:3`  | Portrait photo     | 1024x1536          |
</ParamField>

<ParamField body="n" type="integer" default={1}>
  Number of images to generate

  Fixed at 1

  **⚠️ Note:** Must be a pure number (e.g. `1`), do not add quotes, otherwise it will error
</ParamField>

<ParamField body="image_urls" type="object[]">
  List of reference image URLs for image-to-image or image editing

  <Expandable title="Detailed field description">
    <ParamField body="url" type="string" required>
      Image URL address

      **⚠️ URL format only (base64 no longer supported)**

      * Publicly accessible image URL (http\:// or https\://)
      * Example: `https://example.com/image.jpg`
      * You can use the [Upload Image API](../../uploads/images) to upload local images and get URLs

      **Limitations:**

      * Single image must not exceed 10MB
      * Supported formats: .jpeg, .jpg, .png, .webp
    </ParamField>
  </Expandable>

  **Limit:** Maximum 14 images
</ParamField>

<ParamField body="metadata" type="object">
  Metadata parameters for passing additional configuration options

  <Expandable title="Supported metadata fields">
    <ParamField body="resolution" type="string" default="1K">
      Output image resolution

      Supported values:

      * `1K` - 1K resolution (default, only supported option)
    </ParamField>

    <ParamField body="orientation" type="string">
      Image orientation

      Supported values:

      * `landscape` - Landscape
      * `portrait` - Portrait
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

<RequestExample>
  ```bash cURL theme={null}
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

  ```bash cURL (Image-to-Image) theme={null}
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

  ```python Python theme={null}
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

  ```python Python (Image-to-Image) theme={null}
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

  ```javascript JavaScript theme={null}
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

  ```javascript JavaScript (Image-to-Image) theme={null}
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
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
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
</ResponseExample>
