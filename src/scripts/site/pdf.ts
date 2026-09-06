import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { download } from './calc'

interface Src { name: string; bytes: Uint8Array; pdf: any; render?: any }
interface PageRef { id: string; src: number; page: number; rot: number; selected: boolean }

const uid = () => `pg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function initPdf() {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null
  const fileIn = byId<HTMLInputElement>('pdf-file')
  const listEl = byId<HTMLDivElement>('pdf-pages')
  const exportBtn = byId<HTMLButtonElement>('pdf-export')
  const statusEl = byId<HTMLElement>('pdf-status')
  if (!fileIn || !listEl || !exportBtn) return

  const srcs: Src[] = []
  let pages: PageRef[] = []
  let compareSource: number | null = null
  let comparePageCount = 0
  let comparisonCanvas: HTMLCanvasElement | null = null
  let PL: any = null
  let PDFJS: any = null
  const lib = async () => (PL ||= await import('pdf-lib'))
  const renderer = async () => {
    if (!PDFJS) {
      PDFJS = await import('pdfjs-dist')
      PDFJS.GlobalWorkerOptions.workerSrc = pdfWorker
    }
    return PDFJS
  }
  const setStatus = (text: string) => { if (statusEl) statusEl.textContent = text }
  const selected = () => pages.filter((page) => page.selected)
  const operative = () => selected().length ? selected() : pages
  const updateButtons = () => {
    const any = pages.length > 0, some = selected().length > 0
    exportBtn.disabled = !any
    for (const id of ['pdf-extract', 'pdf-split', 'pdf-images']) {
      const button = byId<HTMLButtonElement>(id); if (button) button.disabled = !some
    }
    const compareRender = byId<HTMLButtonElement>('pdf-compare-render')
    if (compareRender) compareRender.disabled = !any || compareSource === null
    updateCompareBaseOptions()
    updatePreflight()
  }

  function updateCompareBaseOptions() {
    const select = byId<HTMLSelectElement>('pdf-compare-base')
    if (!select) return
    const chosen = select.value
    select.textContent = ''
    pages.forEach((ref, index) => {
      const option = document.createElement('option'); option.value = ref.id; option.textContent = `${index + 1}. ${srcs[ref.src].name} · p${ref.page + 1}`; select.append(option)
    })
    if (pages.some((page) => page.id === chosen)) select.value = chosen
  }

  function updatePreflight() {
    const list = byId<HTMLUListElement>('pdf-preflight')
    if (!list) return
    const messages: string[] = []
    if (!pages.length) messages.push('Add pages to run checks.')
    else {
      const sizes = new Set(pages.map((ref) => {
        const sourcePage = srcs[ref.src].pdf.getPage(ref.page); const size = sourcePage.getSize()
        const rotated = ref.rot % 180 !== 0
        return `${Math.round(rotated ? size.height : size.width)}×${Math.round(rotated ? size.width : size.height)}`
      }))
      if (sizes.size > 1) messages.push(`Check mixed page sizes: ${sizes.size} formats detected.`)
      if (pages.some((page) => page.rot)) messages.push('Rotation changes are queued for export.')
      if (byId<HTMLInputElement>('pdf-raster')?.checked) messages.push('Raster output removes searchable text, vectors and live links.')
      if (Number(byId<HTMLInputElement>('pdf-crop')?.value || 0) > 0) messages.push('Crop applies to selected pages, or all pages when none are selected.')
      if (!byId<HTMLInputElement>('pdf-title')?.value.trim()) messages.push('Document title metadata is blank.')
      if (!byId<HTMLInputElement>('pdf-stamp')?.value.trim() && !byId<HTMLInputElement>('pdf-footer')?.value.trim()) messages.push('No issue stamp or footer is set.')
      if (!messages.length) messages.push('No obvious export issues detected. Visually check the downloaded PDF before issue.')
    }
    list.textContent = ''
    messages.forEach((message) => { const item = document.createElement('li'); item.textContent = message; list.append(item) })
  }

  async function renderSource(src: number) {
    if (srcs[src].render) return srcs[src].render
    const R = await renderer()
    srcs[src].render = await R.getDocument({ data: srcs[src].bytes.slice() }).promise
    return srcs[src].render
  }

  async function renderPage(ref: PageRef, scale: number): Promise<HTMLCanvasElement> {
    const doc = await renderSource(ref.src)
    const page = await doc.getPage(ref.page + 1)
    const viewport = page.getViewport({ scale, rotation: (page.rotate + ref.rot) % 360 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height))
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    return canvas
  }

  async function paintThumb(ref: PageRef, target: HTMLCanvasElement) {
    try {
      const canvas = await renderPage(ref, 0.28)
      target.width = canvas.width; target.height = canvas.height
      target.getContext('2d')!.drawImage(canvas, 0, 0)
    } catch { target.setAttribute('aria-label', 'Preview unavailable') }
  }

  function render() {
    listEl!.textContent = ''
    pages.forEach((ref, index) => {
      const card = document.createElement('article')
      card.className = `pdf-page-card${ref.selected ? ' selected' : ''}`
      card.draggable = true; card.dataset.id = ref.id
      card.addEventListener('dragstart', (event) => event.dataTransfer?.setData('text/plain', ref.id))
      card.addEventListener('dragover', (event) => event.preventDefault())
      card.addEventListener('drop', (event) => {
        event.preventDefault(); const fromId = event.dataTransfer?.getData('text/plain')
        const from = pages.findIndex((page) => page.id === fromId), to = pages.findIndex((page) => page.id === ref.id)
        if (from >= 0 && to >= 0 && from !== to) { const [moved] = pages.splice(from, 1); pages.splice(to, 0, moved); render() }
      })
      const check = document.createElement('input')
      check.type = 'checkbox'; check.checked = ref.selected; check.setAttribute('aria-label', `Select page ${index + 1}`)
      check.addEventListener('change', () => { ref.selected = check.checked; render() })
      const canvas = document.createElement('canvas'); canvas.className = 'pdf-thumb'; canvas.setAttribute('aria-label', `Preview page ${index + 1}`)
      void paintThumb(ref, canvas)
      const label = document.createElement('span'); label.className = 'pdf-label'
      label.textContent = `${index + 1}. ${srcs[ref.src].name} · p${ref.page + 1}${ref.rot ? ` · ${ref.rot}°` : ''}`
      const controls = document.createElement('span'); controls.className = 'pdf-ctrls no-print'
      const button = (text: string, aria: string, action: () => void) => {
        const b = document.createElement('button'); b.className = 'btn btn-ghost btn-sm'; b.textContent = text; b.setAttribute('aria-label', aria); b.addEventListener('click', action); return b
      }
      controls.append(
        button('↑', 'Move page up', () => { if (index > 0) { [pages[index - 1], pages[index]] = [pages[index], pages[index - 1]]; render() } }),
        button('↓', 'Move page down', () => { if (index < pages.length - 1) { [pages[index + 1], pages[index]] = [pages[index], pages[index + 1]]; render() } }),
        button('↷', 'Rotate page right', () => { ref.rot = (ref.rot + 90) % 360; render() }),
        button('×', 'Delete page', () => { pages.splice(index, 1); render() }),
      )
      card.append(check, canvas, label, controls); listEl!.append(card)
    })
    updateButtons(); setStatus(pages.length ? `${pages.length} pages · ${selected().length} selected` : 'Add PDFs or images to begin.')
  }

  async function addPdf(name: string, bytes: Uint8Array) {
    const L = await lib(); const pdf = await L.PDFDocument.load(bytes)
    const src = srcs.push({ name, bytes, pdf }) - 1
    for (let page = 0; page < pdf.getPageCount(); page++) pages.push({ id: uid(), src, page, rot: 0, selected: false })
  }

  async function addImage(file: File) {
    const L = await lib(); const pdf = await L.PDFDocument.create(); const bytes = new Uint8Array(await file.arrayBuffer())
    const image = file.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    const maxW = 595.28, maxH = 841.89, ratio = Math.min(maxW / image.width, maxH / image.height, 1)
    const width = image.width * ratio, height = image.height * ratio
    const page = pdf.addPage([width, height]); page.drawImage(image, { x: 0, y: 0, width, height })
    await addPdf(file.name, await pdf.save())
  }

  fileIn.addEventListener('change', async () => {
    const files = Array.from(fileIn.files ?? []); if (!files.length) return
    setStatus('Reading files…')
    for (const file of files) {
      try {
        if (file.type.startsWith('image/')) await addImage(file)
        else await addPdf(file.name, new Uint8Array(await file.arrayBuffer()))
      } catch { setStatus(`Could not open ${file.name}. It may be encrypted or damaged.`) }
    }
    fileIn.value = ''; render()
  })

  byId<HTMLSelectElement>('pdf-stamp-preset')?.addEventListener('change', (event) => {
    const stamp = byId<HTMLInputElement>('pdf-stamp'); if (stamp) stamp.value = (event.target as HTMLSelectElement).value
    updatePreflight()
  })
  for (const id of ['pdf-footer', 'pdf-stamp', 'pdf-title', 'pdf-crop', 'pdf-raster']) byId<HTMLElement>(id)?.addEventListener('input', updatePreflight)

  byId<HTMLInputElement>('pdf-compare-file')?.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); const L = await lib(); const pdf = await L.PDFDocument.load(bytes)
      compareSource = srcs.push({ name: file.name, bytes, pdf }) - 1; comparePageCount = pdf.getPageCount()
      const select = byId<HTMLSelectElement>('pdf-compare-page'); if (select) {
        select.textContent = ''
        for (let index = 0; index < comparePageCount; index++) { const option = document.createElement('option'); option.value = String(index); option.textContent = `Page ${index + 1}`; select.append(option) }
      }
      setStatus(`${file.name} ready to compare.`); updateButtons()
    } catch { setStatus(`Could not open ${file.name}.`) }
  })

  async function renderComparison() {
    if (compareSource === null || !pages.length) return
    const baseId = byId<HTMLSelectElement>('pdf-compare-base')?.value
    const base = pages.find((page) => page.id === baseId) || pages[0]
    const comparePage = Math.min(comparePageCount - 1, Number(byId<HTMLSelectElement>('pdf-compare-page')?.value || 0))
    const top: PageRef = { id: 'compare', src: compareSource, page: comparePage, rot: 0, selected: false }
    setStatus('Rendering comparison…')
    const [baseCanvas, topCanvas] = await Promise.all([renderPage(base, 1.35), renderPage(top, 1.35)])
    const canvas = byId<HTMLCanvasElement>('pdf-compare-canvas'); if (!canvas) return
    canvas.width = Math.max(baseCanvas.width, topCanvas.width); canvas.height = Math.max(baseCanvas.height, topCanvas.height)
    const context = canvas.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(baseCanvas, 0, 0, canvas.width, canvas.height)
    context.globalAlpha = Number(byId<HTMLInputElement>('pdf-compare-opacity')?.value || 50) / 100
    context.globalCompositeOperation = (byId<HTMLSelectElement>('pdf-compare-mode')?.value || 'source-over') as GlobalCompositeOperation
    context.drawImage(topCanvas, 0, 0, canvas.width, canvas.height)
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; canvas.classList.add('ready'); comparisonCanvas = canvas
    const exportCompare = byId<HTMLButtonElement>('pdf-compare-export'); if (exportCompare) exportCompare.disabled = false
    setStatus(`Compared base page with ${srcs[compareSource].name} · p${comparePage + 1}.`)
  }

  byId<HTMLButtonElement>('pdf-compare-render')?.addEventListener('click', () => void renderComparison())
  byId<HTMLInputElement>('pdf-compare-opacity')?.addEventListener('input', (event) => {
    const output = byId<HTMLOutputElement>('pdf-compare-opacity-out'); if (output) output.value = `${(event.target as HTMLInputElement).value}%`
  })
  byId<HTMLButtonElement>('pdf-compare-export')?.addEventListener('click', async () => {
    if (!comparisonCanvas) return
    const L = await lib(); const out = await L.PDFDocument.create(); const png = await out.embedPng(comparisonCanvas.toDataURL('image/png'))
    const page = out.addPage([comparisonCanvas.width / 1.35, comparisonCanvas.height / 1.35]); page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
    const data = await out.save(); download(`drawing-comparison-${new Date().toISOString().slice(0, 10)}.pdf`, URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: 'application/pdf' })))
  })

  function parseRange(value: string): Set<number> {
    const found = new Set<number>()
    for (const token of value.split(',').map((part) => part.trim()).filter(Boolean)) {
      const match = /^(\d+)?\s*-\s*(\d+)?$/.exec(token)
      if (match) {
        const from = Math.max(1, Number(match[1] || 1)), to = Math.min(pages.length, Number(match[2] || pages.length))
        for (let page = Math.min(from, to); page <= Math.max(from, to); page++) found.add(page - 1)
      } else if (/^\d+$/.test(token)) found.add(Number(token) - 1)
    }
    return found
  }

  byId<HTMLButtonElement>('pdf-all')?.addEventListener('click', () => { pages.forEach((page) => { page.selected = true }); render() })
  byId<HTMLButtonElement>('pdf-none')?.addEventListener('click', () => { pages.forEach((page) => { page.selected = false }); render() })
  byId<HTMLButtonElement>('pdf-apply-range')?.addEventListener('click', () => { const range = parseRange(byId<HTMLInputElement>('pdf-range')?.value ?? ''); pages.forEach((page, index) => { page.selected = range.has(index) }); render() })
  const mutateSelected = (action: (page: PageRef) => void) => { operative().forEach(action); render() }
  byId<HTMLButtonElement>('pdf-rot-left')?.addEventListener('click', () => mutateSelected((page) => { page.rot = (page.rot + 270) % 360 }))
  byId<HTMLButtonElement>('pdf-rot-right')?.addEventListener('click', () => mutateSelected((page) => { page.rot = (page.rot + 90) % 360 }))
  byId<HTMLButtonElement>('pdf-delete')?.addEventListener('click', () => { const ids = new Set(operative().map((page) => page.id)); pages = pages.filter((page) => !ids.has(page.id)); render() })
  byId<HTMLButtonElement>('pdf-duplicate')?.addEventListener('click', () => { const ids = new Set(operative().map((page) => page.id)); pages = pages.flatMap((page) => ids.has(page.id) ? [page, { ...page, id: uid(), selected: false }] : [page]); render() })
  byId<HTMLButtonElement>('pdf-reverse')?.addEventListener('click', () => { pages.reverse(); render() })
  byId<HTMLButtonElement>('pdf-blank')?.addEventListener('click', async () => { const L = await lib(); const pdf = await L.PDFDocument.create(); pdf.addPage([595.28, 841.89]); await addPdf('Blank A4', await pdf.save()); render() })

  async function build(refs: PageRef[]): Promise<Uint8Array> {
    const L = await lib(); const out = await L.PDFDocument.create(); const font = await out.embedFont(L.StandardFonts.Helvetica)
    const raster = !!byId<HTMLInputElement>('pdf-raster')?.checked
    const quality = Number(byId<HTMLSelectElement>('pdf-quality')?.value ?? 0.86)
    for (const ref of refs) {
      if (raster) {
        const canvas = await renderPage(ref, 1.5); const jpg = await out.embedJpg(canvas.toDataURL('image/jpeg', quality))
        const page = out.addPage([canvas.width / 1.5, canvas.height / 1.5]); page.drawImage(jpg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
      } else {
        const [copied] = await out.copyPages(srcs[ref.src].pdf, [ref.page])
        if (ref.rot) copied.setRotation(L.degrees(((copied.getRotation().angle || 0) + ref.rot) % 360))
        out.addPage(copied)
      }
    }
    if (byId<HTMLInputElement>('pdf-clean-meta')?.checked) {
      out.setTitle(''); out.setAuthor(''); out.setSubject(''); out.setKeywords([]); out.setProducer(''); out.setCreator('')
    }
    const title = byId<HTMLInputElement>('pdf-title')?.value.trim(); const author = byId<HTMLInputElement>('pdf-author')?.value.trim()
    if (title) out.setTitle(title); if (author) out.setAuthor(author)
    const footer = byId<HTMLInputElement>('pdf-footer')?.value.trim() ?? ''
    const stamp = byId<HTMLInputElement>('pdf-stamp')?.value.trim() ?? ''
    const sign = byId<HTMLInputElement>('pdf-sign')?.value.trim() ?? ''
    const number = !!byId<HTMLInputElement>('pdf-num')?.checked
    const cropPt = Math.max(0, Number(byId<HTMLInputElement>('pdf-crop')?.value ?? 0)) * 72 / 25.4
    const marked = new Set(selected().map((page) => page.id)); const markAll = marked.size === 0
    out.getPages().forEach((page: any, index: number) => {
      const ref = refs[index]; if (!markAll && !marked.has(ref.id)) return
      const { width, height } = page.getSize()
      if (cropPt > 0 && width > cropPt * 2 && height > cropPt * 2) page.setCropBox(cropPt, cropPt, width - cropPt * 2, height - cropPt * 2)
      if (footer) page.drawText(footer, { x: 30, y: 18, size: 8, font, color: L.rgb(0.28, 0.28, 0.28) })
      if (number) { const text = `${index + 1} / ${refs.length}`; page.drawText(text, { x: width - 30 - font.widthOfTextAtSize(text, 8), y: 18, size: 8, font, color: L.rgb(0.28, 0.28, 0.28) }) }
      if (sign) page.drawText(sign, { x: Math.max(30, width - 30 - font.widthOfTextAtSize(sign, 10)), y: 34, size: 10, font, color: L.rgb(0.08, 0.18, 0.4) })
      if (stamp) page.drawText(stamp, { x: width / 2 - font.widthOfTextAtSize(stamp, 48) / 2, y: height / 2, size: 48, font, color: L.rgb(0.85, 0.1, 0.1), opacity: 0.16, rotate: L.degrees(30) })
    })
    return out.save({ useObjectStreams: true })
  }

  async function savePdf(refs: PageRef[], prefix: string) {
    if (!refs.length) return; setStatus('Building PDF…')
    try { const data = await build(refs); download(`${prefix}-${new Date().toISOString().slice(0, 10)}.pdf`, URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: 'application/pdf' }))); setStatus(`Exported ${refs.length} page(s).`) }
    catch (error) { setStatus(`Export failed: ${(error as Error).message}`) }
    finally { updateButtons() }
  }

  exportBtn.addEventListener('click', () => void savePdf(pages, 'edited'))
  byId<HTMLButtonElement>('pdf-extract')?.addEventListener('click', () => void savePdf(selected(), 'extracted'))
  byId<HTMLButtonElement>('pdf-split')?.addEventListener('click', async () => {
    const refs = selected(); if (!refs.length) return; setStatus('Splitting pages…')
    const { default: JSZip } = await import('jszip'); const zip = new JSZip()
    for (let index = 0; index < refs.length; index++) zip.file(`page-${String(index + 1).padStart(3, '0')}.pdf`, await build([refs[index]]))
    const blob = await zip.generateAsync({ type: 'blob' }); download('split-pages.zip', URL.createObjectURL(blob)); setStatus(`Split ${refs.length} page(s).`)
  })
  byId<HTMLButtonElement>('pdf-images')?.addEventListener('click', async () => {
    const refs = selected(); if (!refs.length) return; setStatus('Rendering PNGs…')
    const { default: JSZip } = await import('jszip'); const zip = new JSZip()
    for (let index = 0; index < refs.length; index++) {
      const canvas = await renderPage(refs[index], 2); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG failed')), 'image/png'))
      zip.file(`page-${String(index + 1).padStart(3, '0')}.png`, blob)
    }
    download('pdf-pages-png.zip', URL.createObjectURL(await zip.generateAsync({ type: 'blob' }))); setStatus(`Rendered ${refs.length} PNG(s).`)
  })

  render()
}
