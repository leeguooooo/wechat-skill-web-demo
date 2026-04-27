<script lang="ts">
  import { store } from './store';
  import { avatarColor, formatHm, initials } from './format';
  import { Search } from './icons';

  let tick = $state(0);
  $effect(() => store.subscribe(() => { tick++; }));

  const sessions = $derived.by(() => {
    void tick;
    return store.sessions;
  });
  const activeId = $derived.by(() => {
    void tick;
    return store.activeId;
  });

  let query = $state('');

  const filtered = $derived.by(() => {
    void tick;
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.lastPreview.toLowerCase().includes(q),
    );
  });

  function pick(id: string) {
    void store.openSession(id);
  }
</script>

<div class="flex h-full flex-col bg-wechat-panel">
  <!-- Unified rounded search pill (matches macOS WeChat). -->
  <div class="shrink-0 px-3 pt-3 pb-2">
    <div
      class="flex h-7 items-center gap-1.5 rounded-md bg-white/80 px-2 text-wechat-text-meta"
    >
      <Search size={13} strokeWidth={2} />
      <input
        type="text"
        bind:value={query}
        placeholder="搜索"
        class="min-w-0 flex-1 bg-transparent text-xs text-wechat-text-primary placeholder:text-wechat-text-meta focus:outline-none"
      />
    </div>
  </div>

  <!-- Session rows -->
  <div class="flex-1 overflow-y-auto">
    {#if filtered.length === 0}
      <div class="px-4 py-6 text-center text-xs text-wechat-text-meta">
        {#if sessions.length === 0}
          暂无会话 — 等待消息接入
        {:else}
          没有匹配的会话
        {/if}
      </div>
    {:else}
      {#each filtered as s (s.id)}
        <button
          type="button"
          class="session-row flex w-full items-center gap-3 px-3 py-2.5 text-left {activeId === s.id ? 'bg-wechat-panel-active' : 'hover:bg-wechat-panel-hover'}"
          onclick={() => pick(s.id)}
        >
          <span
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-base font-medium text-white"
            style="background-color: {avatarColor(s.displayName)}"
          >
            {initials(s.displayName)}
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline justify-between gap-2">
              <span class="truncate text-sm font-semibold text-wechat-text-primary">
                {s.displayName}
              </span>
              <span class="shrink-0 text-[11px] text-wechat-text-meta">{formatHm(s.lastTs)}</span>
            </span>
            <span class="mt-0.5 flex items-center justify-between gap-2">
              <span class="truncate text-xs text-wechat-text-secondary">
                {s.lastPreview}
              </span>
              {#if s.unread > 0}
                <span class="shrink-0 rounded-full bg-wechat-unread-badge px-1.5 py-px text-[10px] font-medium leading-4 text-white">
                  {s.unread > 99 ? '99+' : s.unread}
                </span>
              {/if}
            </span>
          </span>
        </button>
      {/each}
    {/if}
  </div>
</div>
