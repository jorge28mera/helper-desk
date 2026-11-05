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
    } else {
      // The terminal draws no SVG, so the crab is block characters.
      expect(await ui.find({ type: 'Svg' })).toBeFalsy()
      expect(await ui.find({ type: 'Text', text: /▝▜█████▛▘/ })).toBeTruthy()
    }
    await ui.unmount()
  }
})

test('a to-do list fills the band above the prompt', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

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
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Svg' })).toBeFalsy()
    }
    await ui.unmount()
  }
})

test('the desktop task list advances the band', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

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
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
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

test('the band keeps what other mods draw above the prompt', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Warm · cold in 41:20</Text>
  })

  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'One', status: 'in_progress' },
      { content: 'Two', status: 'pending' },
    ],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /\/2/ }))?.text).toBe('0/2')
  expect((await ui.find({ type: 'Text', text: /cold in/ }))?.text).toBe('Warm · cold in 41:20')
  await ui.unmount()
})

test('wrapping up a turn clears the band', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })

  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'One', status: 'completed' },
      { content: 'Two', status: 'in_progress' },
    ],
  })
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Done.' })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /\/2/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'beneath' }))?.text).toBe('beneath')
  await ui.unmount()
})
