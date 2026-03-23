interface NavItem {
  id: string
  label: string
  icon: string
}

const items: NavItem[] = [
  { id: 'workflows', label: 'Workflows', icon: '▶' },
  { id: 'gallery',   label: 'Gallery',   icon: '🖼' },
  { id: 'settings',  label: 'Settings',  icon: '⚙' },
]

interface Props {
  active: string
  onNavigate: (page: string) => void
}

export default function BottomNav({ active, onNavigate }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-white/10 bg-[#1a1a1a]"
         style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors
            ${active === item.id ? 'text-violet-400' : 'text-gray-500 active:text-gray-300'}`}
        >
          <span className="text-lg leading-none">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  )
}
