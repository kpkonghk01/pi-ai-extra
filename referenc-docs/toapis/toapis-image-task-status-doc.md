> ## Documentation Index
> Fetch the complete documentation index at: https://docs.toapis.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取图片任务状态

> 查询图片生成任务的状态和结果

<Note>
  **国内用户请注意：** 中国大陆用户请使用 `https://toapis.cn` 作为接口地址（Base URL）。文档示例中的 `https://toapis.com` 请替换为 `https://toapis.cn`。
</Note>

* 查询异步图片生成任务的执行状态和结果
* 实时状态更新和进度跟踪
* 任务完成时获取生成的图片
* 支持多语言返回（zh/en/ko/ja）

所有图片生成任务都是异步执行的。提交任务后，您需要通过查询接口获取任务状态和结果。

## 创建任务时传入业务 ID

创建图片任务时，可以在请求体顶层传入 `client_business_id`。该字段用于保存您系统内的订单号、流水号或业务任务 ID，方便后续按业务 ID 查询生成结果。

```json theme={null}
{
  "model": "gpt-4o-image",
  "client_business_id": "order_20260428_001",
  "prompt": "一只可爱的熊猫",
  "size": "1:1",
  "n": 1
}
```

也兼容放在 `metadata.client_business_id` 中，但推荐使用顶层字段。

## Authorizations

<ParamField header="Authorization" type="string" required>
  所有接口均需要使用 Bearer Token 进行认证

  获取 API Key：

  访问 [API Key 管理页面](https://toapis.com/console/token) 获取您的 API Key

  使用时在请求头中添加：

  ```
  Authorization: Bearer YOUR_API_KEY
  ```
</ParamField>

## Path Parameters

<ParamField path="task_id" type="string" required>
  图片生成 API 返回的任务 ID。也可以传创建任务时提交的 `client_business_id`，用于按客户侧业务 ID 查询任务状态和结果。
</ParamField>

<Note>
  如果创建图片任务时传入 `client_business_id`，可直接使用同一个状态查询接口：
  `GET /v1/images/generations/{client_business_id}`。业务 ID 会限定在当前 API Key 所属用户下查询。
</Note>

<RequestExample>
  ```bash cURL theme={null}
  curl --request GET \
    --url 'https://toapis.com/v1/images/generations/task_01KA040M0HP1GJWBJYZMKX1XS1' \
    --header 'Authorization: Bearer <token>'
  ```

  ```python Python theme={null}
  import requests
  import time

  API_BASE = 'https://toapis.com'
  API_KEY = 'sk-xxxxxxxxxxxxxxxxxxxxxx'

  headers = {
      'Authorization': f'Bearer {API_KEY}'
  }

  def get_image_status(task_id):
      response = requests.get(f'{API_BASE}/v1/images/generations/{task_id}', headers=headers)
      return response.json()

  def wait_for_image(task_id, max_attempts=60, interval=3):
      for _ in range(max_attempts):
          result = get_image_status(task_id)
          status = result.get('status')
          
          print(f"状态: {status}")
          
          if status == 'completed':
              return result
          elif status == 'failed':
              raise Exception(f"任务失败: {result}")
          
          time.sleep(interval)
      
      raise Exception("任务超时")

  # 使用示例
  task_id = "task_01KA040M0HP1GJWBJYZMKX1XS1"
  result = wait_for_image(task_id)
  print(f"图片URL: {result['url']}")
  ```

  ```javascript JavaScript theme={null}
  const API_BASE = 'https://toapis.com';
  const API_KEY = 'sk-xxxxxxxxxxxxxxxxxxxxxx';

  async function getImageStatus(taskId) {
    const response = await fetch(`${API_BASE}/v1/images/generations/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });
    return response.json();
  }

  async function waitForImage(taskId, maxAttempts = 60, interval = 3000) {
    for (let i = 0; i < maxAttempts; i++) {
      const result = await getImageStatus(taskId);
      const status = result.status;
      
      console.log(`状态: ${status}`);
      
      if (status === 'completed') {
        return result;
      } else if (status === 'failed') {
        throw new Error(`任务失败: ${JSON.stringify(result)}`);
      }
      
      await new Promise(r => setTimeout(r, interval));
    }
    
    throw new Error('任务超时');
  }

  // 使用示例
  const taskId = 'task_01KA040M0HP1GJWBJYZMKX1XS1';
  waitForImage(taskId).then(result => {
    console.log('图片URL:', result.url);
  });
  ```

  ```go Go theme={null}
  package main

  import (
      "encoding/json"
      "fmt"
      "io/ioutil"
      "net/http"
      "time"
  )

  func getImageStatus(taskId string) (map[string]interface{}, error) {
      url := fmt.Sprintf("https://toapis.com/v1/images/generations/%s", taskId)

      req, _ := http.NewRequest("GET", url, nil)
      req.Header.Set("Authorization", "Bearer <token>")

      client := &http.Client{}
      resp, err := client.Do(req)
      if err != nil {
          return nil, err
      }
      defer resp.Body.Close()

      body, _ := ioutil.ReadAll(resp.Body)
      
      var result map[string]interface{}
      json.Unmarshal(body, &result)
      
      return result, nil
  }

  func main() {
      taskId := "task_01KA040M0HP1GJWBJYZMKX1XS1"
      
      for i := 0; i < 60; i++ {
          result, _ := getImageStatus(taskId)
          status := result["status"].(string)
          
          fmt.Printf("状态: %s\n", status)
          
          if status == "completed" {
              fmt.Println("图片生成完成!")
              fmt.Println("图片URL:", result["url"])
              break
          }
          
          time.Sleep(3 * time.Second)
      }
  }
  ```
</RequestExample>

<ResponseExample>
  ```json 200 - 处理中 theme={null}
  {
    "id": "img_5b8b19afe5c24ab3a92df996f1a33931",
    "object": "generation.task",
    "model": "gemini-3-pro-image-preview",
    "status": "in_progress",
    "progress": 50,
    "created_at": 1768381010,
    "billing": {
      "status": "pending"
    }
  }
  ```

  ```json 200 - 已完成 theme={null}
  {
    "id": "img_5b8b19afe5c24ab3a92df996f1a33931",
    "client_business_id": "order_20260428_001",
    "object": "generation.task",
    "model": "gemini-3-pro-image-preview",
    "status": "completed",
    "progress": 100,
    "created_at": 1768381010,
    "completed_at": 1768381063,
    "expires_at": 1768467463,
    "result": {
      "type": "image",
      "data": [
        {
          "url": "https://files.toapis.com/generated/1768381061_c55c1bbb.jpg"
        }
      ]
    }
  }
  ```

  ```json 200 - 失败 theme={null}
  {
    "id": "img_73c450923a9a43e4aabf426e1c681d64",
    "object": "generation.task",
    "model": "gemini-3-pro-image-preview",
    "status": "failed",
    "progress": 0,
    "created_at": 1768215312,
    "billing": {
      "status": "refunded",
      "credits": "0",
      "cost_usd": "0"
    },
    "error": {
      "code": "generation_failed",
      "message": "call upstream API failed: upstream returned status 422"
    }
  }
  ```

  ```json 200 - 已完成 - 免费任务与用量 theme={null}
  {
    "id": "tsk_img_example",
    "object": "generation.task",
    "model": "gpt-image-2.5-flare-official",
    "status": "completed",
    "progress": 100,
    "created_at": 1789099098,
    "completed_at": 1789099158,
    "expires_at": 1789185558,
    "result": {
      "type": "image",
      "data": [
        {
          "url": "https://files.toapis.com/generated/example.png"
        }
      ]
    },
    "usage": {
      "input_tokens": 100,
      "output_tokens": 900,
      "total_tokens": 1000,
      "input_tokens_details": {
        "text_tokens": 20,
        "image_tokens": 80,
        "cached_tokens": 30,
        "cached_tokens_details": {
          "text_tokens": 10,
          "image_tokens": 20
        }
      },
      "output_tokens_details": {
        "text_tokens": 0,
        "image_tokens": 900
      }
    },
    "billing": {
      "status": "settled",
      "credits": "0",
      "cost_usd": "0"
    }
  }
  ```

  ```json 404 theme={null}
  {
    "error": {
      "code": 404,
      "message": "任务不存在",
      "type": "not_found_error"
    }
  }
  ```

  ```json 401 theme={null}
  {
    "error": {
      "code": 401,
      "message": "身份验证失败，请检查您的API密钥",
      "type": "authentication_error"
    }
  }
  ```
</ResponseExample>

## Response

<ResponseField name="id" type="string">
  任务唯一标识符
</ResponseField>

<ResponseField name="client_business_id" type="string">
  客户侧业务 ID。仅当创建任务时传入 `client_business_id` 时返回。
</ResponseField>

<ResponseField name="object" type="string">
  对象类型，固定为 `generation.task`
</ResponseField>

<ResponseField name="model" type="string">
  使用的图片生成模型
</ResponseField>

<ResponseField name="status" type="string">
  任务状态

  * `queued` - 排队等待处理
  * `in_progress` - 处理中
  * `completed` - 成功完成
  * `failed` - 失败
</ResponseField>

<ResponseField name="progress" type="integer">
  任务进度百分比（0-100）
</ResponseField>

<ResponseField name="created_at" type="integer">
  任务创建时间（Unix 时间戳）
</ResponseField>

<ResponseField name="completed_at" type="integer">
  任务完成时间（Unix 时间戳，仅完成时返回）
</ResponseField>

<ResponseField name="expires_at" type="integer">
  图片 URL 过期时间（Unix 时间戳，仅完成时返回）
</ResponseField>

<ResponseField name="result" type="object">
  任务结果（仅成功时返回）

  <Expandable title="属性">
    <ResponseField name="type" type="string">
      结果类型，固定为 `image`
    </ResponseField>

    <ResponseField name="data" type="array">
      图片数据数组

      <Expandable title="数组元素">
        <ResponseField name="url" type="string">
          生成的图片 URL
        </ResponseField>
      </Expandable>
    </ResponseField>
  </Expandable>
</ResponseField>

<ResponseField name="billing" type="object">
  可选的图片任务计费信息. 计费状态独立于任务生成状态, `completed` 不保证已经结算. 无法确认计费数据时省略整个 `billing`, 不返回 `null`, 也不代表免费.

  <Expandable title="属性">
    <ResponseField name="status" type="string">
      `pending` 表示待结算或退款尚未确认, 省略金额. `settled` 表示已确认最终结算. `refunded` 表示已退款或失败任务已确认无净扣费, 包括失败前未扣费的情况.
    </ResponseField>

    <ResponseField name="credits" type="string">
      平台实际向客户收取的积分, 使用十进制字符串. 仅在 `settled` 或 `refunded` 时返回.
    </ResponseField>

    <ResponseField name="cost_usd" type="string">
      平台实际向客户收取的美元金额, 使用十进制字符串. 已包含任务计费时采用的折扣和倍率, 不代表供应商成本.
    </ResponseField>
  </Expandable>
</ResponseField>

<ResponseField name="usage" type="object">
  可选的已结算图片 token 用量. 仅在 `billing.status` 为 `settled`, 且已保存的用量有效并与最终扣费一致时返回图片 token 字段. 缺失或无法校验时省略, 不估算, 不用零值代替; 已确认的金额和图片结果仍可正常返回.

  | 字段                                                        | 类型      | 说明                             |
  | --------------------------------------------------------- | ------- | ------------------------------ |
  | `input_tokens`                                            | integer | 输入 token 总数, 包含文本和图片           |
  | `output_tokens`                                           | integer | 输出 token 总数                    |
  | `total_tokens`                                            | integer | `input_tokens + output_tokens` |
  | `input_tokens_details.text_tokens`                        | integer | 文本输入 token 数                   |
  | `input_tokens_details.image_tokens`                       | integer | 图片输入 token 数                   |
  | `input_tokens_details.cached_tokens`                      | integer | 已缓存的输入 token 数, 已包含在输入总数中      |
  | `input_tokens_details.cached_tokens_details.text_tokens`  | integer | 已缓存的文本输入 token 数               |
  | `input_tokens_details.cached_tokens_details.image_tokens` | integer | 已缓存的图片输入 token 数               |
  | `output_tokens_details.text_tokens`                       | integer | 文本输出 token 数, 仅在有输出明细时返回       |
  | `output_tokens_details.image_tokens`                      | integer | 图片输出 token 数, 仅在有输出明细时返回       |

  所有 token 数均为非负 JSON 整数. 缓存 token 是输入 token 的子集, 不能重复相加. `output_tokens_details` 在未提供明细时整体省略. `usage.tool_usage.web_search` 可独立返回, 也可与图片 token 并存.
</ResponseField>

<ResponseField name="error" type="object">
  错误信息（仅失败时返回）

  <Expandable title="属性">
    <ResponseField name="code" type="string">
      错误代码
    </ResponseField>

    <ResponseField name="message" type="string">
      错误描述
    </ResponseField>
  </Expandable>
</ResponseField>

## 计费状态与消费统计

上述计费规则适用于图片任务查询, 不限制模型或渠道. GPT-Image-2.5 的 Sunburst 和 Flare VIP / Official 型号已接通 token 用量, 其他模型是否返回取决于已有结算数据. 示例金额仅用于说明响应格式, 不是固定单价.

| billing.status | 含义                | 金额与图片 token                                 |
| -------------- | ----------------- | ------------------------------------------- |
| `pending`      | 生成中, 待结算, 或退款尚未确认 | 省略金额和图片 token; 预扣不代表最终消费                    |
| `settled`      | 已确认最终结算           | 返回金额, 有有效用量时返回图片 token; 免费任务金额也可为 `"0"`     |
| `refunded`     | 已退款或失败后已确认无净扣费    | `credits` 和 `cost_usd` 均为 `"0"`, 省略图片 token |

* 金额来自任务已确认的最终扣费, 查询不会触发扣款, 补扣或退款, 也不会按最新模型价格重算. 统计时直接使用返回金额, 不要用 token 乘当前单价替代.
* 按任务 `id` 去重并更新金额, 不要累加每次轮询的返回值. 使用十进制计算; `pending` 或字段缺失不能按零消费处理.
* 金额使用十进制字符串, 不保证固定小数位数.
* 计费记录缺失或不一致时可能省略 `billing`. 图片尚不可交付而临时显示为 `in_progress` 时, 也可能同时省略 `billing` 和 `usage`.
* 成功 Webhook 的 `data.usage` 可包含相同的图片 token 字段，`data.billing` 也可能包含已确认费用。任一字段缺失时，可查询本接口作为兜底。详见[价格与实际费用](../account/pricing)。

## 任务状态说明

| 状态            | 说明       | 是否终态 | 建议操作                       |
| ------------- | -------- | ---- | -------------------------- |
| `queued`      | 任务排队等待处理 | ❌    | 等待至少 5-10 秒并加入抖动后查询        |
| `in_progress` | 任务正在处理中  | ❌    | 等待至少 5-10 秒并加入抖动后查询        |
| `completed`   | 任务成功完成   | ✅    | 从 result.data\[0].url 获取图片 |
| `failed`      | 任务处理失败   | ✅    | 检查 error 信息                |

## 轮询策略建议

```
初始等待: 5 秒
轮询间隔: 至少 5-10 秒并加入随机抖动
最大等待: 120 秒
典型耗时: 5-30 秒
```

### Python 轮询示例

```python theme={null}
import time
import random
import requests

def poll_image_task(task_id, api_key, max_wait=120):
    """轮询图片生成任务直到完成或超时"""
    start_time = time.time()
    interval = 5
    
    while time.time() - start_time < max_wait:
        response = requests.get(
            f'https://toapis.com/v1/images/generations/{task_id}',
            headers={'Authorization': f'Bearer {api_key}'}
        )
        if response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', interval))
            time.sleep(retry_after + random.uniform(0, 1))
            interval = min(interval * 2, 60)
            continue
        response.raise_for_status()
        data = response.json()
        
        if data['status'] == 'completed':
            return data['url']
        elif data['status'] == 'failed':
            raise Exception(f"生成失败: {data['error']['message']}")
        
        time.sleep(interval + random.uniform(0, 1))
    
    raise TimeoutError("任务超时")
```

## 图片资源有效期

<Warning>
  生成的图片 URL 有效期为 **24 小时**

  * 请在有效期内下载保存图片
  * `expires_at` 字段标识图片过期时间（Unix 时间戳）
  * 图片过期后无法访问，如需重新获取，需要重新提交生成任务
</Warning>

## 常见错误

| 错误码 | 错误类型                       | 说明              |
| --- | -------------------------- | --------------- |
| 400 | `invalid_request`          | 请求参数无效          |
| 401 | `unauthorized`             | 认证失败，检查 API Key |
| 402 | `insufficient_quota`       | 余额不足            |
| 404 | `task_not_found`           | 任务不存在           |
| 422 | `content_policy_violation` | 内容违规            |
| 429 | `rate_limit_exceeded`      | 请求频率超限          |
| 500 | `internal_error`           | 服务器内部错误         |

<Note>ToAPIs 支持统一 [任务 Webhook](/docs/cn/api-reference/webhooks/task-webhooks)。推荐回调为主、轮询兜底；至少间隔 5～10 秒并加入抖动，`429` 时读取 `Retry-After`。批量查询最多 100 个任务，详见 [限流](/docs/cn/api-reference/rate-limits/async-tasks)。</Note>
