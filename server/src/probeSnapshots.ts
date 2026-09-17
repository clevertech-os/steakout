/**
 * Background staker snapshots for public canary probe addresses.
 *
 * Restake (and unknown) canary coverage is classified from `staker_snapshots`.
 * Those rows were previously written only on authenticated position reads, so
 * Steakout's own probes stayed pending forever. This job reads each roster
 * probe via RPC and reuses `maybeWriteStakerSnapshot` (hourly throttle).
 *
 * Direct canaries still require a reward→probe payment to count as observed;
 * a snapshot here only fills profile last-balance fields.
 */

import type Database from 'better-sqlite3'
import { resolveExplorerNetwork } from './explorer.js'
import {
  getBlockNumber,
  getStakerByAddress,
  isStakerNotFoundError,
  type NimiqStaker,
} from './nimiq-rpc.js'
import {
  loadProbeRoster,
  type ProbeRosterEntry,
  type ProbeRosterFile,
} from './probeRoster.js'
import { maybeWriteStakerSnapshot, parseStakerBalances } from './stakingState.js'

export const DEFAULT_CANARY_SNAPSHOT_INTERVAL_MINUTES = 60

export interface CanarySnapshotCycleResult {
  considered: number
  written: number
  skippedThrottle: number
  skippedNoStaker: number
  skippedUnreadable: number
  skippedNetwork: boolean
  errors: number
}

export function rosterMatchesProcessNetwork(
  rosterNetwork: string,
  processNetwork: string | undefined = process.env.NIMIQ_NETWORK,
): boolean {
  return resolveExplorerNetwork(rosterNetwork) === resolveExplorerNetwork(processNetwork)
}

/** Restake + unknown probes; direct coverage still comes from payout txs. */
export function snapshotEligibleProbes(
  roster: ProbeRosterFile = loadProbeRoster(),
): ProbeRosterEntry[] {
  return roster.probes.filter(
    (probe) => probe.payoutType === 'restake' || probe.payoutType === 'unknown',
  )
}

export async function runCanarySnapshotCycle(options: {
  database: Database.Database
  roster?: ProbeRosterFile
  rpcUrl?: string
  nowMs?: number
  getStaker?: (address: string) => Promise<NimiqStaker>
  getBlock?: () => Promise<number>
  logger?: (line: string) => void
  /** Skip the roster-vs-NIMIQ_NETWORK guard (tests). */
  ignoreNetwork?: boolean
}): Promise<CanarySnapshotCycleResult> {
  const logger = options.logger ?? ((line: string) => console.log(line))
  const roster = options.roster ?? loadProbeRoster()
  const empty: CanarySnapshotCycleResult = {
    considered: 0,
    written: 0,
    skippedThrottle: 0,
    skippedNoStaker: 0,
    skippedUnreadable: 0,
    skippedNetwork: false,
    errors: 0,
  }

  if (
    !options.ignoreNetwork
    && !rosterMatchesProcessNetwork(roster.network)
  ) {
    logger(
      JSON.stringify({
        canarySnapshots: 'skip-network',
        rosterNetwork: roster.network,
        processNetwork: process.env.NIMIQ_NETWORK ?? 'main',
      }),
    )
    return { ...empty, skippedNetwork: true }
  }

  const probes = snapshotEligibleProbes(roster)
  const result: CanarySnapshotCycleResult = {
    ...empty,
    considered: probes.length,
  }
  if (probes.length === 0) return result

  const getStaker =
    options.getStaker
    ?? ((address: string) => getStakerByAddress(address, options.rpcUrl))
  const getBlock =
    options.getBlock ?? (() => getBlockNumber(options.rpcUrl))
  const nowMs = options.nowMs ?? Date.now()

  let sourceBlock: number
  try {
    sourceBlock = await getBlock()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger(JSON.stringify({ canarySnapshots: 'block-error', error: message }))
    return { ...result, errors: probes.length }
  }
  if (!Number.isInteger(sourceBlock) || sourceBlock < 0) {
    logger(JSON.stringify({ canarySnapshots: 'block-invalid', sourceBlock }))
    return { ...result, errors: probes.length }
  }

  for (const probe of probes) {
    try {
      const staker = await getStaker(probe.probeAddress)
      const balances = parseStakerBalances(staker)
      if (balances == null) {
        result.skippedUnreadable += 1
        continue
      }
      const wrote = maybeWriteStakerSnapshot(options.database, {
        userAddress: probe.probeAddress,
        validatorAddress: probe.validatorAddress,
        activeLuna: balances.activeLuna,
        inactiveLuna: balances.inactiveLuna,
        retiredLuna: balances.retiredLuna,
        totalLuna: balances.totalLuna,
        sourceBlock,
        nowMs,
      })
      if (wrote) result.written += 1
      else result.skippedThrottle += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isStakerNotFoundError(message)) {
        result.skippedNoStaker += 1
        continue
      }
      result.errors += 1
      logger(
        JSON.stringify({
          canarySnapshots: 'probe-error',
          probeId: probe.probeId,
          error: message,
        }),
      )
    }
  }

  logger(
    JSON.stringify({
      canarySnapshots: 'cycle',
      ...result,
      sourceBlock,
    }),
  )
  return result
}

export function startCanarySnapshotScheduler(
  database: Database.Database,
  options?: {
    intervalMs?: number
    rpcUrl?: string
    logger?: (line: string) => void
    runOnStart?: boolean
  },
): { stop: () => void } {
  let running = false
  const run = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      await runCanarySnapshotCycle({
        database,
        rpcUrl: options?.rpcUrl,
        logger: options?.logger,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const logger = options?.logger ?? ((line: string) => console.log(line))
      logger(JSON.stringify({ canarySnapshots: 'cycle-error', error: message }))
    } finally {
      running = false
    }
  }

  if (options?.runOnStart !== false) void run()
  const intervalMs = options?.intervalMs ?? DEFAULT_CANARY_SNAPSHOT_INTERVAL_MINUTES * 60_000
  const timer = setInterval(() => void run(), intervalMs)
  return { stop: () => clearInterval(timer) }
}

export function canarySnapshotIntervalMsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const configured = Number(env.CANARY_SNAPSHOT_INTERVAL_MINUTES ?? DEFAULT_CANARY_SNAPSHOT_INTERVAL_MINUTES)
  const minutes = Number.isFinite(configured)
    ? Math.min(180, Math.max(15, configured))
    : DEFAULT_CANARY_SNAPSHOT_INTERVAL_MINUTES
  return minutes * 60_000
}
