import { useEffect, useRef, useState } from 'react'
import {
  listWorkflows,
  loadWorkflow,
  queuePrompt,
  getHistory,
  getQueueStatus,
  openProgressSocket,
  randomClientId,
  getBrowserHealth,
  imageUrl,
  type WorkflowFile,
  type OutputImage,
  type ProgressEvent,
  type BrowserStatus,
} from '../lib/comfyui'
import { getPinned, addPinned, removePinned, type PinnedWorkflow } from '../lib/workflows'

type RunState = 'idle' | 'queued' | 'running' | 'done' | 'error'

interface RunStatus {
  state: RunState
  progress: number
  currentNode: string
  promptId: string
  queuePosition: number
  outputs: OutputImage[]
  error: string
}

const clientId = randomClientId()
const IDLE_RUN: RunStatus = { state: 'idle', progress: 0, currentNode: '', promptId: '', queuePosition: 0, outputs: [], error: '' }

export default function WorkflowsPage() {
  const [pinned, setPinned] = useState<PinnedWorkflow[]>(getPinned)
  const [showBrowse, setShowBrowse] = useState(false)
  const [serverWorkflows, setServerWorkflows] = useState<WorkflowFile[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [selected, setSelected] = useState<PinnedWorkflow | null>(null)
  const [run, setRun] = useState<RunStatus>(IDLE_RUN)
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null)
  const warmupPoll = useRef<ReturnType<typeof setInterval> | null>(null)
  const runGuard = useRef(false)
  const closeSocket = useRef<(() => void) | null>(null)

  function openBrowse() {
    setShowBrowse(true)
    setBrowseLoading(true)
    setBrowseError('')
    listWorkflows()
      .then(setServerWorkflows)
      .catch((e: Error) => setBrowseError(e.message))
      .finally(() => setBrowseLoading(false))
  }

  function handleAddPin(wf: WorkflowFile) {
    addPinned(wf)
    setPinned(getPinned())
  }

  function handleRemovePin(filename: string) {
    removePinned(filename)
    setPinned(getPinned())
    if (selected?.filename === filename) {
      setSelected(null)
      setRun(IDLE_RUN)
    }
  }

  async function handleRun() {
    if (!selected || runGuard.current) return
    runGuard.current = true
    setRun({ ...IDLE_RUN, state: 'queued', currentNode: 'Loading…' })
    setBrowserStatus(null)

    const initialHealth = await getBrowserHealth()
    if (initialHealth !== 'ready' && initialHealth !== 'unknown') {
      setBrowserStatus(initialHealth)
      await new Promise<void>((resolve) => {
        warmupPoll.current = setInterval(async () => {
          const s = await getBrowserHealth()
          setBrowserStatus(s)
          if (s === 'ready' || s === 'unknown') { clearInterval(warmupPoll.current!); resolve() }
        }, 2000)
      })
      setBrowserStatus(null)
    }

    try {
      const workflow = await loadWorkflow(selected.filename)
      closeSocket.current?.()
      closeSocket.current = openProgressSocket(clientId, (e: ProgressEvent) => {
        if (e.type === 'progress') {
          setRun((r) => ({ ...r, state: 'running', progress: Math.round((e.value / e.max) * 100), currentNode: e.node ?? '' }))
        } else if (e.type === 'executing') {
          setRun((r) => ({ ...r, state: 'running', currentNode: e.node ?? 'Finishing…' }))
        } else if (e.type === 'executed') {
          setRun((r) => ({ ...r, state: 'done', progress: 100, outputs: e.output?.images ?? [] }))
          closeSocket.current?.()
        } else if (e.type === 'execution_error') {
          setRun((r) => ({ ...r, state: 'error', error: e.message }))
          closeSocket.current?.()
        }
      })
      const queued = await queuePrompt(workflow, clientId)
      setRun((r) => ({ ...r, state: 'queued', promptId: queued.prompt_id, queuePosition: queued.number }))
    } catch (e: unknown) {
      setRun((r) => ({ ...r, state: 'error', error: e instanceof Error ? e.message : 'Unknown error' }))
    } finally {
      runGuard.current = false
    }
  }

  useEffect(() => {
    if (run.state !== 'running' && run.state !== 'queued' && !(run.state === 'done' && run.outputs.length === 0)) return
    if (!run.promptId) return
    const interval = setInterval(async () => {
      try {
        const q = await getQueueStatus()
        const pendingIdx = q.pending.indexOf(run.promptId)
        if (pendingIdx >= 0) { setRun((r) => ({ ...r, state: 'queued', queuePosition: pendingIdx + 1 })); return }
        if (q.running.includes(run.promptId)) setRun((r) => ({ ...r, state: 'running', queuePosition: 0 }))
        const history = await getHistory(run.promptId)
        const entry = history[run.promptId]
        if (entry?.status?.completed) {
          const imgs: OutputImage[] = []
          for (const out of Object.values(entry.outputs ?? {})) { if (out.images) imgs.push(...out.images) }
          setRun((r) => ({ ...r, state: 'done', progress: 100, outputs: imgs }))
          clearInterval(interval)
        }
      } catch {}
    }, 2000)
    return () => clearInterval(interval)
  }, [run.state, run.promptId])

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0f0f0f]/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">My Workflows</h1>
            <p className="text-xs text-gray-500">{pinned.length} saved</p>
          </div>
          <button
            onClick={openBrowse}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold active:bg-violet-700"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Empty state */}
      {pinned.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
          <p className="text-gray-400 text-sm">No workflows saved yet.</p>
          <button
            onClick={openBrowse}
            className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold active:bg-violet-700"
          >
            Browse Server Workflows
          </button>
        </div>
      )}

      {/* Pinned workflow list */}
      <div className="divide-y divide-white/5">
        {pinned.map((wf) => (
          <div key={wf.filename}>
            <button
              onClick={() => {
                if (selected?.filename === wf.filename) { setSelected(null) }
                else { setSelected(wf); setRun(IDLE_RUN) }
              }}
              className={`flex w-full items-center justify-between px-4 py-4 text-left transition-colors
                ${selected?.filename === wf.filename ? 'bg-violet-900/20' : 'active:bg-white/5'}`}
            >
              <p className={`text-sm font-medium ${selected?.filename === wf.filename ? 'text-violet-300' : 'text-white'}`}>
                {wf.name}
              </p>
              <span className={`text-gray-500 text-sm transition-transform duration-200 inline-block ${selected?.filename === wf.filename ? '-rotate-180' : ''}`}>▾</span>
            </button>

            {selected?.filename === wf.filename && (
              <div className="px-4 pb-4">
                <div className="flex gap-2">
                  <button
                    onClick={handleRun}
                    disabled={run.state === 'queued' || run.state === 'running'}
                    className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold disabled:opacity-40 active:bg-violet-700"
                  >
                    {run.state === 'queued'
                      ? run.queuePosition > 0 ? `Queue #${run.queuePosition}` : 'Queued…'
                      : run.state === 'running' ? 'Running…'
                      : '▶  Run'}
                  </button>
                  <button
                    onClick={() => handleRemovePin(wf.filename)}
                    className="rounded-lg bg-red-900/30 px-4 py-2.5 text-sm font-medium text-red-400 active:bg-red-900/50"
                  >
                    Remove
                  </button>
                </div>

                {browserStatus && browserStatus !== 'ready' && browserStatus !== 'unknown' && (
                  <div className="mt-3 rounded-lg border border-amber-700 bg-amber-900/20 p-3 text-xs text-amber-300">
                    <span className="font-semibold">Browser warming up…</span>
                    {' '}Status: <span className="font-mono">{browserStatus}</span>. First run takes 5–15 s.
                  </div>
                )}

                {(run.state === 'queued' || run.state === 'running') && (
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-xs text-gray-400">
                      <span>{run.currentNode || 'Waiting…'}</span>
                      <span>{run.progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-violet-500 transition-all duration-300" style={{ width: `${run.progress}%` }} />
                    </div>
                  </div>
                )}

                {run.state === 'error' && (
                  <div className="mt-3 rounded-lg border border-red-800 bg-red-900/20 p-3 text-sm text-red-300">
                    {run.error}
                  </div>
                )}

                {run.state === 'done' && run.outputs.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {run.outputs.map((img, i) => (
                      <a key={i} href={imageUrl(img)} target="_blank" rel="noreferrer">
                        <img src={imageUrl(img)} alt={img.filename} className="w-full rounded-lg object-cover" />
                      </a>
                    ))}
                  </div>
                )}

                {run.state === 'done' && run.outputs.length === 0 && (
                  <p className="mt-3 text-sm text-gray-400">Completed — no image outputs detected.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Browse sheet — full-screen overlay */}
      {showBrowse && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#0f0f0f]">
          <div className="sticky top-0 border-b border-white/10 bg-[#0f0f0f]/90 px-4 py-3 backdrop-blur flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Add Workflows</h2>
              <p className="text-xs text-gray-500">Tap + to add to My Workflows</p>
            </div>
            <button
              onClick={() => setShowBrowse(false)}
              className="rounded-full bg-white/10 w-8 h-8 flex items-center justify-center text-gray-400 active:bg-white/20"
            >
              ✕
            </button>
          </div>

          {browseLoading && (
            <div className="flex h-40 items-center justify-center text-gray-400 text-sm">Loading…</div>
          )}

          {browseError && (
            <div className="m-4 rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-300">
              <p className="font-semibold">Could not load workflows</p>
              <p className="mt-1 text-xs opacity-75">{browseError}</p>
              <button onClick={openBrowse} className="mt-3 rounded-lg bg-white/10 px-4 py-2 text-xs active:bg-white/20">Retry</button>
            </div>
          )}

          {!browseLoading && !browseError && (
            <div className="divide-y divide-white/5 overflow-y-auto">
              {serverWorkflows.map((wf) => {
                const isPinned = pinned.some((p) => p.filename === wf.filename)
                return (
                  <div key={wf.filename} className="flex items-center gap-3 px-4 py-3">
                    <p className={`flex-1 text-sm font-medium ${isPinned ? 'text-violet-300' : 'text-white'}`}>
                      {wf.name}
                    </p>
                    <button
                      onClick={() => isPinned ? handleRemovePin(wf.filename) : handleAddPin(wf)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
                        isPinned
                          ? 'bg-violet-900/40 text-violet-300 active:bg-violet-900/60'
                          : 'bg-white/10 text-gray-300 active:bg-white/20'
                      }`}
                    >
                      {isPinned ? '✓ Added' : '+ Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

