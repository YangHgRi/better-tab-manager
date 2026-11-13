import { createSnapshot } from '../lists'
import type { Snapshot, TabItem, TabList, Tombstone } from '../types'

/**
 * Cross-device sync over `chrome.storage.sync`. Unlike the gist provider (one
 * blob), storage.sync caps each item at 8 KB and the whole area at 100 KB, so
 * the snapshot is serialized to JSON and split into fixed-size string chunks
 * across keys `bms/0`, `bms/1`, …, with a `bms/meta` describing the set. The
 * chunking is pure transport — the reassembled JSON is a normal Snapshot that
 * merges per-list like any other.
 *
 * Local storage stays the source of truth; this only ever carries a lightweight
 * copy (data: favicons stripped) and degrades gracefully if a user exceeds the
 * quota rather than failing the core app.
 */

const PREFIX = 'bms/'
const META_KEY = 'bms/meta'
// 2000 code points is safely under the 8 KB item cap even if every char is a
// 3–4 byte multibyte glyph (2000 × 4 = 8000 B < 8192 B).
const CHUNK_CODEPOINTS = 2000
// Keep well under the 100 KB area cap; the remainder is headroom for the meta
// key and storage.sync's own bookkeeping.
const TOTAL_BUDGET_BYTES = 92_000

export interface DeviceMeta {
  chunks: number
  updatedAt: number
  /** Which install last wrote this, so a device can skip reacting to its own push. */
  deviceId: string
}

const byteLen = (s: string) => new TextEncoder().encode(s).length

/** Drop only inline data: favicons; keep cheap URL favicons (they reload on the other device). */
const stripDataFavicon = (tab: TabItem): TabItem => {
  if (tab.favIconUrl?.startsWith('data:')) {
    const { favIconUrl: _drop, ...rest } = tab
    return rest
  }
  return tab
}

const dropAllFavicons = (tab: TabItem): TabItem => {
  const { favIconUrl: _drop, ...rest } = tab
  return rest
}

const mapTabs = (lists: TabList[], f: (t: TabItem) => TabItem): TabList[] =>
  lists.map(l => ({ ...l, tabs: l.tabs.map(f) }))

/**
 * Serialize under the area budget. First strip data: favicons; if still over,
 * drop all favicons; if still over, drop whole lists oldest-first (lowest
 * updatedAt) so the freshest lists survive.
 */
const buildPayload = (lists: TabList[], tombstones: Tombstone[]): { json: string; droppedLists: number } => {
  const snap = (ls: TabList[]) => JSON.stringify(createSnapshot(ls, tombstones))

  let working = mapTabs(lists, stripDataFavicon)
  let json = snap(working)
  if (byteLen(json) <= TOTAL_BUDGET_BYTES) return { json, droppedLists: 0 }

  working = mapTabs(working, dropAllFavicons)
  json = snap(working)

  let droppedLists = 0
  while (byteLen(json) > TOTAL_BUDGET_BYTES && working.length > 1) {
    let oldest = 0
    for (let i = 1; i < working.length; i++) {
      if (working[i].updatedAt < working[oldest].updatedAt) oldest = i
    }
    working.splice(oldest, 1)
    droppedLists++
    json = snap(working)
  }
  return { json, droppedLists }
}

const chunkString = (s: string): string[] => {
  const cps = [...s] // code points, so a chunk boundary never splits a surrogate pair
  const out: string[] = []
  for (let i = 0; i < cps.length; i += CHUNK_CODEPOINTS) out.push(cps.slice(i, i + CHUNK_CODEPOINTS).join(''))
  return out
}

/** Writes the snapshot to storage.sync; returns how many lists the quota guard had to drop. */
export const pushDevice = async (
  lists: TabList[],
  tombstones: Tombstone[],
  deviceId: string,
): Promise<{ droppedLists: number }> => {
  const { json, droppedLists } = buildPayload(lists, tombstones)
  const chunks = chunkString(json)

  const toSet: Record<string, unknown> = {}
  chunks.forEach((c, i) => (toSet[PREFIX + i] = c))
  const meta: DeviceMeta = { chunks: chunks.length, updatedAt: Date.now(), deviceId }
  toSet[META_KEY] = meta

  // remove chunk keys left over from a previously larger payload
  const existing = await chrome.storage.sync.get(null)
  const stale = Object.keys(existing).filter(k => k.startsWith(PREFIX) && k !== META_KEY && !(k in toSet))

  await chrome.storage.sync.set(toSet)
  if (stale.length) await chrome.storage.sync.remove(stale)
  return { droppedLists }
}

export const readDeviceMeta = async (): Promise<DeviceMeta | null> => {
  const { [META_KEY]: meta } = await chrome.storage.sync.get(META_KEY)
  if (meta && typeof meta === 'object' && typeof (meta as DeviceMeta).chunks === 'number') return meta as DeviceMeta
  return null
}

/** Reassembles the snapshot from its chunks, or null if none / incomplete / unparseable. */
export const pullDevice = async (): Promise<Snapshot | null> => {
  const meta = await readDeviceMeta()
  if (!meta) return null
  const keys = Array.from({ length: meta.chunks }, (_, i) => PREFIX + i)
  const got = await chrome.storage.sync.get(keys)
  let json = ''
  for (let i = 0; i < meta.chunks; i++) {
    const part = got[PREFIX + i]
    if (typeof part !== 'string') return null // a chunk is missing — treat as no data
    json += part
  }
  try {
    return JSON.parse(json) as Snapshot
  } catch {
    return null
  }
}

/** Removes all of this extension's device-sync keys (used on a full reset). */
export const clearDevice = async () => {
  const existing = await chrome.storage.sync.get(null)
  const keys = Object.keys(existing).filter(k => k.startsWith(PREFIX))
  if (keys.length) await chrome.storage.sync.remove(keys)
}

/** True if a storage.sync change touched our device-sync keys. */
export const isDeviceSyncChange = (changes: Record<string, chrome.storage.StorageChange>): boolean =>
  Object.keys(changes).some(k => k.startsWith(PREFIX))
