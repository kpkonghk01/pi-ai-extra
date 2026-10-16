> ## Documentation Index
> Fetch the complete documentation index at: https://docs.toapis.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 支持的文字模型

> 文字对话模型一览，支持 Chat Completions 与 Responses 两种 API 格式

<Note>
  **国内用户请注意：** 中国大陆用户请使用 `https://toapis.cn` 作为接口地址（Base URL）。文档示例中的 `https://toapis.com` 请替换为 `https://toapis.cn`。
</Note>

平台提供两种 API 调用方式，通过 `model` 参数切换模型：

| API 格式 | 端点 | 说明 |
| - | - | - |
| **Chat Completions**（默认） | `POST /v1/chat/completions` | 经典对话接口，兼容所有 OpenAI SDK，[查看文档](./chat) |
| **Responses**（新） | `POST /v1/responses` | OpenAI 新一代 Agentic API，支持函数调用、内置工具、服务端多轮上下文，[查看文档](./responses) |

<Tip>
  标注 <code>Responses Only</code> 的模型仅支持 Responses API，不支持 Chat Completions。其余模型默认通过 Chat Completions 调用。
</Tip>

***

## Anthropic / Claude

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `claude-haiku-4-5` | 速度最快、成本最低的 Claude 模型，适合高并发轻量任务 | ✓ | |
| `claude-sonnet-4-6` | 性能与成本最佳平衡，适合大多数业务场景 | ✓ | |
| `claude-opus-4-6` | Claude 旗舰模型，适合复杂推理与高质量创作 | ✓ | |

## OpenAI / GPT-5

### GPT-5 Official（官方直连）

通过 Azure OpenAI 官方 API 直连，稳定性与合规性最高。

| 模型 ID | 描述 | 视觉 | 深度思考 | API 格式 |
| - | - | :-: | :-: | :-: |
| `gpt-5-pro-official` | GPT-5 Pro 官方直连，OpenAI 最强旗舰推理模型 | ✓ | ✓ | Responses Only |
| `gpt-5.2-official` | GPT-5.2 官方直连，多模态增强版 | ✓ | ✓ | 全部 |
| `gpt-5.3-codex-official` | GPT-5.3 Codex 官方直连，最新代码优化版，支持函数调用与内置工具 | ✓ | ✓ | Responses Only |

### GPT-5 标准

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `gpt-5` | OpenAI 旗舰模型，强大的通用推理与多模态能力 | ✓ | |
| `gpt-5-codex` | 专为代码优化的 GPT-5，擅长代码生成与调试 | | |
| `gpt-5-codex-mini` | 轻量代码模型，极速响应低成本 | | |
| `gpt-5.1` | GPT-5 增强版，改进的指令遵循与推理能力 | ✓ | |
| `gpt-5.1-codex` | GPT-5.1 代码专项版本 | | |
| `gpt-5.1-codex-max` | GPT-5.1 旗舰代码版，最强代码能力 | | |
| `gpt-5.1-codex-mini` | GPT-5.1 轻量代码版，快速低成本 | | |
| `gpt-5.2` | GPT-5 第二代，多模态增强 | ✓ | |
| `gpt-5.2-codex` | GPT-5.2 代码专项版本 | | |
| `gpt-5.3-codex` | GPT-5 最新代码版本，持续优化的代码能力 | | |
| `gpt-5.3-codex-spark` | GPT-5.3 Codex Spark 变体，专注高速代码生成 | | |
| `gpt-5.4` | GPT-5 第四代，更强的通用推理与多模态能力 | ✓ | |
| `gpt-5.5` | GPT-5.5，更强的通用推理、代码与多模态能力 | ✓ | |
| `gpt-5.6-sol` | GPT-5.6 旗舰模型，适合复杂推理、高价值代码和长上下文任务 | ✓ | ✓ |
| `gpt-5.6-terra` | GPT-5.6 均衡模型，适合通用生产流量与 Agent 工作流 | ✓ | ✓ |
| `gpt-5.6-luna` | GPT-5.6 高吞吐模型，适合分类、抽取、路由和批处理 | ✓ | ✓ |

## Google / Gemini

### Gemini 3 系列

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `gemini-3.1-pro-preview-official` | Gemini 3.1 Pro，最新一代旗舰推理模型 | ✓ | ✓ |
| `gemini-3.1-flash-lite-preview-official` | Gemini 3.1 Flash Lite，最具成本效益的轻量模型，极速响应 | ✓ | |
| `gemini-3-pro-official` | Gemini 3 Pro 旗舰，最强推理与多模态能力 | ✓ | ✓ |
| `gemini-3-pro-preview-official` | Gemini 3 Pro Preview 版本（同 gemini-3-pro-official） | ✓ | ✓ |
| `gemini-3-flash-official` | Gemini 3 Flash，快速高效，性价比之选 | ✓ | ✓ |
| `gemini-3-flash-preview-official` | Gemini 3 Flash Preview 版本（同 gemini-3-flash-official） | ✓ | ✓ |
| `gemini-3.1-fast` | Gemini 快速版，高性价比多模态模型 | ✓ | |
| `gemini-3.1-thinking` | Gemini 思考版，内置推理链，适合复杂问题求解 | ✓ | ✓ |

### Gemini 2.5 系列

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `gemini-2.5-pro-official` | Gemini 2.5 Pro，强大推理与长上下文能力 | ✓ | ✓ |
| `gemini-2.5-flash-official` | Gemini 2.5 Flash，高速推理，支持思考模式 | ✓ | ✓ |
| `gemini-2.5-flash-lite-official` | Gemini 2.5 Flash Lite，极低成本超快响应 | ✓ | |

### Gemini 2.0 系列

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `gemini-2.0-flash-official` | Gemini 2.0 Flash，经典快速模型 | ✓ | |
| `gemini-2.0-flash-lite-official` | Gemini 2.0 Flash Lite，最低成本轻量模型 | ✓ | |

## DeepSeek

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `deepseek-v3.2` | 深度求索旗舰模型，支持扩展思考，擅长代码与复杂推理 | | ✓ |

## 阿里巴巴 / 通义千问

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `qwen3-max` | 千问旗舰模型，支持深度思考，擅长复杂推理与代码生成 | | ✓ |
| `qwen3.5-plus` | 千问增强版，均衡的性能与成本 | | |
| `qwen3.5-flash` | 千问超快版，极低延迟，高吞吐量场景首选 | | |

## 智谱 / GLM

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `glm-5` | 智谱旗舰模型，中文理解与生成能力出色 | | |

## Moonshot / Kimi

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `kimi-k2.5` | Moonshot 旗舰模型，超长上下文，中文能力突出 | | |

## MiniMax

| 模型 ID | 描述 | 视觉 | 深度思考 |
| - | - | :-: | :-: |
| `MiniMax-M2.5` | MiniMax 旗舰模型，性价比卓越 | | |


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.