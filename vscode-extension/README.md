# ZenDev Vitals for VS Code

Reads the guard-state file that the ZenDev desktop app writes (`~/.zendev/guard.json`) and puts your live bio-adaptive load in the status bar.

- Status bar: `$(pulse) 12% · flow`, coloured for strain and guardrail.
- Tooltip: load, phase, confidence, whether the guardrail is armed, and when the reading was written.
- Reads are considered stale after 15 seconds, so the item hides when the desktop app is not running.

## Commands

- **ZenDev: Run a command with the guardrail** — asks for a command, and if your load is in strain or guardrail it runs an eight-second breathing gate before offering to send the command to a `ZenDev` terminal. Cancel the gate and nothing runs.
- **ZenDev: Show the current reading** — a one-line summary of the last reading.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `zendev.guardFile` | `~/.zendev/guard.json` | Guard-state file written by the desktop app |
| `zendev.threshold` | `0.72` | Load above which the breathing gate appears |
| `zendev.staleSeconds` | `15` | How long a reading stays valid |

The desktop app writes the file every two seconds while a session is running and nothing leaves the machine.

## Build and install

```sh
cd vscode-extension
npm install
npm run compile
npx @vscode/vsce package
code --install-extension zendev-vitals-0.1.0.vsix
```

Relative load is not a medical measurement. A high number means *different from your own baseline*, not unwell.
