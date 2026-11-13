<script lang="ts">
  import { openFileAccessSettings } from '../core/file-urls'
  import { send } from '../core/messages'
  import { t } from '../i18n/i18n.svelte'
  import Icon from '../ui/Icon.svelte'
  import { app, applyTheme, initState } from '../ui/state.svelte'

  initState()

  $effect(() => {
    if (app.loaded) applyTheme(app.opts.theme)
  })

  const recent = $derived(app.lists.slice(0, 6))

  const store = async (which: 'all' | 'selected') => {
    await send({ type: 'store-tabs', which })
    window.close()
  }

  // file:// tabs held back for lack of file-URL access; the popup stays open to explain
  let blockedFiles = $state(0)

  const restore = async (id: string) => {
    const result = await send<{ blockedFiles?: number }>({ type: 'restore-list', id })
    if (result?.blockedFiles) {
      blockedFiles = result.blockedFiles
      return
    }
    window.close()
  }

  const fixFileAccess = async () => {
    await openFileAccessSettings()
    window.close()
  }

  const openLists = async () => {
    await send({ type: 'open-lists' })
    window.close()
  }

  const hostOf = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }

  /**
   * What to show as a recent list's main label. Titled lists show their title;
   * untitled ones (the common "save selected" case) preview the actual sites
   * instead of a bare "N tabs" — the single-tab title, or the deduped hosts.
   */
  const listLabel = (list: (typeof recent)[number]) => {
    if (list.title) return list.title
    const tabs = list.tabs
    if (tabs.length === 0) return t('popup.tabCount', { n: 0 })
    if (tabs.length === 1) return tabs[0].title?.trim() || hostOf(tabs[0].url)
    return [...new Set(tabs.map(x => hostOf(x.url)))].join(', ')
  }

  /** Full tab list for the hover tooltip. */
  const listTooltip = (list: (typeof recent)[number]) =>
    list.tabs.map(tb => tb.title?.trim() || tb.url).join('\n')
</script>

<main>
  <div class="actions">
    <button class="action" onclick={() => store('all')}>
      <Icon name="archive" size={17} />
      <span>{t('popup.storeAll')}</span>
    </button>
    <button class="action" onclick={() => store('selected')}>
      <Icon name="download" size={17} />
      <span>{t('popup.storeSelected')}</span>
    </button>
  </div>

  {#if blockedFiles}
    <div class="notice">
      <span>{t('files.blocked', { n: blockedFiles })}</span>
      <button class="notice-btn" onclick={fixFileAccess}>{t('files.openSettings')}</button>
    </div>
  {/if}

  {#if recent.length > 0}
    <div class="section-label">{t('popup.recentLists')}</div>
    <div class="recent">
      {#each recent as list (list._id)}
        <button class="recent-item" title={listTooltip(list)} onclick={() => restore(list._id)}>
          <span class="recent-title">{listLabel(list)}</span>
          <span class="slot">
            <span class="recent-count">{t('popup.tabCount', { n: list.tabs.length })}</span>
            <span class="restore-icon"><Icon name="restore" size={14} /></span>
          </span>
        </button>
      {/each}
    </div>
  {:else if app.loaded}
    <div class="empty">{t('popup.empty')}</div>
  {/if}

  <button class="footer" onclick={openLists}>
    <Icon name="layers" size={15} />
    <span>{t('popup.openApp')}</span>
  </button>
</main>

<style>
  main {
    width: 300px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .action {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: var(--radius-sm);
    font-weight: 500;
    text-align: left;
  }

  .action:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .section-label {
    margin: 8px 10px 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
  }

  .recent {
    display: flex;
    flex-direction: column;
  }

  .recent-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    text-align: left;
    min-width: 0;
  }

  .recent-item:hover {
    background: var(--surface-hover);
  }

  :global([data-theme='dark']) .recent-item:hover {
    background: var(--surface-2);
  }

  .recent-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-count {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-3);
    white-space: nowrap;
  }

  /* time and restore icon share one grid cell so swapping them on hover can't shift layout */
  .slot {
    display: grid;
    justify-items: end;
    align-items: center;
    flex-shrink: 0;
  }

  .slot > * {
    grid-area: 1 / 1;
  }

  .restore-icon {
    display: inline-flex;
    visibility: hidden;
    color: var(--accent);
  }

  .recent-item:hover .restore-icon {
    visibility: visible;
  }

  .recent-item:hover .recent-count {
    visibility: hidden;
  }

  .notice {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 4px 2px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--text);
    font-size: 12.5px;
    line-height: 1.4;
  }

  .notice-btn {
    align-self: flex-start;
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 12px;
  }

  .empty {
    padding: 14px 10px;
    color: var(--text-3);
    text-align: center;
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 4px;
    padding: 9px;
    border-top: 1px solid var(--border);
    color: var(--text-2);
    font-weight: 500;
  }

  .footer:hover {
    color: var(--accent);
  }
</style>
