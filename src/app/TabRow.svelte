<script lang="ts">
  import type { TabItem } from '../core/types'
  import type { Options } from '../core/options'
  import { GROUP_COLORS } from '../ui/colors'
  import Icon from '../ui/Icon.svelte'
  import { t } from '../i18n/i18n.svelte'
  import {
    addSelect,
    armClickSuppression,
    checkboxesVisible,
    consumeClickSuppression,
    drag,
    isSelected,
    selection,
    selectionCount,
    toggleSelect,
  } from '../ui/selection.svelte'

  let {
    tab,
    listId = '',
    index = 0,
    display,
    hideFavicon,
    removeVisible = 'hover',
    onOpen,
    onRemove,
    onRemoveSelection = () => {},
    onEdit = () => {},
  }: {
    tab: TabItem
    listId?: string
    index?: number
    display: Options['itemDisplay']
    hideFavicon: boolean
    /** Whether the remove button shows always or only on row hover. */
    removeVisible?: 'hover' | 'always'
    /** keep = true when a modifier (cmd/ctrl) is held, meaning "don't remove". */
    onOpen: (keep: boolean) => void
    onRemove: () => void
    /** Remove every selected tab at once (× on a row that's part of a selection). */
    onRemoveSelection?: () => void
    /** Commit a rename of this link's title. */
    onEdit?: (title: string) => void
  } = $props()

  let faviconFailed = $state(false)

  const domain = $derived.by(() => {
    try {
      return new URL(tab.url).hostname
    } catch {
      return ''
    }
  })

  const letter = $derived((tab.title || domain || '?').charAt(0).toUpperCase())
  // While a multi-drag is in flight the rows reorder under svelte-dnd-action, so
  // the index-based highlight would chase the wrong rows — freeze the selection
  // visuals during the drag. The move still commits on release from the snapshot.
  const selected = $derived(isSelected(listId, index) && !drag.active)
  const showCheck = $derived(checkboxesVisible() && !drag.active)

  // --- inline title edit (title only; the url is left alone) ---
  let editing = $state(false)
  let titleDraft = $state('')

  const startEdit = () => {
    titleDraft = tab.title ?? ''
    editing = true
  }

  const commitEdit = () => {
    if (!editing) return
    editing = false
    const title = titleDraft.trim()
    if (title !== (tab.title ?? '')) onEdit(title)
  }

  const cancelEdit = () => {
    editing = false
  }

  // --- selection gestures ---
  const onPointerDown = (e: PointerEvent) => {
    if (!e.shiftKey) return // plain press: leave it to click (open) / drag (dnd)
    selection.brushing = true
    addSelect(listId, index)
    armClickSuppression() // don't let the trailing click toggle the anchor back off
  }

  const onPointerEnter = () => {
    if (selection.brushing) addSelect(listId, index)
  }

  const onRowClick = (e: MouseEvent) => {
    if (consumeClickSuppression()) return
    if (e.shiftKey || showCheck) {
      toggleSelect(listId, index)
      return
    }
    onOpen(e.metaKey || e.ctrlKey)
  }

  const onRemoveClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (selected && selectionCount() > 0) onRemoveSelection()
    else onRemove()
  }
</script>

{#if editing}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="row editing">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="edit-input"
      type="text"
      autofocus
      placeholder={t('tab.editTitlePlaceholder')}
      bind:value={titleDraft}
      onblur={commitEdit}
      onkeydown={e => {
        if (e.key === 'Enter') commitEdit()
        if (e.key === 'Escape') cancelEdit()
      }}
    />
    <button class="icon-act" title={t('tab.saveEdit')} aria-label={t('tab.saveEdit')} onclick={commitEdit}>
      <Icon name="check" size={15} />
    </button>
  </div>
{:else}
  <div
    class="row"
    class:selected
    role="button"
    tabindex="0"
    onpointerdown={onPointerDown}
    onpointerenter={onPointerEnter}
    onclick={onRowClick}
    onkeydown={e => e.key === 'Enter' && onRowClick(e as unknown as MouseEvent)}
  >
    {#if showCheck}
      <span class="check" class:on={selected} aria-hidden="true">
        {#if selected}<Icon name="check" size={12} />{/if}
      </span>
    {:else if !hideFavicon}
      {#if tab.favIconUrl && !faviconFailed}
        <img class="favicon" src={tab.favIconUrl} alt="" onerror={() => (faviconFailed = true)} />
      {:else}
        <span class="favicon fallback">{letter}</span>
      {/if}
    {/if}

    {#if tab.group}
      <span
        class="group"
        class:unnamed={!tab.group.title}
        style:--gc={GROUP_COLORS[tab.group.color] ?? GROUP_COLORS.grey}
        title={t('tab.group', { title: tab.group.title || t('tab.unnamed') })}
      >{tab.group.title}</span>
    {/if}

    {#if display === 'url'}
      <span class="url only">{tab.url}</span>
    {:else}
      <span class="title">{tab.title || tab.url}</span>
      {#if display === 'title-and-url'}
        <span class="url">{domain || tab.url}</span>
      {/if}
    {/if}

    {#if tab.pinned}
      <span class="pinned" title={t('tab.wasPinned')}><Icon name="pin" size={11} /></span>
    {/if}

    <button
      class="icon-act edit"
      title={t('tab.edit')}
      aria-label={t('tab.edit')}
      onclick={e => {
        e.stopPropagation()
        startEdit()
      }}
    >
      <Icon name="edit" size={13} />
    </button>

    <button
      class="icon-act remove"
      class:always={removeVisible === 'always'}
      title={t('tab.remove')}
      aria-label={t('tab.remove')}
      onclick={onRemoveClick}
    >
      <Icon name="x" size={13} />
    </button>
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 34px;
    border-radius: 7px;
    cursor: pointer;
    min-width: 0;
  }

  .row:hover {
    background: var(--surface-hover);
  }

  :global(.comfortable) .row {
    padding-top: 10px;
    padding-bottom: 10px;
  }

  :global([data-theme='dark']) .row:hover {
    background: var(--surface-2);
  }

  .row.selected {
    background: var(--accent-soft);
  }

  .row.editing {
    padding-left: 34px;
    gap: 8px;
  }

  .favicon {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .favicon.fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 10px;
    font-weight: 600;
  }

  .check {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1.5px solid var(--text-3);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
  }

  .check.on {
    background: var(--accent);
    border-color: var(--accent);
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 1;
  }

  .url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-3);
    font-size: 12px;
    flex: 1;
    min-width: 60px;
  }

  .url.only {
    color: var(--text-2);
    font-size: 13px;
  }

  .pinned {
    display: inline-flex;
    color: var(--text-3);
    flex-shrink: 0;
  }

  .group {
    flex-shrink: 0;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--gc) 18%, transparent);
    color: var(--gc);
    font-size: 11.5px;
    font-weight: 600;
  }

  .group.unnamed {
    width: 9px;
    height: 9px;
    padding: 0;
    border-radius: 50%;
    background: var(--gc);
  }

  .icon-act {
    /* stays in layout while invisible so the row doesn't resize on hover */
    display: inline-flex;
    visibility: hidden;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    color: var(--text-3);
    flex-shrink: 0;
  }

  .row:hover .icon-act,
  .remove.always {
    visibility: visible;
  }

  .edit:hover {
    color: var(--accent);
    background: var(--surface-2);
  }

  .remove:hover {
    color: var(--danger);
    background: var(--surface-2);
  }

  .row.editing .icon-act {
    visibility: visible;
  }

  .icon-act:hover {
    color: var(--accent);
  }

  .edit-input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--surface);
    outline: none;
    font-size: 13px;
    min-width: 0;
  }
</style>
