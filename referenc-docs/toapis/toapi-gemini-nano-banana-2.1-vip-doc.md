> ## Documentation Index
> Fetch the complete documentation index at: https://docs.toapis.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Gemini Nano Banana 2.1 图像生成

> Gemini Nano Banana 2.1 普通版和 VIP 共用图片生成接口, 支持最多 14 张参考图和 1K, 2K, 4K 分辨率.

> [!NOTE]
>
> **中国大陆用户请注意:** 请使用 `https://toapis.cn` 作为 Base URL. 将以下示例中的 `https://toapis.com` 替换为 `https://toapis.cn`.

## 模型选择

| 版本 | Model ID |
| - | - |
| 普通版 | `gemini-nano-banana-2.1` |
| VIP | `gemini-nano-banana-2.1-vip` |

两个模型使用相同的接口和请求参数, 仅通过 `model` 字段切换. 支持文生图和图生图. 请求异步执行, 提交成功后通过任务 ID 查询结果.

> [!WARNING]
>
> `image_urls` 只接收公开可访问的图片 URL, 不接收 base64 数据. 请先使用 [上传图片接口](https://docs.toapis.com/docs/cn/api-reference/uploads/images.md) 上传本地图片并获取 URL.

## 认证

**Authorization** `string` *required*

所有请求均需要 Bearer Token. 请在 [API Key 管理页面](https://toapis.com/console/token) 获取 API Key.

```text theme={null}
Authorization: Bearer YOUR_API_KEY
```

## 请求参数

**model** `string` *required* (default: gemini-nano-banana-2.1)

模型名称. 使用 `gemini-nano-banana-2.1` 或 `gemini-nano-banana-2.1-vip`.

**prompt** `string` *required*

图像生成或编辑的文本描述.

**size** `string`

输出图像的宽高比. 支持以下值:

* `1:1`
* `3:2`, `2:3`
* `4:3`, `3:4`
* `16:9`, `9:16`
* `5:4`, `4:5`
* `21:9`
* `1:4`, `4:1`
* `1:8`, `8:1`

**n** `integer` (default: 1)

输出数量固定为数字 `1`, 不要使用字符串 `"1"`.

**image\_urls** `string[]`

参考图片 URL 字符串数组, 用于图生图或图像编辑. 最多 14 张图片, 每个 URL 必须公开可访问. 参考图数量不代表输出图片数量.

单张图片不超过 10MB. 支持 .jpeg, .jpg, .png, .webp.

```json theme={null}
["https://example.com/photo.jpg"]
```

**metadata** `object`

额外配置参数.

**metadata**

**resolution** `string` (default: 1K)

输出图像分辨率. 支持 `1K`, `2K`, `4K`, 默认 `1K`. 请使用大写 `K`.

**grounding** `string` (default: none)

Google 搜索 Grounding。开启后模型先检索再生成，结果中的 `grounding_metadata` 可能包含引用来源。
仅 VIP 版本（`gemini-nano-banana-2.1-vip`）支持该参数。

可选值：

* `none` - 关闭（默认）
* `web` - 网页搜索
* `image` - 图片搜索
* `web_image` - 网页 + 图片搜索

按实际执行的搜索查询次数计费，\$0.014/次。提交时预扣至多 4 次查询押金，未使用部分在结算时退回。

## 响应字段

**id** `string`

任务 ID, 用于查询任务状态和结果.

**object** `string`

固定为 `generation.task`.

**model** `string`

请求中使用的模型 ID.

**status** `string`

任务状态: `queued`, `in_progress`, `completed`, `failed`.

**progress** `integer`

任务进度百分比, 范围为 0-100.

**created\_at** `integer`

任务创建时间, Unix 时间戳, 单位为秒.

**metadata** `object`

任务元数据.

```bash cURL theme={null}
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

```bash cURL (VIP 图生图) theme={null}
curl --request POST \
  --url https://toapis.com/v1/images/generations \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
  "model": "gemini-nano-banana-2.1-vip",
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

```python Python theme={null}
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

```javascript JavaScript theme={null}
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

```json 200 theme={null}
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

提交响应中的 `id` 是任务 ID. 使用 [图片任务查询接口](https://docs.toapis.com/docs/cn/api-reference/tasks/image-status.md) 获取任务状态和最终图片. 异步通知请参考 [Webhook 回调](https://docs.toapis.com/docs/cn/api-reference/webhooks/task-webhooks.md).


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.