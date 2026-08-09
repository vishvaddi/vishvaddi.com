interface TutorialOptions {
  openDemo: () => void;
  closeDemo: () => void;
}

interface Topic { section: string; title: string; text: string; keys?: string }

const TOPICS: Topic[] = [
  { section: 'Start', title: 'Templates and possession date', keys: 'create begin retail fitout programme', text: 'Choose a template, set the possession date and adjust the target duration. The generated sequence is a starting point: validate every duration and dependency against the project.' },
  { section: 'Tasks', title: 'Task fields', keys: 'name trade duration hours edit', text: 'Each row carries a task name, trade, working-day duration, predecessors and optional labour hours. Dates are calculated outputs; change the logic that drives them rather than typing over them.' },
  { section: 'Tasks', title: 'Milestones', keys: 'zero day possession handover lockup', text: 'A zero-day task is a milestone. Use milestones for possession, approvals, lock-up, practical completion and handover gates.' },
  { section: 'Logic', title: 'FS, SS and FF links', keys: 'dependency predecessor finish start lag', text: 'FS starts the successor after its predecessor finishes. SS starts both in relation to each other. FF aligns their finishes. Add +2 or -1 after a link for positive or negative working-day lag.' },
  { section: 'Logic', title: 'Critical path and float', keys: 'red critical delay slack total float', text: 'Critical tasks have no total float: delaying one delays the current completion date unless another relationship changes. Float is scheduling flexibility, not permission to ignore coordination.' },
  { section: 'Logic', title: 'Why did this task move?', keys: 'recalculate dates changed moved', text: 'The schedule recalculates from possession date, calendars, durations and predecessor links. Check the task’s predecessor text and follow the dependency arrows backwards to find the controlling chain.' },
  { section: 'Editing', title: 'Direct chart editing', keys: 'drag resize link bars handles', text: 'Drag a task bar to change its timing logic, drag an end handle to change duration, or drag between dependency dots to create a link. Use the table when exact values matter.' },
  { section: 'Views', title: 'Chart, table and fullscreen', keys: 'mobile landscape fit zoom screen', text: 'On narrow screens choose Chart or Table. Fullscreen removes the site chrome; Fit recalculates the day width for the current viewport. Zoom overrides Fit when you need detail.' },
  { section: 'Control', title: 'Baseline and variance', keys: 'lock rebaseline delay claim ghost', text: 'Lock a baseline before work starts. Baseline ghosts preserve the accepted dates while the live bars move. Re-baselining destroys that comparison, so it requires typing the programme title.' },
  { section: 'Control', title: 'Look-ahead and procurement', keys: 'three week six week order by lead time', text: 'Look-ahead filters the programme to current work. Procurement lead times generate order-by dates from each linked installation activity.' },
  { section: 'Calendar', title: 'Working week', keys: 'five six day weekend calendar', text: 'The calendar controls working days for every duration and lag. Switch five/six-day mode before relying on calculated dates.' },
  { section: 'Data', title: 'Save, export and privacy', keys: 'json csv png pdf print backup local', text: 'Programmes autosave in this browser. JSON is the editable backup; CSV is for spreadsheets; PNG and Print/PDF are issue formats. Nothing is uploaded.' },
]

const STEPS = [
  ['A disposable working example', 'The tour opens a temporary Retail fitout programme. Change anything you like: it is discarded when the tour closes and never overwrites a saved programme.', '.prog-toolbar'],
  ['Project controls', 'Name the programme and set possession here. The finish date is calculated from task logic and the working calendar.', '.prog-title'],
  ['Read the health line', 'Working days, forecast finish, critical-task count and labour hours update after every edit.', '.prog-stats'],
  ['Edit exact task data', 'Use the table for names, trades, durations, predecessor expressions and labour hours. Zero duration creates a milestone.', '.prog-table-wrap'],
  ['Build dependency logic', 'Predecessors accept FS, SS and FF links with lag—for example 6SS+2. Relationships, not manually typed dates, should drive the programme.', '.pc-pred'],
  ['Read and manipulate the chart', 'Bars show the calculated sequence; dependency arrows expose the controlling chain. Drag bars, handles and link dots for direct editing.', '.prog-gantt-wrap'],
  ['Critical path and float', 'Red outlines identify zero-float work. Turn Float on from More to see available movement before completion changes.', '.prog-split'],
  ['Fit, zoom and fullscreen', 'Fullscreen uses the whole display. Fit recalculates for its current width; minus and plus switch to detail zoom. Mobile adds Chart and Table views.', '[aria-label="Toggle fullscreen"]'],
  ['Baseline before work starts', 'More contains baseline, working-week, float and look-ahead controls. Baseline ghosts make later movement defensible; re-baseline only after formal acceptance.', '[aria-label^="More:"]'],
  ['Plan procurement', 'Add procurement lead time to an activity and the programme calculates its order-by date. The procurement register appears below the chart.', '.prog-split'],
  ['Issue and back up', 'Use More for Print/PDF, PNG, CSV and JSON. Keep JSON as the editable backup; issue a dated PDF or PNG to the project team.', '[aria-label^="More:"]'],
  ['Help remains available', 'Open this Help button anytime for the searchable CPM, baseline, procurement, mobile and export reference.', '[data-programme-help]'],
] as const

const make = (tag: string, cls?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text) node.textContent = text
  return node
}

const button = (text: string): HTMLButtonElement => {
  const node = document.createElement('button')
  node.className = 'prog-tut-btn'
  node.type = 'button'
  node.textContent = text
  return node
}

export function createProgrammeTutorial(root: HTMLElement, options: TutorialOptions): void {
  const overlay = make('div', 'prog-tut')
  overlay.hidden = true
  const shade = make('div', 'prog-tut-shade')
  const card = make('section', 'prog-tut-card')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', 'Programme Builder help')
  const tour = make('div', 'prog-tut-tour')
  const step = make('span', 'prog-tut-step')
  const title = make('h2', 'prog-tut-title')
  const text = make('p', 'prog-tut-text')
  tour.append(step, title, text)
  const browse = make('div', 'prog-tut-browse')
  browse.hidden = true
  const search = document.createElement('input')
  search.type = 'search'; search.className = 'prog-tut-search'; search.placeholder = 'Search programme help…'
  search.setAttribute('aria-label', 'Search Programme Builder help')
  const topics = make('div', 'prog-tut-topics')
  browse.append(make('h2', 'prog-tut-title', 'Programme Builder help'), search, topics)
  const actions = make('div', 'prog-tut-actions')
  const close = button('✕ Close'), browseButton = button('Browse help'), tourButton = button('▶ Guided tour')
  const previous = button('Previous'), next = button('Next')
  actions.append(close, browseButton, tourButton, previous, next)
  card.append(tour, browse, actions); overlay.append(shade, card); document.body.append(overlay)

  const renderTopics = (): void => {
    topics.replaceChildren()
    const query = search.value.trim().toLowerCase()
    const hits = TOPICS.filter(topic => !query || `${topic.section} ${topic.title} ${topic.text} ${topic.keys ?? ''}`.toLowerCase().includes(query))
    let section = ''
    for (const topic of hits) {
      if (topic.section !== section) { section = topic.section; topics.append(make('div', 'prog-tut-section', section.toUpperCase())) }
      const item = make('article', 'prog-tut-topic')
      item.append(make('h3', 'prog-tut-topic-title', topic.title), make('p', 'prog-tut-text', topic.text))
      topics.append(item)
    }
    if (!hits.length) topics.append(make('p', 'prog-tut-text', 'No matching topics.'))
  }
  search.addEventListener('input', renderTopics); renderTopics()

  let index = 0, target: HTMLElement | null = null, touring = false
  const clearTarget = () => { target?.classList.remove('prog-tut-target'); target = null }
  const setView = (view: 'tour' | 'browse') => {
    tour.hidden = view !== 'tour'; browse.hidden = view !== 'browse'
    previous.hidden = view !== 'tour'; next.hidden = view !== 'tour'; browseButton.hidden = view !== 'tour'; tourButton.hidden = view !== 'browse'
    card.classList.toggle('prog-tut-browsing', view === 'browse')
  }
  const showStep = (nextIndex: number) => {
    if (!touring) { touring = true; options.openDemo() }
    setView('tour'); overlay.hidden = false; clearTarget()
    index = Math.max(0, Math.min(STEPS.length - 1, nextIndex))
    const current = STEPS[index]
    target = root.querySelector<HTMLElement>(current[2])
    target?.classList.add('prog-tut-target')
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    step.textContent = `${index + 1} / ${STEPS.length}`; title.textContent = current[0]; text.textContent = current[1]
    previous.disabled = index === 0; next.textContent = index === STEPS.length - 1 ? 'Finish' : 'Next'
  }
  const openHelp = () => { clearTarget(); setView('browse'); overlay.hidden = false; search.focus() }
  const dismiss = () => {
    overlay.hidden = true; clearTarget()
    if (touring) { touring = false; options.closeDemo() }
    localStorage.setItem('vv_programme_tutorial_seen', '1')
  }
  previous.addEventListener('click', () => showStep(index - 1))
  next.addEventListener('click', () => index === STEPS.length - 1 ? dismiss() : showStep(index + 1))
  browseButton.addEventListener('click', openHelp); tourButton.addEventListener('click', () => showStep(0))
  close.addEventListener('click', dismiss); shade.addEventListener('click', dismiss)
  root.addEventListener('click', event => {
    if ((event.target as HTMLElement).closest('[data-programme-help]')) openHelp()
  })
  document.addEventListener('keydown', event => { if (!overlay.hidden && event.key === 'Escape') { event.preventDefault(); dismiss() } })
}
