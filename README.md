# Command Centre Mod for Claude Code

> Part of the **Automators+** library -- Claude Code skills and mods shared exclusively with the Automators+ community.

A `/centre` pane with one-press buttons for the prompts you type over and over, plus every skill and slash
command you have.

## What You Get

- **Find my prompts** -- reads your last 30 Claude Code sessions, asks Haiku which prompts you repeat most and turns the top 8 into buttons
- **One press** -- a button sends its prompt straight into the chat
- **Save prompt** -- type a prompt in the box, press **+ Save prompt** and it becomes a button with a short label
- **Remove** -- the **x** next to any button
- **Skills tab** -- every skill, plugin command, MCP command and built-in command, one press each

## Requirements

- Claude Code v2.1.287 or later in the terminal, or the Code tab of the Claude Desktop app on v2.1.286 or later. Enter `/status` to check your version
- Mods draw in the terminal and the Desktop app. The VS Code extension's chat panel runs them but doesn't show them

## Install

In your terminal:

```
claude plugin marketplace add automatorsplus/command-centre-mod
claude plugin install command-centre@command-centre-mod
```

Or from inside a Claude Code session, in one line:

```
/plugin install command-centre --marketplace automatorsplus/command-centre-mod
```

Then start a new session, or run `/reload-plugins`. To turn it off later, open `/plugin`, go to the **Installed** tab and disable it.

## Try It

Type `/centre`. The pane opens empty the first time: press **Find my prompts** and give it a few seconds. Then press
any button to send that prompt, or switch to **Skills**.

## What It Reads

**Find my prompts** only runs when you press it. It reads the prompts you typed in `~/.claude/projects` on your own
machine and sends up to 400 of them to Haiku through your Claude Code account, which picks the repeats. Your saved
buttons stay on your machine.

## How It Works

Everything is in `hooks/register.tsx`: the history scan, the Haiku call that picks your repeated prompts, the saved
buttons and the Skills list.

---

*Shared with the Automators+ community*
