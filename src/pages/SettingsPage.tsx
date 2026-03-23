import { useState } from 'react'
import { getConfig, saveConfig, type AppConfig } from '../lib/config'

export default function SettingsPage() {
  const [config, setConfig] = useState<AppConfig>(getConfig)
  const [saved, setSaved] = useState(false)

  function handleSave() {
    saveConfig(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function update(key: keyof AppConfig, value: string) {
    setConfig((c) => ({ ...c, [key]: value }))
    setSaved(false)
  }

  return (
    <div className="flex flex-col gap-0">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0f0f0f]/90 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <div className="p-4 flex flex-col gap-6">

        {/* Server */}
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
            Server
          </p>
          <Field
            label="ComfyUI Server URL"
            hint="Used for workflows, queue, WebSocket, and gallery. ComfyUI + comfy-portal-endpoint share this address."
            value={config.serverUrl}
            onChange={(v) => update('serverUrl', v)}
            placeholder="http://192.168.1.240:8188"
          />
        </section>

        {/* Gallery */}
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
            Smart Gallery
          </p>
          <Field
            label="Gallery URL"
            hint="smart-comfyui-gallery address"
            value={config.galleryUrl}
            onChange={(v) => update('galleryUrl', v)}
            placeholder="http://192.168.1.240:8189/galleryout"
          />
        </section>

        {/* Save */}
        <button
          onClick={handleSave}
          className={`w-full rounded-xl py-3.5 text-sm font-semibold transition-colors
            ${saved
              ? 'bg-green-700 text-white'
              : 'bg-violet-600 text-white active:bg-violet-700'}`}
        >
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>

        <p className="text-center text-xs text-gray-600">
          Settings are stored locally in your browser.
        </p>
      </div>
    </div>
  )
}

function Field({
  label, hint, value, onChange, placeholder,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-4">
      <label className="block text-sm font-medium text-white mb-0.5">{label}</label>
      <p className="text-xs text-gray-500 mb-2">{hint}</p>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-[#0f0f0f] px-3 py-2
          text-sm text-white placeholder-gray-600
          focus:border-violet-500 focus:outline-none"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
    </div>
  )
}
