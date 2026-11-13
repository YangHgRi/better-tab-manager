import { getLists } from '../core/storage'
import type { TabList } from '../core/types'

/**
 * One-way mirror of the stored lists into the browser's bookmarks, so they can
 * be opened on mobile (where extensions don't run) via native bookmark sync.
 *
 * One-way means the extension is the sole writer and never reads bookmarks back
 * as a source: a folder "Better Tab Manager" under Other Bookmarks (off the
 * toolbar) is rebuilt from the lists. `bookmarks` is an optional permission, so
 * every entry point checks it first and no-ops when it isn't granted.
 */

const FOLDER_TITLE = 'Better Tab Manager'

export const hasBookmarkPermission = (): Promise<boolean> =>
  chrome.permissions.contains({ permissions: ['bookmarks'] })

/** Other Bookmarks is id '2' in Chrome/Brave; fall back to a sensible root child. */
const otherBookmarksId = async (): Promise<string> => {
  const [root] = await chrome.bookmarks.getTree()
  const children = root?.children ?? []
  const other = children.find(c => c.id === '2') ?? children.find(c => !c.url) ?? children[0]
  return other?.id ?? '2'
}

const findMirrorFolder = async (): Promise<chrome.bookmarks.BookmarkTreeNode | null> => {
  const parentId = await otherBookmarksId()
  const matches = await chrome.bookmarks.search({ title: FOLDER_TITLE })
  return matches.find(n => !n.url && n.parentId === parentId) ?? null
}

const ensureFolder = async (): Promise<string> => {
  const existing = await findMirrorFolder()
  if (existing) return existing.id
  const created = await chrome.bookmarks.create({ parentId: await otherBookmarksId(), title: FOLDER_TITLE })
  return created.id
}

const subfolderLabel = (list: TabList): string => {
  const title = list.title?.trim()
  if (title) return title
  try {
    const host = new URL(list.tabs[0]?.url ?? '').hostname.replace(/^www\./, '')
    return host || 'Untitled'
  } catch {
    return 'Untitled'
  }
}

const createBookmark = async (parentId: string, title: string, url: string) => {
  // Some URLs (javascript:, malformed) make bookmarks.create reject — skip them
  // rather than aborting the whole rebuild.
  try {
    await chrome.bookmarks.create({ parentId, title, url })
  } catch {
    /* skip unbookmarkable url */
  }
}

/**
 * Full teardown + rebuild of the mirror folder. The data set is small (the app
 * targets ~1–200 tabs), so a clean rebuild is simpler and less bug-prone than
 * diffing — at the cost of some bookmark-sync churn, which the debounce limits.
 */
export const rebuildMirror = async () => {
  if (!(await hasBookmarkPermission())) return
  const lists = await getLists()
  const folderId = await ensureFolder()

  const children = await chrome.bookmarks.getChildren(folderId)
  await Promise.all(children.map(c => chrome.bookmarks.removeTree(c.id).catch(() => {})))

  for (const list of lists) {
    const sub = await chrome.bookmarks.create({ parentId: folderId, title: subfolderLabel(list) })
    for (const tab of list.tabs) {
      if (tab.url) await createBookmark(sub.id, tab.title || tab.url, tab.url)
    }
  }
}

/** Removes the mirror folder entirely (on disable). */
export const teardownMirror = async () => {
  if (!(await hasBookmarkPermission())) return
  const folder = await findMirrorFolder()
  if (folder) await chrome.bookmarks.removeTree(folder.id).catch(() => {})
}
