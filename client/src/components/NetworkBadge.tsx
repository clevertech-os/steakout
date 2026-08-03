import './NetworkBadge.css'

/**
 * Badge shown whenever the build targets a non-mainnet network
 * (ARCHITECTURE.md §11: "the UI always displays which network it is on
 * when not mainnet").
 *
 * Placeholder logic (P1-07): reads the build-time env var directly.
 * A later task can wire this to /api/health or shared config.
 */
const network = (import.meta.env.VITE_NIMIQ_NETWORK ?? 'mainnet').trim().toLowerCase()

export default function NetworkBadge() {
  if (network === 'mainnet') {
    return null
  }

  return (
    <p className="network-badge" role="status">
      <span className="network-badge-dot" aria-hidden="true" />
      Network: {network}
    </p>
  )
}
