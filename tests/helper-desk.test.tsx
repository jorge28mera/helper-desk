import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'helper-desk',
  component: 'Pane',
  requestId: 'helper-desk',
  props: {
    title: 'Helpers',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'helper-desk',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

test('a helper gets a card with its latest step', async ($, on) => {
  // Each hook here stands for the engine beneath the plugin.
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: {} }))

  await $.agent.spawn({
    prompt: 'Research the topic',
    description: 'Research',
    subagentType: 'Explore',
  })
  await $.tool.call({
    tool: 'Read',
    file_path: '/notes/research.md',
    agentId: 'a1',
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /helper in this chat/ }))?.text).toBe(
      '1 helper in this chat',
    )
    expect((await ui.find({ type: 'Text', text: /Reading/ }))?.text).toBe(
      'Reading research.md',
    )
    expect((await ui.find({ type: 'Text', text: /^Step/ }))?.text).toBe('Step 1')
    expect((await ui.find({ type: 'Text', text: 'Helper tokens' }))?.text).toBe('Helper tokens')
    expect((await ui.find({ type: 'Text', text: 'Time' }))?.text).toBe('Time')
    if (surface === 'desktop') {
      expect(await ui.find({ key: 'bar-a1' })).toBeTruthy()
    }
    await ui.unmount()
  }
})

test('a to-do list fills the band above the prompt', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Research', activeForm: 'Researching', status: 'completed' },
      { content: 'Script', activeForm: 'Writing the script', status: 'in_progress' },
      { content: 'Thumbnails', activeForm: 'Making thumbnails', status: 'pending' },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /\/3/ }))?.text).toBe('1/3')
    expect((await ui.find({ type: 'Text', text: /script/ }))?.text).toBe('Writing the script')
    await ui.unmount()
  }
})

test('the desktop task list advances the band', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'One', status: 'in_progress' },
      { content: 'Two', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /\/2/ }))?.text).toBe('1/2')
  expect((await ui.find({ type: 'Text', text: 'Two' }))?.text).toBe('Two')
  expect(await ui.find({ key: 'band-bar' })).toBeTruthy()
  await ui.unmount()
})

test('a message sent mid-turn keeps the band title', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: [] }))

  await $.prompt.submit({ text: 'build the thumbnail set', asUser: true })
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'One', status: 'in_progress' },
      { content: 'Two', status: 'pending' },
    ],
  })
  await $.prompt.submit({ text: 'also, what does this cost?', asUser: true })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /thumbnail/ }))?.text).toBe('Build the thumbnail set')
  await ui.unmount()
})
