import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CentreTab, SavedPrompt } from '../types'

const PANE = 'command-centre'
const TITLE = 'Command Centre'
const STORE_KEY = 'prompts'
const SESSIONS = 30
const MAX_CHARS = 500
const FIND_COUNT = 8

// Raw colours so the pane looks the same on any theme.
const ACCENT = '#a78bfa'
const SOURCE_COLOUR: Record<string, string> = {
  user: '#34d399',
  plugin: '#60a5fa',
  mcp: '#f472b6',
  builtin: '#9ca3af',
}
const SOURCE_LABEL: Record<string, string> = { user: 'skill', plugin: 'plugin', mcp: 'mcp', builtin: 'built-in' }

function statusColour(text: string) {
  if (/^(Saved|Found)/.test(text)) return '#34d399'
  if (/(not|No |Could not|empty)/.test(text)) return '#f87171'
  return '#fbbf24'
}

const prompts = atom({ plugin: 'command-centre', key: 'prompts' } as const, [])
const tab = atom({ plugin: 'command-centre', key: 'tab' } as const, 'prompts')
const status = atom({ plugin: 'command-centre', key: 'status' } as const, '')
const page = atom({ plugin: 'command-centre', key: 'page' } as const, 0)

// Matches a transcript line whose user content is a plain string: something typed, not a tool result.
const TYPED = '"message":{"role":"user","content":"'

async function savePrompts($: EngineInterface, list: SavedPrompt[]) {
  await $.store.set(STORE_KEY, list)
  await update($, prompts, () => list)
}

async function setStatus($: EngineInterface, text: string) {
  await update($, status, () => text)
}

async function newId($: EngineInterface, n: number) {
  return `${await $.clock.now()}-${n}`
}

async function transcriptFiles($: EngineInterface) {
  const home = await $.env.get('HOME')
  if (!home) return []
  const root = `${home}/.claude/projects`
  const dirs = (await $.fs.list(root).catch(() => [])).filter(d => d.kind === 'dir')
  const files: { path: string; mtimeMs: number; size: number }[] = []
  for (const dir of dirs) {
    const entries = await $.fs.list(`${root}/${dir.name}`).catch(() => [])
    for (const f of entries) {
      if (f.kind === 'file' && f.name.endsWith('.jsonl')) {
        files.push({ path: `${root}/${dir.name}/${f.name}`, mtimeMs: f.mtimeMs, size: f.size })
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

async function typedLines($: EngineInterface, path: string, size: number) {
  // grep keeps big transcripts out of memory; a host without grep falls back to reading files under 4 MiB.
  const ran = await $.process.run(['grep', '-F', TYPED, path]).catch(() => null)
  if (ran && ran.exitCode <= 1) return ran.stdout.split('\n')
  if (size > 4 * 1024 * 1024) return []
  const text = await $.fs.read(path).catch(() => '')
  return String(text).split('\n').filter(l => l.includes(TYPED))
}

function typedText(line: string) {
  try {
    const o = JSON.parse(line)
    if (o.type !== 'user' || o.isMeta || o.isSidechain) return null
    if (typeof o.entrypoint === 'string' && o.entrypoint.startsWith('sdk')) return null
    const text = o.message?.content
    if (typeof text !== 'string') return null
    const clean = text.trim()
    if (!clean || clean.length > MAX_CHARS) return null
    if (clean.startsWith('<') || clean.startsWith('[')) return null
    return clean
  } catch {
    return null
  }
}

async function findPrompts($: EngineInterface) {
  await setStatus($, 'Reading your recent sessions...')
  const files = await transcriptFiles($)
  const counts = new Map<string, number>()
  let sessions = 0
  for (const f of files) {
    if (sessions >= SESSIONS) break
    const lines = await typedLines($, f.path, f.size)
    const texts = lines.map(typedText).filter((t): t is string => t !== null)
    if (texts.length === 0) continue
    sessions += 1
    for (const t of texts) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  if (counts.size === 0) {
    await setStatus($, 'No typed prompts found in your recent sessions.')
    return
  }

  await setStatus($, `Found ${counts.size} prompts in ${sessions} sessions. Asking the model...`)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400)
  const listing = ranked.map(([t, n]) => `(${n}x) ${t.replace(/\s+/g, ' ')}`).join('\n')
  const result = await $.model.complete({
    model: 'haiku',
    maxTokens: 2000,
    system: 'You find the prompts a person repeats. Reply with JSON only.',
    prompt: [
      `Below are prompts one person typed into Claude Code, with how often each exact text appeared.`,
      `Find the ${FIND_COUNT} prompts they repeat most, counting near-duplicates and rewordings of the same ask together.`,
      `Skip one-off replies like yes, ok, thanks, or answers to a question.`,
      `For each, give a short button label (2 to 4 words) and the full prompt to send, written the way they usually phrase it.`,
      `Reply with only a JSON array: [{"label": "...", "prompt": "..."}]`,
      '',
      listing,
    ].join('\n'),
  })
  if (!result.isAnswered) {
    await setStatus($, `The model did not answer (${result.reason}). Try again.`)
    return
  }
  const match = result.text.match(/\[[\s\S]*\]/)
  let found: { label?: unknown; prompt?: unknown }[] = []
  try {
    found = match ? JSON.parse(match[0]) : []
  } catch {
    found = []
  }
  const list: SavedPrompt[] = []
  for (const item of found.slice(0, FIND_COUNT)) {
    if (typeof item.label === 'string' && typeof item.prompt === 'string' && item.prompt.trim()) {
      list.push({ id: await newId($, list.length), label: item.label.slice(0, 40), prompt: item.prompt })
    }
  }
  if (list.length === 0) {
    await setStatus($, 'Could not read the model reply. Try again.')
    return
  }
  await savePrompts($, [...(await read($, prompts)), ...list])
  await setStatus($, `Saved ${list.length} prompts.`)
}

async function labelFor($: EngineInterface, text: string) {
  const fallback = text.replace(/\s+/g, ' ').split(' ').slice(0, 4).join(' ').slice(0, 40)
  const result = await $.model.complete({
    model: 'haiku',
    maxTokens: 30,
    prompt: `Give a 2 to 4 word button label for this prompt. Reply with the label only, no quotes.\n\n${text}`,
  })
  if (!result.isAnswered) return fallback
  const label = result.text.trim().replace(/^["']|["']$/g, '').slice(0, 40)
  return label || fallback
}

async function saveFromBox($: EngineInterface) {
  const { text } = await $.prompt.read()
  const prompt = text.trim()
  if (!prompt) {
    await setStatus($, 'The prompt box is empty. Type a prompt first, then press Save prompt.')
    return
  }
  await setStatus($, 'Saving...')
  const label = await labelFor($, prompt)
  const list = await read($, prompts)
  await savePrompts($, [...list, { id: await newId($, list.length), label, prompt }])
  await setStatus($, `Saved as ${label}.`)
}

async function removePrompt($: EngineInterface, id: string) {
  const list = await read($, prompts)
  await savePrompts($, list.filter(p => p.id !== id))
}

async function switchTab($: EngineInterface, to: CentreTab) {
  await update($, tab, () => to)
  await update($, page, () => 0)
  await setStatus($, '')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    await update($, prompts, () => (Array.isArray(stored) ? (stored as SavedPrompt[]) : []))
    await $.command.register({ name: 'centre', description: 'Open the Command Centre: your saved prompts and skills' })
    return next(e)
  })

  on('command.run', { command: 'centre' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: 'Command Centre opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, tab)
    const note = await read($, status)
    const rows = Math.max(3, (e.viewport?.rows ?? 24) - 6)

    const tabs = (
      <Box key="tabs" columnGap={1} marginBottom={1}>
        <Text color={current === 'prompts' ? ACCENT : '#4b5563'}>●</Text>
        <Button
          key="tab-prompts"
          label="My prompts"
          variant="secondary"
          dimColor={current !== 'prompts'}
          hover={{ color: ACCENT }}
          onPress={() => switchTab($, 'prompts')}
        />
        <Text color={current === 'skills' ? ACCENT : '#4b5563'}>●</Text>
        <Button
          key="tab-skills"
          label="Skills"
          variant="secondary"
          dimColor={current !== 'skills'}
          hover={{ color: ACCENT }}
          onPress={() => switchTab($, 'skills')}
        />
      </Box>
    )

    if (current === 'prompts') {
      const list = await read($, prompts)
      return (
        <Box flexDirection="column">
          {tabs}
          {list.length === 0 && (
            <Box flexDirection="column">
              <Text color={ACCENT}>No saved prompts yet.</Text>
              <Box key="find-row">
                <Button key="find" label="Find my prompts" variant="secondary" hover={{ color: ACCENT }} onPress={() => findPrompts($)} />
              </Box>
            </Box>
          )}
          {list.slice(0, rows).map(p => (
            <Box key={`row-${p.id}`} columnGap={1}>
              <Text color={ACCENT}>›</Text>
              <Button key={`send-${p.id}`} label={p.label} variant="secondary" hover={{ color: ACCENT }} onPress={() => $.prompt.submit({ text: p.prompt, asUser: true })} />
              <Button key={`remove-${p.id}`} label="x" dimColor hover={{ color: '#f87171' }} onPress={() => removePrompt($, p.id)} />
            </Box>
          ))}
          {list.length > rows && <Text dimColor>{list.length - rows} more: make the pane taller to see them.</Text>}
          <Box key="save-row" marginTop={1}>
            <Button key="save" label="+ Save prompt" variant="secondary" hover={{ color: '#34d399' }} onPress={() => saveFromBox($)} />
          </Box>
          {note !== '' && <Text color={statusColour(note)}>{note}</Text>}
        </Box>
      )
    }

    const commands = await $.command.list()
    const perPage = Math.max(1, rows - 1)
    const pages = Math.max(1, Math.ceil(commands.length / perPage))
    const at = Math.min(await read($, page), pages - 1)
    const shown = commands.slice(at * perPage, (at + 1) * perPage)
    return (
      <Box flexDirection="column">
        {tabs}
        {shown.map(c => (
          <Box key={`cmd-${c.name}`} columnGap={1}>
            <Button key={`run-${c.name}`} label={`/${c.name}`} variant="secondary" hover={{ color: ACCENT }} onPress={() => $.command.run({ command: c.name })} />
            <Text color={SOURCE_COLOUR[c.source] ?? '#9ca3af'}>{SOURCE_LABEL[c.source] ?? c.source}</Text>
            <Text dimColor wrap="truncate-end">{c.description}</Text>
          </Box>
        ))}
        {pages > 1 && (
          <Box key="pager" columnGap={1} marginTop={1}>
            <Button key="prev" label="Prev" hover={{ color: ACCENT }} onPress={() => update($, page, n => Math.max(0, n - 1))} />
            <Text color={ACCENT}>
              Page {at + 1} of {pages}
            </Text>
            <Button key="next" label="Next" hover={{ color: ACCENT }} onPress={() => update($, page, n => Math.min(pages - 1, n + 1))} />
          </Box>
        )}
      </Box>
    )
  })
}
