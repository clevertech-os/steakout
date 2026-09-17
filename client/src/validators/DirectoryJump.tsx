/**
 * Jump index for the validator directory.
 * Portaled overlay: native <dialog> sat under the bottom nav (app-main z-index).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shortAddress } from '../addresses'
import type { ValidatorListItem } from './api'
import {
  groupValidatorsByLetter,
  matchesDirectoryQuery,
  validatorDisplayName,
} from './directoryBrowse'
import './DirectoryJump.css'

export interface DirectoryJumpProps {
  validators: ValidatorListItem[]
  currentIndex: number
  onClose: () => void
  onJump: (address: string) => void
}

function letterSectionId(letter: string): string {
  return `directory-jump-letter-${letter === '#' ? 'other' : letter}`
}

export default function DirectoryJump({
  validators,
  currentIndex,
  onClose,
  onJump,
}: DirectoryJumpProps) {
  const titleId = useId()
  const searchId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const groupsRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(
    () => validators.filter((v) => matchesDirectoryQuery(v, query)),
    [validators, query],
  )
  const groups = useMemo(() => groupValidatorsByLetter(filtered), [filtered])

  useEffect(() => {
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div className="directory-jump-root">
      <button
        type="button"
        className="directory-jump-backdrop"
        aria-label="Close jump list"
        onClick={onClose}
      />
      <div
        className="directory-jump-sheet nq-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="directory-jump-head">
          <h2 id={titleId} className="directory-jump-title">
            Jump to a validator
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="nq-ghost-btn directory-jump-close"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <label className="directory-jump-field" htmlFor={searchId}>
          <span className="nq-label">Find</span>
          <input
            id={searchId}
            type="search"
            className="directory-select nq-input-box"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or address"
            autoComplete="off"
          />
        </label>

        {groups.length > 1 ? (
          <nav className="directory-jump-letters" aria-label="Letter index">
            {groups.map((group) => {
              const sectionId = letterSectionId(group.letter)
              return (
                <button
                  key={group.letter}
                  type="button"
                  className="directory-jump-letter nq-focusable"
                  onClick={() => {
                    const section = groupsRef.current?.querySelector(
                      `#${CSS.escape(sectionId)}`,
                    )
                    section?.scrollIntoView({ block: 'start', behavior: 'auto' })
                  }}
                >
                  {group.letter}
                </button>
              )
            })}
          </nav>
        ) : null}

        {filtered.length === 0 ? (
          <p className="directory-jump-empty">No validators match that search.</p>
        ) : (
          <div ref={groupsRef} className="directory-jump-groups">
            {groups.map((group) => (
              <section
                key={group.letter}
                className="directory-jump-group"
                aria-labelledby={letterSectionId(group.letter)}
              >
                <h3
                  id={letterSectionId(group.letter)}
                  className="directory-jump-group-title"
                >
                  {group.letter === '#' ? 'Other' : group.letter}
                </h3>
                <ul className="directory-jump-list">
                  {group.items.map(({ validator, listIndex }) => {
                    const name = validatorDisplayName(validator)
                    const isCurrent = listIndex === currentIndex
                    return (
                      <li key={validator.address}>
                        <button
                          type="button"
                          className={
                            isCurrent
                              ? 'directory-jump-item is-current'
                              : 'directory-jump-item'
                          }
                          onClick={() => onJump(validator.address)}
                        >
                          <span className="directory-jump-item-index mono">
                            {listIndex + 1}
                          </span>
                          <span className="directory-jump-item-copy">
                            <span className="directory-jump-item-name">{name}</span>
                            <span className="directory-jump-item-addr">
                              {shortAddress(validator.address)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
