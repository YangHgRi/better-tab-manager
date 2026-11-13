/**
 * Chrome only lets an extension open file:// pages once the user has turned on
 * "Allow access to file URLs" on the extension's details page — there is no
 * permission an extension can request instead. Without that toggle,
 * tabs.create / windows.create reject ("Cannot navigate to a file URL without
 * local file access"), so every open path checks first and degrades gracefully
 * instead of silently doing nothing.
 */

export const isFileUrl = (url: string) => url.startsWith('file:')

export const canOpenFileUrls = (): Promise<boolean> =>
  chrome.extension.isAllowedFileSchemeAccess().catch(() => false)

/** The extension's details page, where the "Allow access to file URLs" toggle lives. */
export const openFileAccessSettings = () =>
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })

/** Splits tabs into those this extension can open right now and file:// ones it can't. */
export const splitOpenable = async <T extends { url: string }>(tabs: T[]): Promise<{ openable: T[]; blocked: T[] }> => {
  if (!tabs.some(t => isFileUrl(t.url)) || (await canOpenFileUrls())) return { openable: tabs, blocked: [] }
  return {
    openable: tabs.filter(t => !isFileUrl(t.url)),
    blocked: tabs.filter(t => isFileUrl(t.url)),
  }
}
