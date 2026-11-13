import { handleMenuClick, rebuildMenus } from './background/menus'
import { migrateFromV1 } from './background/migrate'
import {
  addList,
  clearAllTrash,
  deleteTabTrashEntry,
  deleteTrashEntry,
  putAllTrash,
  putTabTrashEntry,
  putTrashEntry,
  removeList,
  removeTabFromList,
  replaceLists,
  setListsOrder,
  restoreFromTrash,
  restoreTabFromTrash,
  updateList,
} from './background/mutations'
import {
  DEVICE_ALARM,
  DEVICE_PULL_ALARM,
  MIRROR_ALARM,
  SYNC_ALARM,
  autoSyncStartup,
  mirrorNow,
  onBookmarkPermissionRemoved,
  onDeviceRemoteChange,
  pullMerge,
  pushDeviceNow,
  pushNow,
  scheduleSync,
  setDeviceSync,
  setMirror,
  setupSync,
} from './background/sync'
import { isDeviceSyncChange } from './core/sync/device'
import {
  openTabLists,
  restoreLatestList,
  restoreList,
  storeAllTabs,
  storeAllTabsInAllWindows,
  storeLeftTabs,
  storeRightTabs,
  storeSelectedTabs,
  storeTwoSideTabs,
} from './background/tabs'
import type { Message } from './core/messages'
import { getLists, getOptions } from './core/storage'

/**
 * With a popup set, clicks open it and never reach onClicked — so for the
 * other browserAction modes the popup is cleared and we handle the click here.
 */
const applyBrowserAction = async () => {
  const opts = await getOptions()
  await chrome.action.setPopup({ popup: opts.browserAction === 'popup' ? 'popup.html' : '' })
}

chrome.action.onClicked.addListener(async () => {
  const opts = await getOptions()
  if (opts.browserAction === 'store-selected') storeSelectedTabs()
  else if (opts.browserAction === 'store-all') storeAllTabs()
  else openTabLists()
})

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install' || details.reason === 'update') {
    migrateFromV1().then(rebuildMenus).then(applyBrowserAction)
  }
  // First run: open the list page (pinned, so it stays as a home base) — its
  // empty state explains how to store the first tabs.
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html'), pinned: true }).catch(() => {})
  }
})

chrome.runtime.onStartup.addListener(() => {
  rebuildMenus()
  applyBrowserAction()
  autoSyncStartup()
})

// A revoked bookmarks permission means the mirror can no longer write — disable it.
chrome.permissions.onRemoved.addListener(permissions => {
  if (permissions.permissions?.includes('bookmarks')) onBookmarkPermissionRemoved()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenuClick(info, tab)
})

const commands: Record<string, () => Promise<unknown>> = {
  'store-selected-tabs': storeSelectedTabs,
  'store-all-tabs': storeAllTabs,
  'store-all-in-all-windows': storeAllTabsInAllWindows,
  'restore-latest-list': restoreLatestList,
  'open-lists': openTabLists,
}

chrome.commands.onCommand.addListener(command => {
  commands[command]?.()
})

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SYNC_ALARM) pushNow().catch(() => {})
  else if (alarm.name === DEVICE_ALARM) pushDeviceNow().catch(() => {})
  else if (alarm.name === DEVICE_PULL_ALARM) onDeviceRemoteChange().catch(() => {})
  else if (alarm.name === MIRROR_ALARM) mirrorNow().catch(() => {})
})

// Rebuild the "Store to list…" submenu when titled lists change.
let menuRebuildTimer: ReturnType<typeof setTimeout> | undefined
chrome.storage.onChanged.addListener((changes, area) => {
  // another device wrote to storage.sync → debounce a pull+merge
  if (area === 'sync') {
    if (isDeviceSyncChange(changes)) chrome.alarms.create(DEVICE_PULL_ALARM, { delayInMinutes: 0.25 })
    return
  }
  if (area !== 'local') return
  if (changes.lists || changes.opts) {
    clearTimeout(menuRebuildTimer)
    menuRebuildTimer = setTimeout(rebuildMenus, 2000)
  }
  if (changes.opts) {
    applyBrowserAction()
    // settings sync: option edits ride the same debounced upload as list edits
    scheduleSync()
  }
})

const storeHandlers = {
  selected: storeSelectedTabs,
  all: storeAllTabs,
  'all-windows': () => storeAllTabsInAllWindows(),
  left: storeLeftTabs,
  right: storeRightTabs,
  twoside: storeTwoSideTabs,
}

const handleMessage = async (message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> => {
  switch (message.type) {
    case 'store-tabs':
      return storeHandlers[message.which](message.listId)
    case 'list-add':
      return addList(message.list, message.index)
    case 'list-update':
      return updateList(message.id, message.patch)
    case 'list-remove':
      return removeList(message.id)
    case 'lists-set-order':
      return setListsOrder(message.ids)
    case 'lists-replace':
      return replaceLists(message.lists)
    case 'restore-list': {
      const lists = await getLists()
      const list = lists.find(l => l._id === message.id)
      if (!list) throw new Error('List not found')
      const { blocked } = await restoreList(list, { windowId: sender.tab?.windowId, newWindow: message.newWindow })
      // callers that don't decide (e.g. the popup) fall back to the option
      const opts = await getOptions()
      const remove = message.remove ?? (opts.openListAction === 'open-and-remove' && !list.pinned)
      if (remove) {
        // file:// tabs that couldn't open stay in the list instead of being lost with it
        if (blocked.length) await updateList(message.id, { tabs: blocked })
        else await removeList(message.id)
      }
      return { blockedFiles: blocked.length }
    }
    case 'trash-restore':
      return restoreFromTrash(message.id)
    case 'tab-remove':
      return removeTabFromList(message.listId, message.index, message.url)
    case 'tab-trash-restore':
      return restoreTabFromTrash(message.id)
    case 'trash-delete':
      return deleteTrashEntry(message.id, message.deletedAt)
    case 'trash-put':
      return putTrashEntry(message.entry)
    case 'tab-trash-delete':
      return deleteTabTrashEntry(message.id)
    case 'tab-trash-put':
      return putTabTrashEntry(message.entry)
    case 'trash-clear':
      return clearAllTrash()
    case 'trash-put-all':
      return putAllTrash(message.trash, message.tabTrash)
    case 'open-lists':
      return openTabLists()
    case 'sync-setup':
      return setupSync(message.token, message.gistId)
    case 'sync-push':
      return pushNow()
    case 'sync-pull':
      return pullMerge()
    case 'device-sync-set':
      return setDeviceSync(message.enabled)
    case 'mirror-set':
      return setMirror(message.enabled)
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender).then(
    result => sendResponse({ result }),
    error => sendResponse({ error: error instanceof Error ? error.message : String(error) }),
  )
  return true
})
