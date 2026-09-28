# Claude Code + kie.ai Integration Guide

# Claude Code + kie.ai Integration Guide

With a simple environment variable setup, you can route your local Claude Code through kie.ai's proxy and use your kie.ai account credits. Takes about 3 minutes.

---

## Prerequisites: Configuration Values You Need

| Variable | Value |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://api.kie.ai/claude` |
| `ANTHROPIC_API_KEY` | `Bearer <your kie.ai API Key>` |
| `ANTHROPIC_AUTH_TOKEN` | `<your kie.ai API Key>` (alternative to `ANTHROPIC_API_KEY` — no Bearer prefix needed) |

> **Important Notes**
>
> - Set `ANTHROPIC_BASE_URL` to `https://api.kie.ai/claude` only — do **not** append `/v1/messages`. Claude Code appends that automatically.
> - There are two ways to provide your API Key — **choose one**:
>   - Option 1: Use `ANTHROPIC_API_KEY`. The value **must** start with `Bearer ` (note the space after Bearer). Example: `Bearer sk-kie-abc123xxx`
>   - Option 2: Use `ANTHROPIC_AUTH_TOKEN`. Set it directly to the Key value — **no Bearer prefix**. Example: `sk-kie-abc123xxx`

---

## Step 1: Install Claude Code

### Mac

Open Terminal and paste:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

### Windows

Open **PowerShell** from the Start menu and paste:

```powershell
irm https://claude.ai/install.ps1 | iex
```

After installation, run `claude --version`. If you see a version number, the installation succeeded.

> ⚠️ If the `claude` command is not found, check that Claude Code was added to your PATH.
>
> ⚠️ After installing, **do not log in with an Anthropic account**. You will connect using your kie.ai credentials in the next step.

---

## Step 2: Set Your Credentials (Choose One Method)

### Method A: System Environment Variables (Recommended)

Configure once — every terminal session will automatically route through kie.ai.

#### Mac

Open Terminal and paste one of the following (replace the key with your own):

```bash
# Option 1: ANTHROPIC_API_KEY (Bearer prefix required)
echo 'export ANTHROPIC_BASE_URL="https://api.kie.ai/claude"' >> ~/.zshrc
echo 'export ANTHROPIC_API_KEY="Bearer your_kie_API_Key"' >> ~/.zshrc
source ~/.zshrc
```

```bash
# Option 2: ANTHROPIC_AUTH_TOKEN (no Bearer prefix)
echo 'export ANTHROPIC_BASE_URL="https://api.kie.ai/claude"' >> ~/.zshrc
echo 'export ANTHROPIC_AUTH_TOKEN="your_kie_API_Key"' >> ~/.zshrc
source ~/.zshrc
```

#### Windows

Open PowerShell and paste one of the following (replace the key with your own):

```powershell
# Option 1: ANTHROPIC_API_KEY (Bearer prefix required)
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.kie.ai/claude", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "Bearer your_kie_API_Key", "User")
```

```powershell
# Option 2: ANTHROPIC_AUTH_TOKEN (no Bearer prefix)
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.kie.ai/claude", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "your_kie_API_Key", "User")
```

After running these commands, **close all open terminal windows and reopen them** — new windows are required to pick up the variables.

---

### Method B: Claude Code Settings File

Takes effect only when running `claude`. Does not affect other programs on your system — a cleaner option if you prefer isolation.

Open the file below (create it if it doesn't exist), add the content, and replace the key:

- **Mac**: `~/.claude/settings.json`
- **Windows**: `C:\Users\<your-username>\.claude\settings.json`

```json
// Option 1: ANTHROPIC_API_KEY (Bearer prefix required)
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.kie.ai/claude",
    "ANTHROPIC_API_KEY": "Bearer your_kie_API_Key"
  }
}
```

```json
// Option 2: ANTHROPIC_AUTH_TOKEN (no Bearer prefix)
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.kie.ai/claude",
    "ANTHROPIC_AUTH_TOKEN": "your_kie_API_Key"
  }
}
```

---

### Method C: CC-SWITCH

Installation Steps:

- Download the CC-Switch-Windows.msi file.

```
https://github.com/farion1231/cc-switch/releases

```
- Double-click to run the installer and follow the wizard to complete the installation.

- After installation, find CC Switch in the Start Menu or on the desktop and launch it.

Enter the following information:

- API KEY (No Bearer required)

- Request URL 'https://api.kie.ai/claude' (It is recommended to disable the full URL)

- Enter the corresponding model name from the KIE documentation in the advanced options.

Save and enable.

---

## Step 3: Verify the Connection

Open a terminal and run in any directory:

```bash
claude
```

Once the interactive session starts, send any message (e.g. "Hello").

- ✅ Gets a normal reply → kie.ai is connected. You can also verify usage in the kie.ai logs page.
- ❌ Prompted to log in with an Anthropic account → See FAQ item #1 below.

---

## FAQ

| Symptom | Cause / Solution |
|---|---|
| Still prompted to log in with Anthropic account | Environment variables not loaded. **Fully close all terminal windows** (Mac: right-click Terminal → Quit; Windows: close all PowerShell processes) and reopen. |
| `401 Unauthorized` error | API Key is wrong or expired. If using `ANTHROPIC_API_KEY`, confirm the `Bearer ` prefix is present. If using `ANTHROPIC_AUTH_TOKEN`, set it to the raw Key with no prefix. Check your key in the kie.ai dashboard. |
| `model not found` error | Inside Claude, run `/model` and switch to a model supported by kie.ai. |
| Windows — changes still not working | Close **all** terminals, including built-in terminals in VSCode, Cursor, and other editors. Fully quit those apps and relaunch. |

To inspect the actual requests Claude Code sends, start with `claude --debug` and review the detailed logs.

---

## Security Tips

- Keep your API Key private — **never** share it in screenshots, chat groups, or code repositories.
- If the settings file lives inside a project directory, add `.claude/settings.json` to `.gitignore`. Files placed in your home directory (`~/.claude/`) are safe by default.
- If your key is compromised, reset it immediately from the kie.ai dashboard.

---

If you have any questions, feel free to reach out.

