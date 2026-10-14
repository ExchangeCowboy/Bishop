# Install Bishop Agent on Windows

Bishop runs locally and uses your existing Codex ChatGPT login. You do not need
a separate Bishop account or an API key.

## 1. Install the prerequisites

- **Codex:** Install the [Codex desktop app](https://learn.chatgpt.com/docs/app)
  and sign in with your ChatGPT account. Your account must have access to Codex.
  An existing native Codex CLI signed in with ChatGPT also works.
- **Node.js:** Install [Node.js 24 or newer](https://nodejs.org/en/download).
  Keep npm and the option to add Node.js to PATH enabled during installation.
- **Internet access:** Needed to download dependencies and use the model.

After installing Node.js or Codex, open a new terminal so it sees the updated
environment. Use your normal Windows account; Bishop's installer does not need
administrator privileges.

## 2. Download Bishop

On this GitHub repository, choose **Code → Download ZIP**. Extract the entire ZIP
into a writable folder you intend to keep. Open the extracted folder containing
`install.cmd`, `package.json`, `app`, and `config`.

You can also clone the repository with Git. Git is optional when using the ZIP.

## 3. Run the installer

Double-click **`install.cmd`**. When it finishes, press any key to close its window.

The installer:

1. Checks Node.js 24+ and npm.
2. Finds Codex and verifies its existing ChatGPT login without sending a model request.
3. Downloads Bishop's runtime dependencies using the included lockfile.
4. Registers the `bishop` command on your user PATH.

Keep the extracted folder in place: the command runs Bishop from that folder.
The installer preserves existing settings, personality, and memories. If a check
fails, follow its message and run the installer again.

Alternatively, open PowerShell in the Bishop folder and run:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

To install without adding Bishop to PATH, append `-NoPath` to that command.
The execution-policy setting applies only to this installer process.

## 4. Start Bishop

Open a **new terminal** and run:

```powershell
bishop chat
```

If you used `-NoPath`, open a terminal in the Bishop folder and run:

```powershell
.\bishop.cmd chat
```

On the first launch, Bishop asks about you, its personal name, and its purpose.
Confirm what you want it to remember to finish onboarding. Later launches retain
your saved personality and memory while starting a fresh conversation.

Enter `/help` for commands or `/exit` to quit. Bishop uses the Codex runtime's
default model unless you select a model in `config/bishop.toml`.

## Troubleshooting

**Node.js or npm is missing:** Install Node.js 24+ with npm, then open a new terminal
and rerun the installer. You can check the installation with `node --version` and
`npm.cmd --version`.

**Codex is missing or not signed in:** Open Codex and sign in with ChatGPT. If you
use the CLI, run `codex login` and complete sign-in. See the
[official authentication instructions](https://learn.chatgpt.com/docs/auth).
Bishop requires ChatGPT login rather than API-key login.

**Codex is installed but cannot be found:** In PowerShell, set `BISHOP_CODEX_BIN`
to your actual native executable path, then run the installer from that terminal:

```powershell
$env:BISHOP_CODEX_BIN = 'C:\path\to\codex.exe'
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

That variable applies to the current terminal. Use the same setting when launching
Bishop if your installation needs it. Point to `codex.exe`, not a `.cmd` launcher.

**Dependency installation fails:** Check your internet connection and the npm
error, then rerun the installer. Do not delete `config` or `memory` to retry.

**`bishop` is not recognized:** Open a new terminal. You can also start directly
with `.\bishop.cmd chat` from the Bishop folder. If you moved the folder, rerun
the installer in its new location.

## Settings and local data

Settings live in `config/bishop.toml`; editable personality lives in
`config/personality`. Chat history and the SQLite memory database are created
locally under `memory` as you use Bishop.

Bishop's tools can run commands and edit files with your Windows account's
permissions. Individual tools can be disabled in `config/bishop.toml`.
Relevant conversation, instructions, and tool results are sent through Codex
for model requests.
