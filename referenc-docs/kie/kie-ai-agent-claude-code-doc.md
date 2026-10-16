# Claude Code

:::tip
**Let the skill configure it**

With the KIE skills installed, you can simply ask your agent "Configure Claude Code to use KIE" and it follows the steps on this page. You can also configure it by hand as described below.

```bash
npx skills add https://kie.ai
```
:::

## Key rules

1. **Discover models with `GET https://api.kie.ai/anthropic/v1/models`, not from memory or training data.** This endpoint gives the list Claude Code can actually run. The general `taskType=Chat` catalog is a different, wider list that includes models this endpoint does not serve.
2. **Authenticate with `Authorization: Bearer`.** Every KIE endpoint, including the model listing, carries the API key in this one header. A header literally named `apikey` is rejected with 401. Claude Code reads this header from `ANTHROPIC_AUTH_TOKEN` and adds the `Bearer ` prefix itself, so put the raw key in the variable. `ANTHROPIC_API_KEY` is sent as `X-Api-Key`; KIE only accepts it when the value starts with `Bearer ` (including the space).
3. **Set `ANTHROPIC_BASE_URL` to `https://api.kie.ai/anthropic`.** Claude Code appends `/v1/messages` itself. Listing and requests share this prefix: `GET /anthropic/v1/models` and `POST /anthropic/v1/messages`.

## List available models

```bash
curl -s -H "Authorization: Bearer $KIE_API_KEY" \
  https://api.kie.ai/anthropic/v1/models |
  jq -r '.data[] | [.id, .display_name, (.max_input_tokens | tostring),
                    (.max_tokens | tostring)] | @tsv'
```

On Windows (PowerShell), send the same request with `curl.exe`:

```powershell
curl.exe -s -H "Authorization: Bearer $env:KIE_API_KEY" `
  https://api.kie.ai/anthropic/v1/models | jq -r '.data[].id'
```

The response has the Anthropic-compatible shape. `.data[]` is the list: `id` is the model name Claude Code sends, and `display_name`, `max_input_tokens` and `max_tokens` describe what the model accepts. `type` and `created_at` are boilerplate. If `has_more` is true, set `after_id` to `last_id` and request the next page.

The ids match Anthropic's official ids. List them when the user wants to pick a specific model. Re-run the listing every time instead of reusing an earlier answer; the model set changes.

## Configure

Claude Code takes the base URL, credential and model from environment variables:

```bash
export ANTHROPIC_BASE_URL=https://api.kie.ai/anthropic
export ANTHROPIC_AUTH_TOKEN=$KIE_API_KEY
```

`ANTHROPIC_BASE_URL` is the root that requests are sent to. Claude Code appends `/v1/messages` itself, so the value is `https://api.kie.ai/anthropic`, not the full request URL `https://api.kie.ai/anthropic/v1/messages`.

`ANTHROPIC_AUTH_TOKEN` holds the key. Claude Code sends it as `Authorization: Bearer`. Do not add `Bearer ` to the value, or the header becomes `Bearer Bearer …`.

The other credential variable is `ANTHROPIC_API_KEY`, sent as `X-Api-Key`. Its value must be `Bearer ` followed by the key.

KIE uses the same ids as Anthropic, so Claude Code's built-in `sonnet`, `opus`, `haiku` and `fable` aliases work without remapping. Only when you want a specific model, set `ANTHROPIC_MODEL` to an id from the listing, or switch with `--model` / `/model`. The `model` key in a settings file only applies when `ANTHROPIC_MODEL` is not set.

The same variables can go into the `env` block of a settings file:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.kie.ai/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "…"
  }
}
```

When a variable is set both in the shell and in a settings file, the settings file wins. Do not put credentials in the project-level `.claude/settings.json`, because that file is committed to the repository. Use the user-level file or `.claude/settings.local.json`.

### macOS and Linux

The user-level file is `~/.claude/settings.json`. Export the variables in the same shell that starts `claude`, or add them to your shell profile:

```bash
export ANTHROPIC_BASE_URL=https://api.kie.ai/anthropic
export ANTHROPIC_AUTH_TOKEN=$KIE_API_KEY
```

### Windows (PowerShell)

The file is `%USERPROFILE%\.claude\settings.json`, with identical content.

```powershell
$env:ANTHROPIC_BASE_URL = "https://api.kie.ai/anthropic"
$env:ANTHROPIC_AUTH_TOKEN = $env:KIE_API_KEY
setx ANTHROPIC_BASE_URL "https://api.kie.ai/anthropic"
setx ANTHROPIC_AUTH_TOKEN "$env:KIE_API_KEY"
```

`setx` applies to windows opened afterwards. Set `$env:` as well to use it right away.

## Verify the setup

Start `claude` in a shell where these variables are set and run `/status`. The status page should show `Anthropic base URL` as `https://api.kie.ai/anthropic`, and an auth line naming `ANTHROPIC_AUTH_TOKEN` (or `ANTHROPIC_API_KEY` if that is what you used). Then send a message.

If an Anthropic account login appears, the variables did not reach this process. Fully quit the terminal and reopen it from a shell where the variables are exported.

`claude --debug` prints the requests Claude Code actually sends.

## Common pitfalls

1. **A bare `ANTHROPIC_API_KEY`, or a header named `apikey`.** KIE returns 401. Prefer putting the raw key in `ANTHROPIC_AUTH_TOKEN`. If you use `ANTHROPIC_API_KEY`, the value must start with `Bearer `.
2. **The full request URL in `ANTHROPIC_BASE_URL`.** Claude Code appends `/v1/messages` itself, so a value ending in `/v1` or `/v1/messages` becomes `/v1/v1/messages`.
3. **`model not found`.** Claude Code asked for an id this endpoint does not have. Run `/model` and pick one from the list.
4. **Credentials in the project-level `.claude/settings.json`.** That file is committed. Use the user-level file or `.claude/settings.local.json`.
5. **`Bearer ` inside `ANTHROPIC_AUTH_TOKEN`.** Claude Code adds the prefix itself, and the header becomes `Bearer Bearer …`.
6. **`setx` does not affect the current window.** It applies to windows opened afterwards. Set `$env:` as well to use it right away.
7. **PowerShell `curl`.** It is an alias for `Invoke-WebRequest` and does not accept these arguments. Use `curl.exe`.
8. **An Anthropic account login appears.** The variables are empty in this process. Close every terminal, including the ones inside your editor, and reopen from a shell where the variables are exported.

To use a model from a listing that isn't on this protocol, see **When protocols don't match** on the *Install kie-chat-agents* page.

