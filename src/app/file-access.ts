import { openFileAccessSettings } from '../core/file-urls'
import { t } from '../i18n/i18n.svelte'
import { toast } from '../ui/toast.svelte'

/** Explains that n file:// tabs couldn't open, with a button to the toggle that fixes it. */
export const showFileAccessToast = (n: number) =>
  toast(t('files.blocked', { n }), 'info', { label: t('files.openSettings'), fn: () => void openFileAccessSettings() }, 10000)
