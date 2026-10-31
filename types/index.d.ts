export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = { content: string; active: string; status: TaskStatus }

export type Tasks = { title: string; items: Task[] }

export type Helper = {
  id: string
  description: string
  type: string
  model: string
  tokens: number
  cost: number
  startedAt: number
  endedAt: number | null
  status: 'running' | 'done' | 'failed'
  steps: number
  recent: string[]
  hue: number
}

export type Totals = { cost: number; tokens: number }

declare module 'claude-code' {
  interface PluginState {
    'helper-desk': {
      tasks: Shaped<Tasks | null>
      helpers: Shaped<Helper[]>
      totals: Totals
      isBandHidden: boolean
      now: number
    }
  }
}
