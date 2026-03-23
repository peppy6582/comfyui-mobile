import { getConfig } from './config'

export interface WorkflowFile {
  name: string      // display name (without .json)
  filename: string  // actual filename as stored (with .json)
  size: number
  modified: number
}

export interface QueuedPrompt {
  prompt_id: string
  number: number
}

export interface QueueStatus {
  queue_remaining: number
  running: string[]  // prompt_ids currently executing
  pending: string[]  // prompt_ids waiting
}

export interface HistoryEntry {
  prompt_id: string
  outputs: Record<string, { images?: OutputImage[] }>
  status: { status_str: string; completed: boolean }
}

export interface OutputImage {
  filename: string
  subfolder: string
  type: string
}

export type ProgressEvent =
  | { type: 'progress'; value: number; max: number; node: string }
  | { type: 'executing'; node: string | null }
  | { type: 'executed'; prompt_id: string; node: string; output: { images?: OutputImage[] } }
  | { type: 'execution_error'; message: string; prompt_id: string }
  | { type: 'status'; status: { exec_info: { queue_remaining: number } } }

function base(): string {
  return getConfig().serverUrl.replace(/\/$/, '')
}

// Uses comfy-portal-endpoint: GET /cpe/workflow/list
export async function listWorkflows(): Promise<WorkflowFile[]> {
  const res = await fetch(`${base()}/cpe/workflow/list`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const raw = await res.json()
  // Normalise: accept a bare array or an object with a "workflows" / "files" key
  const data: Array<{ filename: string; size: number; modified: number }> =
    Array.isArray(raw) ? raw
    : Array.isArray(raw?.workflows) ? raw.workflows
    : Array.isArray(raw?.files) ? raw.files
    : null
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected response from /cpe/workflow/list (got ${typeof raw})`)
  }
  return data.map((item) => ({
    filename: item.filename,
    name: item.filename.replace(/\.json$/i, ''),
    size: item.size,
    modified: item.modified,
  }))
}

// Uses comfy-portal-endpoint: GET /cpe/workflow/get-and-convert?filename=<name>
// Returns the workflow already converted to ComfyUI API format
export async function loadWorkflow(filename: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${base()}/cpe/workflow/get-and-convert?filename=${encodeURIComponent(filename)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // The endpoint may return bare JS literals (NaN, Infinity) that are invalid JSON.
  // Replace them with null before parsing, then patch using the raw UI workflow.
  const text = (await res.text())
    .replace(/:\s*NaN\b/g, ': null')
    .replace(/:\s*Infinity\b/g, ': null')
    .replace(/:\s*-Infinity\b/g, ': null')
  const raw = JSON.parse(text)
  // Unwrap {"status":"success","data":{"workflow":{...}}} envelope if present
  const workflow: Record<string, unknown> = raw?.data?.workflow ?? raw?.data ?? raw

  // Remove UI-only nodes (Note, Reroute, PrimitiveNode etc.) that the converter
  // included with class_type: null — ComfyUI rejects them.
  // First inline any values they produce into nodes that reference them.
  const nullNodes = new Set(
    Object.entries(workflow)
      .filter(([, n]) => (n as { class_type?: unknown }).class_type == null)
      .map(([id]) => id)
  )

  // Build UI-node/link maps so we can resolve actual values
  // (needed here even before patchNullsFromRawWorkflow runs)
  let uiNodeById: Map<number, UiNode> | null = null
  let uiLinkById: Map<number, UiLink> | null = null

  if (nullNodes.size > 0) {
    // Replace array refs like ["45",0] pointing to a null-class_type node with the
    // actual primitive value sourced from the raw UI workflow.
    for (const [, nodeData] of Object.entries(workflow)) {
      const nd = nodeData as { class_type?: unknown; inputs?: Record<string, unknown> }
      if (!nd.inputs) continue
      for (const [inputName, value] of Object.entries(nd.inputs)) {
        if (!Array.isArray(value) || value.length < 2) continue
        const refId = String(value[0])
        if (!nullNodes.has(refId)) continue
        // This input references a null node — resolve via raw UI workflow
        if (!uiNodeById) {
          // Lazy-load raw workflow for resolution
          try {
            const r = await fetch(`${base()}/cpe/workflow/get?filename=${encodeURIComponent(filename)}`)
            if (r.ok) {
              const rd = await r.json()
              const uw = typeof rd.workflow === 'string' ? JSON.parse(rd.workflow as string) : rd.workflow
              uiNodeById = new Map<number, UiNode>()
              uiLinkById = new Map<number, UiLink>()
              for (const n of uw?.nodes ?? []) uiNodeById.set((n as UiNode).id, n as UiNode)
              for (const l of uw?.links ?? []) uiLinkById.set((l as UiLink)[0], l as UiLink)
            }
          } catch { /* leave null */ }
        }
        const srcNode = uiNodeById?.get(Number(refId))
        const slot = Number(value[1])
        const resolved = srcNode?.widgets_values?.[slot]
        if (resolved !== undefined && resolved !== null && resolved !== 'undefined') {
          nd.inputs[inputName] = resolved
        }
      }
    }
    for (const id of nullNodes) delete workflow[id]
  }

  // If any inputs are still null (were NaN) or "undefined" (unresolved links),
  // resolve via raw UI workflow PrimitiveNode tracing.
  const needsPatch = Object.values(workflow as Record<string, { inputs?: Record<string, unknown> }>)
    .some(n => n.inputs && Object.values(n.inputs).some(v => v === null || v === 'undefined'))
  if (needsPatch) {
    await patchNullsFromRawWorkflow(workflow, filename, uiNodeById, uiLinkById)
  }

  // Randomize seeds so every run is unique and ComfyUI doesn't serve a cached result.
  // KSampler uses "seed", KSamplerAdvanced uses "noise_seed".
  for (const nodeData of Object.values(workflow)) {
    const inputs = (nodeData as { inputs?: Record<string, unknown> }).inputs
    if (!inputs) continue
    if ('seed' in inputs) inputs.seed = Math.floor(Math.random() * 0xffffffff)
    if ('noise_seed' in inputs) inputs.noise_seed = Math.floor(Math.random() * 0xffffffff)
  }

  return workflow
}

// Re-randomize seeds on an already-loaded workflow (call before each queue submission).
export function randomizeSeeds(workflow: Record<string, unknown>): void {
  for (const nodeData of Object.values(workflow)) {
    const inputs = (nodeData as { inputs?: Record<string, unknown> }).inputs
    if (!inputs) continue
    if ('seed' in inputs) inputs.seed = Math.floor(Math.random() * 0xffffffff)
    if ('noise_seed' in inputs) inputs.noise_seed = Math.floor(Math.random() * 0xffffffff)
  }
}

type UiNode = { id: number; type?: string; inputs?: { name: string; link?: number | null }[]; widgets_values?: unknown[] }
type UiLink = [number, number, number, number, number, string] // [id, srcNode, srcSlot, dstNode, dstSlot, type]

async function patchNullsFromRawWorkflow(
  apiWorkflow: Record<string, unknown>,
  filename: string,
  preloadedNodes?: Map<number, UiNode> | null,
  preloadedLinks?: Map<number, UiLink> | null,
): Promise<void> {
  let nodeById = preloadedNodes
  let linkById = preloadedLinks

  if (!nodeById || !linkById) {
    const res = await fetch(`${base()}/cpe/workflow/get?filename=${encodeURIComponent(filename)}`)
    if (!res.ok) return
    const raw = await res.json()
    const uiWorkflow = typeof raw.workflow === 'string' ? JSON.parse(raw.workflow as string) : raw.workflow
    if (!uiWorkflow) return

    nodeById = new Map<number, UiNode>()
    for (const n of uiWorkflow.nodes ?? []) nodeById.set((n as UiNode).id, n as UiNode)

    linkById = new Map<number, UiLink>()
    for (const l of uiWorkflow.links ?? []) linkById.set((l as UiLink)[0], l as UiLink)
  }

  for (const [nodeId, nodeData] of Object.entries(apiWorkflow)) {
    const node = nodeData as { inputs?: Record<string, unknown> }
    if (!node.inputs) continue
    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (value !== null && value !== 'undefined') continue
      const uiNode = nodeById.get(Number(nodeId))
      if (!uiNode) continue
      const uiInput = uiNode.inputs?.find(i => i.name === inputName)
      if (!uiInput || uiInput.link == null) continue
      const link = linkById.get(uiInput.link)
      if (!link) continue
      const srcNode = nodeById.get(link[1])
      if (!srcNode?.widgets_values?.length) continue
      // PrimitiveNode stores its value as widgets_values[0]
      const resolved = srcNode.widgets_values[0]
      if (resolved !== undefined && resolved !== null && resolved !== 'undefined') {
        node.inputs[inputName] = resolved
      }
    }
  }
}

export async function queuePrompt(
  workflow: Record<string, unknown>,
  clientId: string
): Promise<QueuedPrompt> {
  const res = await fetch(`${base()}/api/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`)
  }
  // ComfyUI may return HTTP 200 with node_errors for soft validation failures
  const nodeErrors = (body as { node_errors?: Record<string, { errors: { message: string }[] }> }).node_errors
  if (nodeErrors && Object.keys(nodeErrors).length > 0) {
    const first = Object.values(nodeErrors)[0]
    throw new Error(first.errors?.[0]?.message ?? 'Prompt outputs failed validation')
  }
  return body as QueuedPrompt
}

export async function getQueueStatus(): Promise<QueueStatus> {
  const res = await fetch(`${base()}/api/queue`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as {
    queue_running: [number, string, unknown, unknown][],
    queue_pending: [number, string, unknown, unknown][]
  }
  return {
    queue_remaining: (data.queue_running?.length ?? 0) + (data.queue_pending?.length ?? 0),
    running: data.queue_running?.map(e => e[1]) ?? [],
    pending: data.queue_pending?.map(e => e[1]) ?? [],
  }
}

export async function getHistory(promptId?: string): Promise<Record<string, HistoryEntry>> {
  const url = promptId
    ? `${base()}/api/history/${promptId}`
    : `${base()}/api/history?max_items=50`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function imageUrl(img: OutputImage): string {
  const params = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
  return `${base()}/view?${params}`
}

export function openProgressSocket(
  clientId: string,
  onEvent: (e: ProgressEvent) => void
): () => void {
  const wsUrl = base().replace(/^http/, 'ws') + `/ws?clientId=${clientId}`
  const ws = new WebSocket(wsUrl)
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as { type: string; data: Record<string, unknown> }
      // ComfyUI WS messages are {type, data:{...}} — flatten so ProgressEvent fields are top-level
      onEvent({ type: msg.type, ...(msg.data ?? {}) } as unknown as ProgressEvent)
    } catch {}
  }
  return () => ws.close()
}

// Returns Map<sourceNodeId, clipNodeIds[]> by reading the raw UI workflow link graph.
// Used by the edit-prompts modal to group CLIPTextEncode nodes that share a source
// text node — even when loadWorkflow() has already inlined the values.
export async function getRawClipGroups(filename: string): Promise<Map<string, string[]>> {
  try {
    const res = await fetch(`${base()}/cpe/workflow/get?filename=${encodeURIComponent(filename)}`)
    if (!res.ok) return new Map()
    const raw = await res.json()
    const uw = typeof raw.workflow === 'string' ? JSON.parse(raw.workflow as string) : raw.workflow
    if (!uw) return new Map()

    const linkById = new Map<number, [number, number, number, number, number, string]>()
    for (const l of uw.links ?? []) linkById.set(l[0], l)

    const groups = new Map<string, string[]>()
    for (const node of uw.nodes ?? []) {
      if (node.type !== 'CLIPTextEncode') continue
      const textInput = (node.inputs ?? []).find((inp: { name: string }) => inp.name === 'text')
      if (!textInput || textInput.link == null) continue
      const link = linkById.get(textInput.link)
      if (!link) continue
      const srcId = String(link[1])
      const dstId = String(node.id)
      const arr = groups.get(srcId) ?? []
      arr.push(dstId)
      groups.set(srcId, arr)
    }
    return groups
  } catch {
    return new Map()
  }
}

export function randomClientId(): string {
  // crypto.randomUUID() requires a secure context (HTTPS/localhost);
  // fall back to Math.random for plain-HTTP LAN access from mobile.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

export type BrowserStatus = 'not_installed' | 'not_initialized' | 'initializing' | 'ready' | 'error' | 'unknown'

export async function getBrowserHealth(): Promise<BrowserStatus> {
  try {
    const res = await fetch(`${base()}/cpe/health`)
    if (!res.ok) return 'unknown'
    const data = await res.json()
    return (data?.browser?.status as BrowserStatus) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
