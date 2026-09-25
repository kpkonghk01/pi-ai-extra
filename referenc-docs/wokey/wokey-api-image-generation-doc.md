Base URL: `https://api.wokey.ai`

# 图片生成 API (同步 JSON / 可选异步)

Path: `/images/generations`
请求支持自定义宽高比例，平台会先按请求 size 做合法性校验和额度预留，成功后按实际输出图片尺寸结算。

返回 data[0].b64_json；图生图使用 image 文件字段，异步模式返回任务 ID。

## 文生图

```sh
curl https://api.wokey.ai/v1/images/generations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2.5",
    "prompt": "A quiet lake at sunrise",
    "size": "1536x1024"
  }'
```

## 图生图

```sh
curl https://api.wokey.ai/v1/images/edits \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "model=gpt-image-2.5" \
  -F "prompt=Make the sky purple and add a cat" \
  -F "image=@input.png"
```

## 异步任务

```sh
curl https://api.wokey.ai/v1/images/generations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Prefer: respond-async" \
  -H "Idempotency-Key: image-demo-0001" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2.5",
    "prompt": "A quiet lake at sunrise"
  }'
```

## 请求参数

| 参数           | 是否必填 | 说明                                                                                                                                                                             |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| model          | 必填     | 当前只支持 gpt-image-2.5。                                                                                                                                                       |
| prompt         | 必填     | 图片提示词，不能为空。                                                                                                                                                           |
| size           | 可选     | 格式为 WIDTHxHEIGHT，支持非正方形比例；每边必须在 128-4096 像素之间。省略或传 auto 时默认为 1024x1024。                                                                          |
| n              | 可选     | 当前只支持 1；省略时按 1 处理。                                                                                                                                                  |
| stream         | 可选     | 传 true 时按 OpenAI 官方流式生图协议返回 SSE：渐进预览帧为 image_generation.partial_image 事件，最终成品为 image_generation.completed 事件。计费与非流式完全一致，预览帧不收费。 |
| partial_images | 可选     | 流式时请求的渐进预览帧数量，整数 0-3，默认 0（只发最终事件）。                                                                                                                   |

## 档位与计费

档位按图片最长边划分。请求 size 会用于预留最高可能费用；最终以实际输出图片的最长边落档扣费。

| 档位 | 实际输出最长边 | 请求 size 预留          |       价格 |
| ---- | -------------- | ----------------------- | ---------: |
| 1K   | \<= 1280 px    | 请求最长边 \<= 1280 px  | $0.01 / 张 |
| 2K   | 1281-2048 px   | 请求最长边 1281-2048 px | $0.01 / 张 |
| 4K   | 2049-4096 px   | 请求最长边 2049-4096 px | $0.01 / 张 |

| 模型                                |             价格 |
| ----------------------------------- | ---------------: | ---------- |
| GPT Image 2.5 gpt-image-2.5         |       $0.01 / 张 |
| 即梦 图片 4.0                       | jimeng-image-4.0 | $0.01 / 张 |
| Grok Image 2 grok-imagine-image-2.0 |       $0.01 / 张 |
