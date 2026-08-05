import './BottomNav.css'
import { NAV_ROUTES, type RouteId } from '../routes'
import { prefetchValidatorsDirectory } from '../validators/api'

interface BottomNavProps {
  active: RouteId
}

function warmValidatorsIntent() {
  void loadValidatorsChunk()
  prefetchValidatorsDirectory()
}

function loadValidatorsChunk() {
  void import('../validators/Validators')
}

/**
 * Icons are inline SVGs (lucide-style 24px stroke) so the shell stays
 * dependency-free — lucide-react is not yet in client dependencies.
 */
function NavIcon({ id }: { id: RouteId }) {
  const svgProps = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (id) {
    case 'home':
      return (
        <svg {...svgProps}>
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      )
    case 'validators':
      return (
        <svg {...svgProps}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      )
    case 'activity':
      return (
        <svg {...svgProps}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      )
    case 'learn':
      return (
        <svg {...svgProps}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      )
  }
}

export default function BottomNav({ active }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <ul className="bottom-nav-list" role="list">
        {NAV_ROUTES.map((route) => {
          const isActive = route.id === active
          return (
            <li key={route.id} className="bottom-nav-item">
              <a
                className={isActive ? 'bottom-nav-link is-active' : 'bottom-nav-link'}
                href={`#${route.path}`}
                aria-current={isActive ? 'page' : undefined}
                aria-label={route.label}
                onPointerEnter={
                  route.id === 'validators' ? warmValidatorsIntent : undefined
                }
                onFocus={
                  route.id === 'validators' ? warmValidatorsIntent : undefined
                }
              >
                <NavIcon id={route.id} />
                <span className="bottom-nav-label" aria-hidden="true">
                  {route.label}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
