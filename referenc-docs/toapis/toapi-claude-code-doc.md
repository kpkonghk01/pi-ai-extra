> ## Documentation Index
> Fetch the complete documentation index at: https://docs.toapis.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Claude Code 配置指南

> 在 Claude Code 中使用 ToAPIs 作为 API 后端

<Note>
  **国内用户请注意：** 中国大陆用户请使用 `https://toapis.cn` 作为接口地址（Base URL）。文档示例中的 `https://toapis.com` 请替换为 `https://toapis.cn`。
</Note>

## 准备工作

在开始之前，请确保：

1. **已安装 Claude Code**

   通过 npm 或 pnpm 安装 Claude Code CLI：

   ```bash theme={null}
   # npm
   npm install -g @anthropic-ai/claude-code

   # pnpm
   pnpm install -g @anthropic-ai/claude-code
   ```

   或访问 [Claude Code 官方文档](https://docs.anthropic.com/claude-code) 获取最新安装方式

2. **已获取 ToAPIs API 密钥**

   登录 [ToAPIs 控制台](https://toapis.com/console/token) 获取您的 API 密钥（以 `sk-` 开头）

**提示：** 如果还没有 ToAPIs 账户，请先在 [ToAPIs](https://toapis.com) 注册并获取 API 密钥。

## 配置方式

Claude Code 支持多种方式配置自定义 API 端点，您可以将 ToAPIs 作为 Anthropic API 的替代后端。

Claude Code 使用两个不同的 JSON 文件：**onboarding 状态** 与 **环境变量** 需分别写入对应文件才能生效。

### 先确认 onboarding 已完成

在用户主目录下的 `~/.claude.json` 中设置已完成引导（若文件不存在可创建）：

```json theme={null}
{
  "hasCompletedOnboarding": true
}
```

该文件仅用于 CLI 状态位；API 密钥与 base URL 请写在下面的 `settings.json` 中。

### 方式一：通过 settings.json 配置（推荐）

在 `~/.claude/settings.json`（全局）或项目根目录的 `.claude/settings.json`（项目级）中配置环境变量，无需修改 shell 配置文件：

```json theme={null}
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-xxxxxxxxxxxx",
    "ANTHROPIC_BASE_URL": "https://toapis.com"
  }
}
```

**全局配置**（推荐，对所有项目生效）：

```bash theme={null}
# 创建或编辑 ~/.claude/settings.json
mkdir -p ~/.claude
```

然后将上述 JSON 写入 `~/.claude/settings.json`。

**项目级配置**（仅对当前项目生效）：

在项目根目录创建 `.claude/settings.json`。项目级文件中不要包含 API Key，建议只在全局配置中写 `ANTHROPIC_AUTH_TOKEN`，项目配置中只写 `ANTHROPIC_BASE_URL`：

```json theme={null}
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://toapis.com"
  }
}
```

> **注意：** `hasCompletedOnboarding` 放在 `~/.claude.json`，`env` 放在 `~/.claude/settings.json` 或 `.claude/settings.json`，不要混写到同一个文件中。

### 方式二：通过环境变量配置

适用于临时使用或 CI/CD 环境。

#### macOS / Linux

在终端中临时设置（当前会话有效）：

```bash theme={null}
export ANTHROPIC_AUTH_TOKEN="sk-xxxxxxxxxxxx"
export ANTHROPIC_BASE_URL="https://toapis.com"
claude
```

永久配置，将以下内容添加到 `~/.bashrc` 或 `~/.zshrc`：

```bash theme={null}
export ANTHROPIC_AUTH_TOKEN="sk-xxxxxxxxxxxx"
export ANTHROPIC_BASE_URL="https://toapis.com"
```

然后执行：

```bash theme={null}
source ~/.zshrc  # 或 source ~/.bashrc
```

#### Windows

在 PowerShell 中临时设置：

```powershell theme={null}
$env:ANTHROPIC_AUTH_TOKEN = "sk-xxxxxxxxxxxx"
$env:ANTHROPIC_BASE_URL = "https://toapis.com"
claude
```

永久配置（系统级）：

```powershell theme={null}
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "sk-xxxxxxxxxxxx", "User")
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://toapis.com", "User")
```

### 方式三：使用 `.env` 文件

在您的项目根目录创建 `.env` 文件：

```bash theme={null}
ANTHROPIC_AUTH_TOKEN=sk-xxxxxxxxxxxx
ANTHROPIC_BASE_URL=https://toapis.com
```

**注意：** 请将 `.env` 添加到 `.gitignore`，避免泄露 API 密钥。

### 配置说明

| 配置项                        | 填写内容                                |
| -------------------------- | ----------------------------------- |
| **ANTHROPIC\_AUTH\_TOKEN** | 您的 ToAPIs API 密钥（`sk-xxxxxxxxxxxx`） |
| **ANTHROPIC\_BASE\_URL**   | `https://toapis.com`                |

## 验证配置

配置完成后，运行以下命令验证连接是否正常：

```bash theme={null}
claude --version
```

然后启动 Claude Code：

```bash theme={null}
claude
```

如果配置正确，Claude Code 将通过 ToAPIs 连接到 Claude 模型并正常响应。

## 推荐模型

通过 ToAPIs 您可以使用以下 Claude 模型：

| 模型名称              | 模型 ID                       | 特点             |
| ----------------- | --------------------------- | -------------- |
| Claude Opus 4.6   | `claude-opus-4-6`           | 最强大，适合复杂任务     |
| Claude Sonnet 4.6 | `claude-sonnet-4-6`         | 性能与速度平衡，推荐日常使用 |
| Claude Haiku 4.5  | `claude-haiku-4-5-20251001` | 快速响应，适合简单任务    |

切换模型可使用 `/model` 命令，或在启动时通过 `--model` 参数指定：

```bash theme={null}
claude --model claude-sonnet-4-6
```

## 常见问题

### Q1: 出现 `Authentication error` 或 `401 Unauthorized`？

**解决方案：**

1. 检查 `ANTHROPIC_AUTH_TOKEN` 是否正确设置，确认以 `sk-` 开头
2. 在 [ToAPIs 控制台](https://toapis.com/console/token) 确认密钥未过期
3. 确认账户余额充足

### Q2: 出现 `Connection refused` 或无法连接？

**解决方案：**

1. 确认 `ANTHROPIC_BASE_URL` 设置为 `https://toapis.com`
2. 检查网络连接，确保能访问 `https://toapis.com`
3. 如在国内，可能需要配置代理

### Q3: 如何查看当前环境变量配置？

```bash theme={null}
echo $ANTHROPIC_AUTH_TOKEN
echo $ANTHROPIC_BASE_URL
```

### Q4: 常见错误码说明

| 错误信息                        | 原因          | 解决方法        |
| --------------------------- | ----------- | ----------- |
| `401 Unauthorized`          | API 密钥无效或过期 | 重新获取 API 密钥 |
| `429 Too Many Requests`     | 请求频率超限      | 稍等片刻后重试     |
| `500 Internal Server Error` | 服务器临时故障     | 等待几分钟后重试    |
| `insufficient_quota`        | 账户余额不足      | 前往控制台充值     |

## 使用技巧

### 1. 在项目中快速启动

进入项目目录后直接运行 `claude`，Claude Code 会自动读取项目上下文：

```bash theme={null}
cd /your/project
claude
```

### 2. 常用命令

| 命令                 | 说明             |
| ------------------ | -------------- |
| `/help`            | 查看帮助信息         |
| `/model`           | 切换模型           |
| `/clear`           | 清空当前对话         |
| `/exit` 或 `Ctrl+C` | 退出 Claude Code |

### 3. 与代码协作

Claude Code 能够读取和修改项目文件，常用场景：

* **代码审查** - 让 Claude Code 审查您的代码并提出改进建议
* **生成代码** - 描述需求，Claude Code 直接生成并写入文件
* **调试错误** - 粘贴错误信息，获取调试建议
* **重构代码** - 让 Claude Code 优化代码结构

## 支持与帮助

如果您在使用过程中遇到任何问题：

* 📚 [ToAPIs 文档中心](https://docs.toapis.com)
* 📚 [Claude Code 官方文档](https://docs.anthropic.com/claude-code)
* 💬 [Discord 社区](https://discord.gg/hvnszCrJ73)
* 🐦 [Twitter @toapisai](https://x.com/toapisai)

***

\[## 开始使用 ToAPIs

立即注册 ToAPIs，获取您的 API 密钥，在 Claude Code 中开启高效编程之旅！]\([https://toapis.com](https://toapis.com))
