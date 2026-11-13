export interface TabGroupInfo {
  title: string
  /** Chrome tab-group color name ('blue', 'red', ...). */
  color: string
}

export interface TabItem {
  url: string
  title: string
  favIconUrl?: string
  pinned?: boolean
  muted?: boolean
  group?: TabGroupInfo
}

/** Records a deleted list id so deletions propagate through sync instead of resurrecting. */
export interface Tombstone {
  id: string
  deletedAt: number
}

export interface TabList {
  _id: string
  tabs: TabItem[]
  title: string
  tags: string[]
  time: number
  pinned: boolean
  expand: boolean
  color: string
  updatedAt: number
}

/** A deleted list kept locally for a while so it can be recovered from History. */
export interface TrashEntry {
  list: TabList
  deletedAt: number
}

/** A single tab removed from a list, kept locally so it can be recovered from History. */
export interface TrashTabEntry {
  id: string
  tab: TabItem
  /** The list it came from, so recovery can put it back. */
  listId: string
  listTitle: string
  deletedAt: number
}

/** The JSON document used for manual export/import and for Gist sync. */
export interface Snapshot {
  format: 'even-better-onetab/1'
  exportedAt: number
  lists: TabList[]
  tombstones?: Tombstone[]
  /** Synced settings (last-writer-wins by optsUpdatedAt). */
  opts?: Record<string, unknown>
  optsUpdatedAt?: number
}

export interface SyncConfig {
  /** GitHub gist auto-sync (the original, token-based transport). */
  enabled: boolean
  gistToken: string
  gistId: string
  /** Cross-device sync via chrome.storage.sync (rides the browser's own sync). Opt-in. */
  deviceSync: boolean
  /** One-way mirror of the lists into the browser's bookmarks (mobile access). Opt-in. */
  bookmarkMirror: boolean
}

export interface SyncState {
  lastPushAt: number | null
  lastPullAt: number | null
  error: string | null
}
