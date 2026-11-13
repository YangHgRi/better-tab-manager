import { createSnapshot, normalizeList, parseSnapshot, parseTombstones } from '../core/lists'
import { DEFAULT_OPTIONS, type Options } from '../core/options'
import {
  getDeviceId,
  getLists,
  getOptions,
  getOptsUpdatedAt,
  getSyncConfig,
  getTombstones,
  setLists,
  setOptions,
  setSyncConfig,
  setSyncState,
  setTombstones,
} from '../core/storage'
import { clearDevice, pushDevice, pullDevice, readDeviceMeta } from '../core/sync/device'
import { GistProvider, createSyncGist } from '../core/sync/gist'
import { mergeLists } from '../core/sync/merge'
import type { Snapshot, TabList, Tombstone } from '../core/types'
import { rebuildMirror, teardownMirror } from './bookmark-mirror'
import { enqueue } from './mutations'

export const SYNC_ALARM = 'sync-push' // gist
export const DEVICE_ALARM = 'device-push' // storage.sync write
export const DEVICE_PULL_ALARM = 'device-pull' // storage.sync remote-change merge
export const MIRROR_ALARM = 'mirror-sync' // bookmark rebuild
const PUSH_DELAY_MINUTES = 0.5
const FAST_DELAY_MINUTES = 0.25

/**
 * Debounced fan-out: every local mutation re-arms the alarms for whichever
 * transports are enabled, so a burst of edits results in one push per transport.
 * Alarms survive service-worker shutdown.
 */
export const scheduleSync = async () => {
  const config = await getSyncConfig()
  if (config.enabled && config.gistToken && config.gistId) {
    chrome.alarms.create(SYNC_ALARM, { delayInMinutes: PUSH_DELAY_MINUTES })
  }
  if (config.deviceSync) chrome.alarms.create(DEVICE_ALARM, { delayInMinutes: FAST_DELAY_MINUTES })
  if (config.bookmarkMirror) chrome.alarms.create(MIRROR_ALARM, { delayInMinutes: FAST_DELAY_MINUTES })
}

const buildSnapshot = async (): Promise<Snapshot> => {
  const [lists, tombstones, opts, optsUpdatedAt] = await Promise.all([
    getLists(),
    getTombstones(),
    getOptions(),
    getOptsUpdatedAt(),
  ])
  return createSnapshot(lists, tombstones, { opts: { ...opts }, optsUpdatedAt })
}

/** A stable fingerprint of the merge-relevant state, to tell whether a merge changed anything. */
const signature = (lists: TabList[], tombstones: Tombstone[]): string =>
  JSON.stringify([
    lists.map(l => [l._id, l.updatedAt]).sort(),
    tombstones.map(t => [t.id, t.deletedAt]).sort(),
  ])

// ---------------------------------------------------------------- gist push

export const pushNow = async () => {
  const config = await getSyncConfig()
  if (!config.enabled || !config.gistToken || !config.gistId) return
  try {
    await new GistProvider(config.gistToken, config.gistId).push(await buildSnapshot())
    await setSyncState({ lastPushAt: Date.now(), error: null })
  } catch (e) {
    await setSyncState({ error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

// -------------------------------------------------------------- device push

export const pushDeviceNow = async () => {
  const config = await getSyncConfig()
  if (!config.deviceSync) return
  try {
    const [lists, tombstones, deviceId] = await Promise.all([getLists(), getTombstones(), getDeviceId()])
    const { droppedLists } = await pushDevice(lists, tombstones, deviceId)
    await setSyncState({
      lastPushAt: Date.now(),
      error: droppedLists > 0 ? `Device sync over quota — ${droppedLists} oldest list(s) not synced` : null,
    })
  } catch (e) {
    await setSyncState({ error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

// --------------------------------------------------------------- merge core

/**
 * Merges a remote snapshot into local state (lists, tombstones, settings) as a
 * single queued unit so it's atomic against local edits. Returns whether the
 * merge actually changed anything; only then do we fan out to the other
 * transports, which keeps two devices from ping-ponging pushes forever.
 */
const applyRemoteSnapshot = async (snapshot: Snapshot): Promise<{ count: number; changed: boolean }> => {
  const remoteLists = parseSnapshot(snapshot)
  const remoteTombstones = parseTombstones(snapshot)

  const { merged, changed } = await enqueue(async () => {
    const [localLists, localTombstones] = await Promise.all([getLists(), getTombstones()])
    const before = signature(localLists, localTombstones)
    const m = mergeLists(localLists, localTombstones, remoteLists, remoteTombstones)
    await setLists(m.lists.map(normalizeList))
    await setTombstones(m.tombstones)
    return { merged: m, changed: before !== signature(m.lists, m.tombstones) }
  })

  // settings: last writer wins, keeping the remote's timestamp so the winner is stable
  if (
    snapshot.opts &&
    typeof snapshot.opts === 'object' &&
    typeof snapshot.optsUpdatedAt === 'number' &&
    snapshot.optsUpdatedAt > (await getOptsUpdatedAt())
  ) {
    await setOptions({ ...DEFAULT_OPTIONS, ...snapshot.opts } as Options, snapshot.optsUpdatedAt)
  }

  // Only re-broadcast when the merge produced new local state; converged devices
  // then stop pushing (a re-merge of identical data changes nothing).
  if (changed) scheduleSync()
  return { count: merged.lists.length, changed }
}

// ----------------------------------------------------------- device remote

/** Reacts to another device's storage.sync write: pull + merge (skips our own writes). */
export const onDeviceRemoteChange = async () => {
  const config = await getSyncConfig()
  if (!config.deviceSync) return
  const meta = await readDeviceMeta()
  if (!meta) return
  if (meta.deviceId === (await getDeviceId())) return // our own push
  try {
    const snapshot = await pullDevice()
    if (!snapshot) return
    await applyRemoteSnapshot(snapshot)
    await setSyncState({ lastPullAt: Date.now(), error: null })
  } catch (e) {
    await setSyncState({ error: e instanceof Error ? e.message : String(e) })
  }
}

/** Turns device sync on/off. Enabling adopts any existing remote data then pushes the merged result. */
export const setDeviceSync = async (enabled: boolean) => {
  await setSyncConfig({ ...(await getSyncConfig()), deviceSync: enabled })
  if (!enabled) return
  const snapshot = await pullDevice().catch(() => null)
  if (snapshot) await applyRemoteSnapshot(snapshot)
  await pushDeviceNow()
}

/** Full device-sync reset: turn it off everywhere and wipe the shared keys. */
export const resetDeviceSync = async () => {
  await setSyncConfig({ ...(await getSyncConfig()), deviceSync: false })
  await clearDevice().catch(() => {})
}

// ------------------------------------------------------------ bookmark mirror

export const setMirror = async (enabled: boolean) => {
  await setSyncConfig({ ...(await getSyncConfig()), bookmarkMirror: enabled })
  if (enabled) await rebuildMirror()
  else await teardownMirror()
}

/** Rebuilds the mirror if it's still enabled (guards against a stale alarm firing after disable). */
export const mirrorNow = async () => {
  if ((await getSyncConfig()).bookmarkMirror) await rebuildMirror()
}

/** Called when the user revokes the bookmarks permission from browser settings. */
export const onBookmarkPermissionRemoved = async () => {
  const config = await getSyncConfig()
  if (config.bookmarkMirror) await setSyncConfig({ ...config, bookmarkMirror: false })
}

// -------------------------------------------------------------------- gist

/**
 * Enables gist sync. Without a gist id it creates a fresh private gist; with one
 * (e.g. from a previous install) it adopts that gist and merges it in.
 */
export const setupSync = async (token: string, existingGistId?: string) => {
  const cleaned = existingGistId?.trim().replace(/^https:\/\/gist\.github\.com\/(?:[^/]+\/)?/, '')
  if (cleaned) {
    const snapshot = await new GistProvider(token, cleaned).pull()
    if (!snapshot) throw new Error('That gist has no Better Tab Manager sync data')
    await setSyncConfig({ ...(await getSyncConfig()), enabled: true, gistToken: token, gistId: cleaned })
    await applyRemoteSnapshot(snapshot)
    await setSyncState({ lastPullAt: Date.now(), error: null })
    return { gistId: cleaned }
  }
  const gistId = await createSyncGist(token, await buildSnapshot())
  await setSyncConfig({ ...(await getSyncConfig()), enabled: true, gistToken: token, gistId })
  await setSyncState({ lastPushAt: Date.now(), error: null })
  return { gistId }
}

export const pullMerge = async () => {
  const config = await getSyncConfig()
  if (!config.gistToken || !config.gistId) throw new Error('Sync is not configured')
  try {
    const snapshot = await new GistProvider(config.gistToken, config.gistId).pull()
    if (!snapshot) throw new Error('No sync data found in the gist')
    const { count } = await applyRemoteSnapshot(snapshot)
    await setSyncState({ lastPullAt: Date.now(), error: null })
    return { count }
  } catch (e) {
    await setSyncState({ error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

/** Best-effort convergence on browser startup for whichever transports are on. */
export const autoSyncStartup = async () => {
  const config = await getSyncConfig()
  if (config.enabled && config.gistToken && config.gistId) await pullMerge().catch(() => {})
  if (config.deviceSync) await onDeviceRemoteChange().catch(() => {})
  if (config.bookmarkMirror) await rebuildMirror().catch(() => {})
}
