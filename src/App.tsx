import { useState } from 'react'
import BottomNav from './components/BottomNav'
import WorkflowsPage from './pages/WorkflowsPage'
import GalleryPage from './pages/GalleryPage'
import SettingsPage from './pages/SettingsPage'

type Page = 'workflows' | 'gallery' | 'settings'

export default function App() {
  const [page, setPage] = useState<Page>('workflows')

  return (
    <div className="flex min-h-svh flex-col bg-[#0f0f0f] text-white">
      <main className="flex-1 overflow-y-auto pb-20">
        {page === 'workflows' && <WorkflowsPage />}
        {page === 'gallery'   && <GalleryPage />}
        {page === 'settings'  && <SettingsPage />}
      </main>
      <BottomNav active={page} onNavigate={(p) => setPage(p as Page)} />
    </div>
  )
}
