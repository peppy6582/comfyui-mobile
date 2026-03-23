const KEY = 'comfyui_workflows'

// --- Pinned workflows (user's personal list, just filename + name refs) ---

const PINNED_KEY = 'comfyui_pinned'

export interface PinnedWorkflow {
  filename: string
  name: string
}

export function getPinned(): PinnedWorkflow[] {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') } catch { return [] }
}

export function addPinned(wf: { filename: string; name: string }): void {
  const list = getPinned()
  if (!list.some((p) => p.filename === wf.filename)) {
    list.push({ filename: wf.filename, name: wf.name })
    localStorage.setItem(PINNED_KEY, JSON.stringify(list))
  }
}

export function removePinned(filename: string): void {
  localStorage.setItem(PINNED_KEY, JSON.stringify(getPinned().filter((p) => p.filename !== filename)))
}

export interface SavedWorkflow {
  id: string
  name: string
  json: Record<string, unknown>
  savedAt: number
}

export function getWorkflows(): SavedWorkflow[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function saveWorkflow(name: string, json: Record<string, unknown>): SavedWorkflow {
  const list = getWorkflows()
  const existing = list.findIndex((w) => w.name === name)
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
      })
  const wf: SavedWorkflow = { id, name, json, savedAt: Date.now() }
  if (existing >= 0) {
    list[existing] = wf
  } else {
    list.unshift(wf)
  }
  localStorage.setItem(KEY, JSON.stringify(list))
  return wf
}

export function deleteWorkflow(id: string): void {
  const list = getWorkflows().filter((w) => w.id !== id)
  localStorage.setItem(KEY, JSON.stringify(list))
}

export async function importFile(file: File): Promise<SavedWorkflow> {
  const text = await file.text()
  const json = JSON.parse(text)
  const name = file.name.replace(/\.json$/i, '')
  return saveWorkflow(name, json)
}
