> ## Documentation Index
> Fetch the complete documentation index at: https://docs.toapis.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Codex 配置指南

> 通过 CC Switch 在 Codex CLI 中使用 ToAPIs

<Note>
  **国内用户请注意：** 中国大陆用户请使用 `https://toapis.cn` 作为接口地址（Base URL）。文档示例中的 `https://toapis.com` 请替换为 `https://toapis.cn`。
</Note>

## 准备工作

开始前请准备：

1. **ToAPIs API 密钥**：前往 [ToAPIs 控制台](https://toapis.com/console/token) 创建密钥。

2. **Codex CLI**：按照 [Codex 官方文档](https://developers.openai.com/codex/cli) 安装，或使用以下命令：

   ```bash theme={null}
   npm install -g @openai/codex
   ```

3. **CC Switch**：只从 [CC Switch 官网](https://ccswitch.io) 或 [官方 GitHub Releases](https://github.com/farion1231/cc-switch/releases) 下载。

## 在 CC Switch 中添加 ToAPIs

1. 打开 CC Switch，在顶部应用切换器中选择 **Codex**。
2. 点击右上角 **+**，选择 **应用专属供应商**。
3. 在预设中选择 **自定义**，填写以下内容：

| 配置项               | 填写内容                    |
| ----------------- | ----------------------- |
| 名称                | `ToAPIs`                |
| API Key           | 您的 ToAPIs API 密钥        |
| API 端点 / Base URL | `https://toapis.com/v1` |
| 模型                | `gpt-5.3-codex`         |
| API 协议            | `Responses`             |
| 需要本地路由映射          | **关闭**                  |

4. 点击 **添加**，然后在 ToAPIs 供应商卡片上点击 **启用**。
5. 关闭正在运行的 Codex 和终端窗口，重新打开终端使配置生效。

<Note>
  ToAPIs 原生支持 `POST /v1/responses`，因此不要开启“需要本地路由映射”。该开关用于只支持 Chat Completions 的供应商。
</Note>

## 启动并验证

```bash theme={null}
codex
```

进入 Codex 后发送一个简单任务，例如：

```text theme={null}
检查当前项目并说明它的主要目录结构。
```

如能正常返回结果，说明接入成功。

## 切换模型

如果账户开放了其他 Responses 模型，可以编辑 ToAPIs 供应商并更换模型。CC Switch 的模型输入框支持通过 `/v1/models` 获取可用列表；也可以前往 [ToAPIs 模型一览](../api-reference/chat/models) 查看模型 ID。

常用选择：

| 模型                       | 适用场景           |
| ------------------------ | -------------- |
| `gpt-5.3-codex`          | 默认推荐，适合大多数代码任务 |
| `gpt-5.3-codex-spark`    | 更注重响应速度的代码任务   |
| `gpt-5.3-codex-official` | 需要官方直连渠道时使用    |

模型是否可用取决于账户和渠道配置，请优先以 CC Switch 获取到的 `/v1/models` 列表为准。

## 常见问题

### 启用后仍使用旧供应商

Codex 不会热重载供应商配置。请完全退出 Codex，并重新打开终端后再启动 `codex`。

### `401 Unauthorized`

* 检查 CC Switch 中的 API Key 是否完整
* 在 [ToAPIs 控制台](https://toapis.com/console/token) 确认密钥有效
* 确认账户余额充足

### `404` 或 Responses 路径错误

确认 Base URL 是 `https://toapis.com/v1`，API 协议为 `Responses`，并且“需要本地路由映射”处于关闭状态。

### 模型不可用

在 CC Switch 中点击模型字段旁的“获取模型”，或调用 `GET https://toapis.com/v1/models` 检查当前密钥可用的模型。

## 配置文件与密钥安全

CC Switch 会管理 `~/.codex/auth.json` 和 `~/.codex/config.toml`。不要把这些文件、API Key 或包含密钥的截图提交到 Git 仓库。

更多 CC Switch 操作说明参阅其 [官方用户手册](https://github.com/farion1231/cc-switch/tree/main/docs/user-manual/zh)。
