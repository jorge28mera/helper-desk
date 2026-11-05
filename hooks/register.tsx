import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Helper, Task, TaskStatus, Tasks, Totals } from '../types'

const PANE = 'helper-desk'
const BAND_COLOR = '#8b5cf6'
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
// The desktop app's wrap-up checks off whatever is left of the task list.
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const tasks = atom({ plugin: 'helper-desk', key: 'tasks' } as const, null, {
  shape: 'tasks-1',
})
const helpers = atom({ plugin: 'helper-desk', key: 'helpers' } as const, [], {
  shape: 'helpers-1',
})
const totals = atom({ plugin: 'helper-desk', key: 'totals' } as const, {
  cost: 0,
  tokens: 0,
})
const isBandHidden = atom(
  { plugin: 'helper-desk', key: 'isBandHidden' } as const,
  false,
)
const now = atom({ plugin: 'helper-desk', key: 'now' } as const, 0)

// Dollars per million tokens. Cache writes are estimated at 1.25x input.
const PRICES: Array<[RegExp, { input: number; output: number; read: number }]> =
  [
    [/fable|mythos/, { input: 10, output: 50, read: 0.25 }],
    [/opus/, { input: 4, output: 20, read: 0.2 }],
    [/sonnet/, { input: 2, output: 10, read: 0.2 }],
    [/haiku/, { input: 0.1, output: 0.5, read: 0.01 }],
  ]

type Usage = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const tokensOf = (u: Usage): number =>
  u.input_tokens +
  u.output_tokens +
  u.cache_read_input_tokens +
  u.cache_creation_input_tokens

const costOf = (u: Usage): number => {
  const price = (PRICES.find(([re]) => re.test(u.model)) ?? PRICES[1])?.[1]

  if (price === undefined) {
    return 0
  }

  return (
    (u.input_tokens * price.input +
      u.output_tokens * price.output +
      u.cache_read_input_tokens * price.read +
      u.cache_creation_input_tokens * price.input * 1.25) /
    1_000_000
  )
}

// Body colors for the crabs, in spawn order.
const HUES = ['#e8604c', '#e8873c', '#4a6ee0', '#e0507a', '#3fae6a', '#a35ce0']

const short = (text: string, max: number): string => {
  const line = text.split('\n')[0] ?? ''

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// "Reading pre-outline.md", "Running npm test": one line per tool call.
const activityOf = (tool: string, input: Record<string, unknown>): string => {
  const str = (key: string): string =>
    typeof input[key] === 'string' ? (input[key] as string) : ''
  const base = (path: string): string => path.split('/').pop() ?? path

  switch (tool) {
    case 'Read':
      return `Reading ${base(str('file_path'))}`
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${base(str('file_path'))}`
    case 'Write':
      return `Writing ${base(str('file_path'))}`
    case 'Bash':
      return `Running ${short(str('command'), 40)}`
    case 'Grep':
    case 'Glob':
      return `Searching ${short(str('pattern'), 40)}`
    case 'WebSearch':
      return `Searching the web: ${short(str('query'), 40)}`
    case 'WebFetch':
      return `Reading ${short(str('url').replace(/^https?:\/\//, ''), 40)}`
    case 'Skill':
      return `Using the ${str('skill')} skill`
    case 'Agent':
      return `Starting a helper: ${short(str('description'), 40)}`
    case 'SubagentHandback':
      return 'Handing back results'
    default:
      return tool.startsWith('mcp__')
        ? `Calling ${tool.split('__').slice(1).join(' › ')}`
        : `Using ${tool}`
  }
}

// The desktop app's task list: a whole list, or a step moved along it.
const applyPlan = (
  list: Task[],
  input: Record<string, unknown>,
): Task[] | null => {
  if (Array.isArray(input.items)) {
    return input.items.flatMap(item => {
      const { content, status } = (item ?? {}) as Record<string, unknown>

      return typeof content === 'string'
        ? [
            {
              content,
              active: content,
              status: (status as TaskStatus | undefined) ?? 'pending',
            },
          ]
        : []
    })
  }

  if (list.length === 0) {
    return null
  }

  let next = list.map(task => ({ ...task }))

  if (input.advance === true) {
    const at = next.findIndex(task => task.status === 'in_progress')

    if (at >= 0) {
      next[at]!.status = 'completed'
    }

    const pending = next.findIndex(task => task.status === 'pending')

    if (pending >= 0) {
      next[pending]!.status = 'in_progress'
    }
  }

  if (Array.isArray(input.done)) {
    for (const n of input.done) {
      if (typeof n === 'number' && next[n - 1]) {
        next[n - 1]!.status = 'completed'
      }
    }
  }

  if (typeof input.start === 'number' && next[input.start - 1]) {
    next = next.map(task =>
      task.status === 'in_progress' ? { ...task, status: 'pending' } : task,
    )
    next[input.start - 1]!.status = 'in_progress'
  }

  return next
}

const money = (n: number): string => `$${n < 10 ? n.toFixed(2) : n.toFixed(1)}`

const kilo = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : `${n}`

const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const bar = (fraction: number, width: number): string => {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// Mixes a hex color toward white by `amount` (0 to 1), for the bright end of a gradient.
const lighten = (hex: string, amount: number): string => {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)

  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`
}

// A liquid-glass bar for graphical surfaces: a glowing gradient fill in a frosted track,
// with a glass capsule riding the leading edge. Drawn wider than any slot so it shrinks to fit.
const barSvg = (fraction: number, color: string): string => {
  const f = Math.min(1, Math.max(0, fraction))
  const fill = Math.max(8, Math.round(f * 592))
  const knob = Math.min(578, Math.max(22, 4 + fill))
  const bright = lighten(color, 0.45)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="67" viewBox="0 0 600 20">` +
    `<defs>` +
    `<linearGradient id="fill" x1="0" x2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${bright}"/></linearGradient>` +
    `<linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.7"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.15"/><stop offset="1" stop-color="#fff" stop-opacity="0.35"/></linearGradient>` +
    `<filter id="glow" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `</defs>` +
    `<rect x="4" y="6" width="592" height="8" rx="4" fill="#fff" fill-opacity="0.08" stroke="#fff" stroke-opacity="0.18" stroke-width="0.6"/>` +
    `<rect x="4" y="6" width="${fill}" height="8" rx="4" fill="url(#fill)" filter="url(#glow)"/>` +
    `<rect x="7" y="7" width="${Math.max(2, fill - 6)}" height="2" rx="1" fill="#fff" fill-opacity="0.35"/>` +
    (f > 0 && f < 1
      ? `<rect x="${knob - 18}" y="1.5" width="36" height="17" rx="8.5" fill="${bright}" fill-opacity="0.35" filter="url(#glow)"/>` +
        `<rect x="${knob - 18}" y="1.5" width="36" height="17" rx="8.5" fill="url(#glass)" stroke="#fff" stroke-opacity="0.7" stroke-width="0.8"/>` +
        `<rect x="${knob - 13}" y="3.5" width="26" height="4" rx="2" fill="#fff" fill-opacity="0.6"/>`
      : '') +
    `</svg>`
  )
}

// The band's bar: one glass pill per task. Done ones glow, the current one is a glass
// capsule, the rest are frosted track. Drawn at its own pixel size so it never stretches.
const segmentsSvg = (items: Task[], color: string) => {
  const gap = 4
  const pill = items.length <= 8 ? 30 : Math.max(10, Math.floor(260 / items.length) - gap)
  const width = items.length * (pill + gap) - gap + 8
  const height = 18
  const bright = lighten(color, 0.45)

  const pills = items.map((task, i) => {
    const x = 4 + i * (pill + gap)

    if (task.status === 'completed') {
      return (
        `<rect x="${x}" y="4" width="${pill}" height="10" rx="5" fill="url(#fill)" filter="url(#glow)"/>` +
        `<rect x="${x + 3}" y="5" width="${pill - 6}" height="2.5" rx="1.2" fill="#fff" fill-opacity="0.35"/>`
      )
    }

    if (task.status === 'in_progress') {
      return (
        `<rect x="${x}" y="3" width="${pill}" height="12" rx="6" fill="${bright}" fill-opacity="0.4" filter="url(#glow)"/>` +
        `<rect x="${x}" y="3" width="${pill}" height="12" rx="6" fill="url(#glass)" stroke="#fff" stroke-opacity="0.75" stroke-width="0.8"/>` +
        `<rect x="${x + 4}" y="4.5" width="${pill - 8}" height="3" rx="1.5" fill="#fff" fill-opacity="0.6"/>`
      )
    }

    return `<rect x="${x}" y="4" width="${pill}" height="10" rx="5" fill="#fff" fill-opacity="0.08" stroke="#fff" stroke-opacity="0.2" stroke-width="0.6"/>`
  })

  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>` +
    `<linearGradient id="fill" gradientUnits="userSpaceOnUse" x1="0" x2="${width}"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${bright}"/></linearGradient>` +
    `<linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.7"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.15"/><stop offset="1" stop-color="#fff" stop-opacity="0.35"/></linearGradient>` +
    `<filter id="glow" x="-20%" y="-100%" width="140%" height="300%"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `</defs>${pills.join('')}</svg>`

  return { source, width, height }
}

// A running helper's bar creeps toward 90% with every step; done is full.
const progressOf = (helper: Helper): number =>
  helper.status === 'running' ? Math.min(0.9, helper.steps / (helper.steps + 6)) : 1

// Claude's mascot, as it appears on Claude Code's welcome screen.
const CRAB = [' ▐▛███▜▌', '▝▜█████▛▘', '  ▘▘ ▝▝']

// Which quarters of a cell each block character fills: top-left, top-right, bottom-left, bottom-right.
const QUARTERS: Record<string, [boolean, boolean, boolean, boolean]> = {
  '▘': [true, false, false, false],
  '▝': [false, true, false, false],
  '▌': [true, false, true, false],
  '▐': [false, true, false, true],
  '▛': [true, true, true, false],
  '▜': [true, true, false, true],
  '█': [true, true, true, true],
}

// A pixel of a hat or a held item: x, y, width, height, color, on the crab's grid.
type Pixel = [number, number, number, number, string]

// Each job gets a character: a hat on its head and something in its right claw.
// `hat` and `item` are the terminal's version of the same drawing.
type Character = {
  name: string
  pixels: Pixel[]
  hat: string[]
  hatColor: string
  item: string
  itemColor: string
}

const CHARACTERS: { match: RegExp; character: Character }[] = [
  {
    match: /explore/i,
    character: {
      name: 'Explorer',
      pixels: [
        [4, -4, 10, 1, '#d4b483'],
        [3, -3, 12, 2, '#d4b483'],
        [3, -1.6, 12, 0.6, '#8a6d3b'],
        [1, -1, 16, 1, '#d4b483'],
        [17, 2.5, 1, 1, '#7a5230'],
        [18, 1.5, 1, 1, '#7a5230'],
        [18.5, -2, 4, 4, '#6b6b6b'],
        [19.5, -1, 2, 2, '#bfe3ff'],
      ],
      hat: ['  ▄███▄', ' ▀▀▀▀▀▀▀'],
      hatColor: '#d4b483',
      item: '⌕',
      itemColor: '#bfe3ff',
    },
  },
  {
    match: /plan/i,
    character: {
      name: 'Architect',
      pixels: [
        [8, -5, 2, 1, '#f2c230'],
        [5, -4, 8, 1, '#f2c230'],
        [3, -3, 12, 2, '#f2c230'],
        [1, -1, 16, 1, '#d9a91a'],
        [17.5, -1.5, 5, 0.8, '#2c56ad'],
        [18, -1, 4, 5, '#3a6fd8'],
        [18.5, 0, 3, 0.4, '#ffffff'],
        [18.5, 1.2, 3, 0.4, '#ffffff'],
        [18.5, 2.4, 2, 0.4, '#ffffff'],
      ],
      hat: ['  ▄▟█▙▄', ' ▀▀▀▀▀▀▀'],
      hatColor: '#f2c230',
      item: '▤',
      itemColor: '#3a6fd8',
    },
  },
  {
    match: /guide|review|analy|quality|qa/i,
    character: {
      name: 'Professor',
      pixels: [
        [1, -3, 16, 1, '#3d3d52'],
        [4, -2, 10, 2, '#3d3d52'],
        [15, -2, 0.7, 2.5, '#e9b949'],
        [14.7, 0.5, 1.3, 1, '#e9b949'],
        [18, 0, 4, 4.5, '#b03a2e'],
        [21.3, 0.5, 0.7, 3.5, '#f5ecd7'],
      ],
      hat: [' ▄▄▄▄▄▄▄▖', '  ▐███▌ ▘'],
      hatColor: '#8a8aa8',
      item: '▥',
      itemColor: '#b03a2e',
    },
  },
  {
    match: /design|brand|content|voice|statusline|art/i,
    character: {
      name: 'Artist',
      pixels: [
        [9, -4, 1, 1, '#7b2d8e'],
        [5, -3, 9, 1, '#7b2d8e'],
        [3, -2, 13, 2, '#7b2d8e'],
        [17, 2, 1, 1, '#c49a6c'],
        [18, 1, 1, 1, '#c49a6c'],
        [19, 0, 1, 1, '#c49a6c'],
        [20, -1, 1, 1, '#aaaaaa'],
        [21, -2.2, 1.2, 1.2, '#3fae6a'],
      ],
      hat: ['    ▗▖', '  ▄████▄▖'],
      hatColor: '#a35ce0',
      item: '╱',
      itemColor: '#3fae6a',
    },
  },
  {
    match: /general|claude|fork/i,
    character: {
      name: 'Handyman',
      pixels: [
        [8, -4, 2, 1, '#1f8a8a'],
        [4, -3, 10, 1, '#1f8a8a'],
        [3, -2, 11, 2, '#1f8a8a'],
        [14, -1, 5, 1, '#166b6b'],
        [17, 2, 1, 1, '#9aa5b1'],
        [18, 1, 1, 1, '#9aa5b1'],
        [19, -2, 1, 2, '#9aa5b1'],
        [21, -2, 1, 2, '#9aa5b1'],
        [19, 0, 3, 1, '#9aa5b1'],
      ],
      hat: ['  ▄███▄', '  ████▀▀▀'],
      hatColor: '#1f8a8a',
      item: '┳',
      itemColor: '#9aa5b1',
    },
  },
]

const BUTLER: Character = {
  name: 'Butler',
  pixels: [
    [5, -5, 8, 4, '#4b4b5c'],
    [5, -2, 8, 0.8, '#e0507a'],
    [3, -1, 12, 1, '#4b4b5c'],
    [18, 0, 3, 3.5, '#6f4e37'],
    [21, 0.8, 1, 1.6, '#6f4e37'],
    [18.5, -1.5, 0.6, 1, '#cccccc'],
    [20, -2, 0.6, 1, '#cccccc'],
  ],
  hat: ['   ▐██▌', '  ▀▀▀▀▀▀'],
  hatColor: '#8a8aa8',
  item: '▢',
  itemColor: '#a0785a',
}

const characterOf = (type: string): Character =>
  CHARACTERS.find(entry => entry.match.test(type))?.character ?? BUTLER

// The same crab as pixels, each quarter 1 wide and 1.5 tall like a terminal cell,
// with the character's hat above and its item beside the right claw.
const crabSvg = (color: string, character: Character): string => {
  const rects = CRAB.flatMap((line, row) =>
    [...line].flatMap((char, col) =>
      (QUARTERS[char] ?? []).flatMap((isOn, q) =>
        isOn ? [`<rect x="${col * 2 + (q % 2)}" y="${row * 3 + Math.floor(q / 2) * 1.5}" width="1" height="1.5"/>`] : [],
      ),
    ),
  )
  const extras = character.pixels.map(
    ([x, y, w, ht, fill]) => `<rect x="${x}" y="${y}" width="${w}" height="${ht}" fill="${fill}"/>`,
  )

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -5 23 14" shape-rendering="crispEdges">` +
    `<g fill="${color}">${rects.join('')}</g>${extras.join('')}</svg>`
  )
}

export const register: Register = on => {
  let title = 'Current task'
  // A message sent mid-turn adds to the work under way; it doesn't rename it.
  let isTurnOpen = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'helpers',
      description: 'Show the subagent panel',
    })

    // Keeps the elapsed times moving while any helper runs.
    $.clock.every(1000, async () => {
      const list = await read($, helpers)

      if (list.some(helper => helper.status === 'running')) {
        await update($, now, () => Date.now())
      }
    })

    return next(e)
  })

  on('command.run', { command: 'helpers' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Helpers' })

    return { text: 'Helper panel opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const first = e.text.trim().split('\n')[0]?.replace(/\s+/g, ' ') ?? ''

    if (!isTurnOpen && first.length > 0) {
      title = first[0]!.toUpperCase() + first.slice(1)
    }

    isTurnOpen = true

    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)

    if (spawned.deny === undefined && spawned.agentId !== undefined) {
      const startedAt = Date.now()
      const helper: Helper = {
        id: spawned.agentId,
        description: e.description,
        type: e.subagentType,
        model: spawned.model,
        tokens: 0,
        cost: 0,
        startedAt,
        endedAt: null,
        status: 'running',
        steps: 0,
        recent: ['Starting up'],
        hue: 0,
      }

      await update($, helpers, list => [
        ...list,
        { ...helper, hue: list.length % HUES.length },
      ])
      await update($, now, () => startedAt)
      void $.ui.open({ id: PANE, title: 'Helpers' })
    }

    return spawned
  }).catch(($, e, next) => next(e))

  // Every model request: its tokens and estimated cost, charged to its loop.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const usage = response.usage

    if (usage !== null) {
      const tokens = tokensOf(usage)
      const cost = costOf(usage)

      await update($, totals, (t: Totals) => ({
        cost: t.cost + cost,
        tokens: t.tokens + tokens,
      }))

      if (e.agentId !== undefined) {
        await update($, helpers, list =>
          list.map(helper =>
            helper.id === e.agentId
              ? { ...helper, tokens: helper.tokens + tokens, cost: helper.cost + cost }
              : helper,
          ),
        )
      }
    }

    return response
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>

    if (e.agentId !== undefined) {
      const activity = activityOf(e.tool, input)

      await update($, helpers, list =>
        list.map(helper =>
          helper.id === e.agentId
            ? {
                ...helper,
                steps: helper.steps + 1,
                recent: [...helper.recent, activity].slice(-2),
              }
            : helper,
        ),
      )
    } else if (e.tool === 'TodoWrite') {
      const items: Task[] = e.todos.map(todo => ({
        content: todo.content,
        active: todo.activeForm,
        status: todo.status,
      }))

      await update($, tasks, () => ({ title, items }))
      await update($, isBandHidden, () => false)
    } else if (e.tool === PLAN_TOOL) {
      const current = await read($, tasks)
      const items = applyPlan(current?.items ?? [], input)

      if (items !== null) {
        const name = Array.isArray(input.items) ? title : (current?.title ?? title)

        await update($, tasks, () => ({ title: name, items }))

        if (Array.isArray(input.items)) {
          await update($, isBandHidden, () => false)
        }
      }
    } else if (e.tool === WRAP_TOOL) {
      await update($, tasks, current =>
        current === null
          ? current
          : { ...current, items: current.items.map((task): Task => ({ ...task, status: 'completed' })) },
      )
    }

    const ran = await next(e)

    // A foreground helper has finished once its Agent call returns.
    if (e.agentId === undefined && e.tool === 'Agent') {
      const live = await $.agent.list()

      await update($, helpers, list =>
        list.map((helper): Helper => {
          const info = live.find(one => one.id === helper.id)

          if (helper.status !== 'running' || info === undefined) {
            return helper
          }

          if (info.status === 'completed') {
            return { ...helper, status: 'done', endedAt: Date.now() }
          }

          return info.status === 'failed' || info.status === 'killed'
            ? { ...helper, status: 'failed', endedAt: Date.now() }
            : helper
        }),
      )
    }

    return ran
  }).catch(($, e, next) => next(e))

  // A helper's own turn ending means it has answered.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnOpen = false
    } else {
      const status: Helper['status'] =
        e.reason === 'answer' ? 'done' : 'failed'

      await update($, helpers, list =>
        list.map(helper =>
          helper.id === e.agentId && helper.status === 'running'
            ? { ...helper, status, endedAt: Date.now() }
            : helper,
        ),
      )
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // What other mods draw here stays, under the band, so the band never hides them.
    const below = await next(e)
    const current = await read($, tasks)
    const isHidden = await read($, isBandHidden)

    if (e.props.hasSurvey || current === null || isHidden) {
      return below
    }

    const total = current.items.length
    const done = current.items.filter(t => t.status === 'completed').length

    if (total === 0 || done === total) {
      return below
    }

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // The terminal's table names Svg but draws it as nothing, so it gets text instead.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const working = current.items.find(t => t.status === 'in_progress')
    const segments = segmentsSvg(current.items, BAND_COLOR)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" justifyContent="space-between">
            <Box flexDirection="row" flexShrink={1}>
              <Text color={BAND_COLOR}>● </Text>
              <Text bold>{short(current.title, 56)}</Text>
            </Box>
            <Button
              key="hide"
              label="×"
              onPress={() => update($, isBandHidden, () => true)}
            />
          </Box>
          <Box flexDirection="row" alignItems="center">
            <Box key="band-bar" flexShrink={0} marginRight={1}>
              {Svg ? (
                <Svg
                  source={segments.source}
                  alt={`${done} of ${total} done`}
                  width={segments.width}
                  height={segments.height}
                />
              ) : (
                <Text>
                  {current.items.map(task =>
                    task.status === 'completed' ? (
                      <Text color={BAND_COLOR}>▰</Text>
                    ) : task.status === 'in_progress' ? (
                      <Text color="#c4b5fd" bold>▰</Text>
                    ) : (
                      <Text dimColor>▱</Text>
                    ),
                  )}
                </Text>
              )}
            </Box>
            <Box flexShrink={0}>
              <Text dimColor>
                {done}/{total}
              </Text>
            </Box>
            {working !== undefined && (
              <Box flexShrink={1} marginLeft={1}>
                <Text dimColor>· Now: </Text>
                <Text>{short(working.active, 60)}</Text>
              </Box>
            )}
          </Box>
        </Box>
        {below ? below : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, helpers)
    const sum = await read($, totals)
    const at = Math.max(await read($, now), Date.now())
    const running = list.filter(helper => helper.status === 'running')
    const finished = list.filter(helper => helper.status !== 'running')
    const width = Math.max(8, e.props.bodyColumns - 6)

    // Only desktop and VS Code draw SVG; the terminal's table names Svg but draws nothing, so it gets text.
    const ui = $.ui.resolve(e)
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null

    const crab = (helper: Helper) => {
      const color = HUES[helper.hue] ?? '#e8604c'
      const character = characterOf(helper.type)

      if (Svg) {
        return (
          <Box marginRight={1}>
            <Svg source={crabSvg(color, character)} alt={character.name} width={46} height={28} />
          </Box>
        )
      }

      return (
        <Box flexDirection="column" marginRight={1}>
          {character.hat.map(line => (
            <Text color={character.hatColor}>{line}</Text>
          ))}
          {CRAB.map((line, row) => (
            <Text color={color}>
              {line}
              {row === 1 ? <Text color={character.itemColor}>{character.item}</Text> : row === 0 ? '  ' : ''}
            </Text>
          ))}
        </Box>
      )
    }

    const card = (helper: Helper) => {
      const color = HUES[helper.hue] ?? '#e8604c'
      const elapsed = (helper.endedAt ?? at) - helper.startedAt
      const state =
        helper.status === 'running'
          ? `Step ${helper.steps}`
          : helper.status === 'done'
            ? `Done · ${helper.steps} steps`
            : 'Stopped'

      return (
        <Box
          key={`h-${helper.id}`}
          flexDirection="column"
          borderStyle="round"
          borderColor={helper.status === 'running' ? color : 'subtle'}
          paddingX={1}
          marginBottom={1}
        >
          <Box flexDirection="row">
            {crab(helper)}
            <Box flexDirection="column" flexGrow={1}>
              <Text bold>
                {short(helper.description, 28)}
                {helper.status === 'done' ? ' ✓' : helper.status === 'failed' ? ' ✗' : ''}
              </Text>
              <Text dimColor>
                {characterOf(helper.type).name} · {helper.type} · {helper.model.replace(/^claude-/, '')}
              </Text>
              <Text dimColor>
                {kilo(helper.tokens)} tokens · {money(helper.cost)} · {clock(elapsed)}
              </Text>
            </Box>
          </Box>
          <Text color={helper.status === 'done' ? 'success' : color}>{state}</Text>
          {helper.recent.map(line => (
            <Text dimColor>{short(line, width)}</Text>
          ))}
          {Svg ? (
            <Box key={`bar-${helper.id}`} marginY={1}>
              <Svg source={barSvg(progressOf(helper), color)} alt={`${Math.round(progressOf(helper) * 100)}%`} />
            </Box>
          ) : (
            <Text color={color}>{bar(progressOf(helper), width)}</Text>
          )}
          <Button
            key={`view-${helper.id}`}
            label="Open transcript"
            onPress={() => $.ui.view({ agentId: helper.id })}
          />
        </Box>
      )
    }

    // How long helpers have been at work: from the first start to the last finish, or now.
    const span =
      list.length === 0
        ? 0
        : Math.max(...list.map(helper => helper.endedAt ?? at)) - Math.min(...list.map(helper => helper.startedAt))

    const kpi = (label: string, value: string) => (
      <Box
        key={`kpi-${label}`}
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor="subtle"
        paddingX={1}
      >
        <Text dimColor>{label}</Text>
        <Text bold color="#e8873c">
          {value}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold>
          {list.length} helper{list.length === 1 ? '' : 's'} in this chat
        </Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1} marginY={1}>
          {kpi('Chat cost', `~${money(sum.cost)}`)}
          {kpi('Helper tokens', kilo(list.reduce((n, helper) => n + helper.tokens, 0)))}
          {kpi('Time', clock(span))}
        </Box>
        {list.length === 0 && (
          <Text dimColor>No helpers yet. They show up here as they start.</Text>
        )}
        {running.length > 0 && (
          <Text color="success" bold>
            ▾ Running · {running.length}
          </Text>
        )}
        {running.map(card)}
        {finished.length > 0 && (
          <Text dimColor bold>
            ▾ Finished · {finished.length}
          </Text>
        )}
        {finished.map(card)}
      </Box>
    )
  })
}
