# Gemini Nano Banana 2.1 图像生成

> 使用 Gemini Nano Banana 2.1 生成和编辑图片, 支持最多 14 张参考图及 1K, 2K, 4K 分辨率.

**API:** POST https://toapis.com/v1/images/generations

**Note:**

**中国大陆用户请注意:** 请使用 `https://toapis.cn` 作为 Base URL. 将以下示例中的 `https://toapis.com` 替换为 `https://toapis.cn`.

## 模型选择

| 版本 | Model ID |
| --- | --- |
| 普通版 | `gemini-nano-banana-2.1` |

支持文生图和图生图. 请求以异步任务执行, 提交成功后使用返回的任务 ID 查询结果.

**Warning:**

`image_urls` 只接收公开可访问的图片 URL, 不接收 base64 数据. 请先使用 [上传图片接口](/docs/zh/api-reference/uploads/images) 上传本地图片并获取 URL.

## 认证

**Authorization (string, required)**

所有请求均需要 Bearer Token. 请在 [API Key 管理页面](https://toapis.com/console/token) 获取 API Key.

  ```text
  Authorization: Bearer YOUR_API_KEY
  ```


## 请求参数

**model (string, required)**

Default: "gemini-nano-banana-2.1"

填写 `gemini-nano-banana-2.1`.

**prompt (string, required)**

图像生成或编辑的文本描述.

**size (string)**

输出图像的宽高比. 支持以下值:

- `1:1`
- `3:2`, `2:3`
- `4:3`, `3:4`
- `16:9`, `9:16`
- `5:4`, `4:5`
- `21:9`
- `1:4`, `4:1`
- `1:8`, `8:1`

**n (integer)**

Default: 1

输出数量固定为数字 `1`, 不要使用字符串 `"1"`.

**image_urls (string[])**

参考图片 URL 字符串数组, 用于图生图或图像编辑. 最多 14 张图片, 每个 URL 必须公开可访问. 参考图数量不代表输出图片数量.

单张图片不超过 10MB. 支持 .jpeg, .jpg, .png, .webp.

  ```json
  ["https://example.com/photo.jpg"]
  ```


**metadata (object)**

额外配置参数.

**metadata**

**resolution (string)**

Default: "1K"

输出图像分辨率. 支持 `1K`, `2K`, `4K`, 默认 `1K`. 请使用大写 `K`.

## 响应字段

**id (string)**

任务 ID, 用于查询任务状态和结果.

**object (string)**

固定为 `generation.task`.

**model (string)**

请求中使用的模型 ID.

**status (string)**

任务状态: `queued`, `in_progress`, `completed`, `failed`.

**progress (integer)**

任务进度百分比, 范围为 0-100.

**created_at (integer)**

任务创建时间, Unix 时间戳, 单位为秒.

**metadata (object)**

任务元数据.

## Request Examples

```bash cURL
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
  "model": "gemini-nano-banana-2.1",
  "prompt": "赛博朋克风格的城市夜景, 霓虹灯闪烁",
  "size": "16:9",
  "n": 1,
  "metadata": {
    "resolution": "2K"
  }
}'
```

```bash cURL (图生图)
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
  "model": "gemini-nano-banana-2.1",
  "prompt": "将这张照片改为水彩画风格",
  "size": "1:1",
  "n": 1,
  "image_urls": [
    "https://example.com/photo.jpg"
  ],
  "metadata": {
    "resolution": "2K"
  }
}'
```

```python Python
import requests

response = requests.post(
    "https://toapis.com/v1/images/generations",
    headers={
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json"
    },
    json={
        "model": "gemini-nano-banana-2.1",
        "prompt": "赛博朋克风格的城市夜景, 霓虹灯闪烁",
        "size": "16:9",
        "n": 1,
        "metadata": {
            "resolution": "2K"
        }
    }
)
response.raise_for_status()
task = response.json()
print(task["id"])
```

```javascript JavaScript
const response = await fetch('https://toapis.com/v1/images/generations', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    "model": "gemini-nano-banana-2.1",
    "prompt": "赛博朋克风格的城市夜景, 霓虹灯闪烁",
    "size": "16:9",
    "n": 1,
    "metadata": {
      "resolution": "2K"
    }
  })
});

if (!response.ok) {
  throw new Error(await response.text());
}
const task = await response.json();
console.log(task.id);
```


## Response Examples

```json 200
{
  "id": "task_img_abc123def456",
  "object": "generation.task",
  "model": "gemini-nano-banana-2.1",
  "status": "queued",
  "progress": 0,
  "created_at": 1703884800,
  "metadata": {}
}
```


## 查询结果

提交响应中的 `id` 是任务 ID. 使用 [图片任务查询接口](/docs/zh/api-reference/tasks/image-status) 获取任务状态和最终图片. 异步通知请参考 [Webhook 回调](/docs/zh/api-reference/webhooks/task-webhooks).
