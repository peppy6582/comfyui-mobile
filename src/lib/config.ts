const STORAGE_KEY = 'comfyui_config'

export interface AppConfig {
  serverUrl: string   // ComfyUI + comfy-portal-endpoint (same host:port, e.g. http://192.168.1.240:8188)
  galleryUrl: string  // smart-comfyui-gallery URL
}

const defaults: AppConfig = {
  serverUrl: 'http://192.168.1.240:8188',
  galleryUrl: 'http://192.168.1.240:8189/galleryout',
}

export function getConfig(): AppConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Migrate old keys
      if (parsed.comfyuiUrl && !parsed.serverUrl) parsed.serverUrl = parsed.comfyuiUrl
      return { ...defaults, ...parsed }
    }
  } catch {}
  return { ...defaults }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}
