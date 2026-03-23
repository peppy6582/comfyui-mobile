import { getConfig } from '../lib/config'

export default function GalleryPage() {
  const { galleryUrl } = getConfig()

  return (
    <div className="flex h-[calc(100svh-5rem)] flex-col">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0f0f0f]/90 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">Gallery</h1>
        <p className="text-xs text-gray-500 truncate">{galleryUrl}</p>
      </div>
      <iframe
        src={galleryUrl}
        className="flex-1 w-full border-0 bg-[#0f0f0f]"
        title="ComfyUI Gallery"
        allow="fullscreen"
      />
    </div>
  )
}
