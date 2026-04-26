<script lang="ts">
  import { store } from './store';
  import { avatarColor, formatHm, initials } from './format';

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

  function pick(id: string) {
    void store.openSession(id);
  }
</script>

<div class="flex h-full flex-col">
  <div
    class="flex h-10 shrink-0 items-center border-b border-gray-300 px-3 text-xs uppercase tracking-wider text-gray-500"
  >
    sessions
  </div>
  <div class="flex-1 overflow-y-auto">
    {#if sessions.length === 0}
      <div class="px-4 py-6 text-center text-xs text-gray-400">
        no conversations yet — incoming messages will appear here
      </div>
    {:else}
      {#each sessions as s (s.id)}
        <button
          type="button"
          class="session-row flex w-full items-center gap-3 px-3 py-2.5 text-left {activeId === s.id ? 'bg-white' : 'hover:bg-gray-200'}"
          onclick={() => pick(s.id)}
        >
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded text-sm font-medium text-white"
            style="background-color: {avatarColor(s.displayName)}"
          >
            {initials(s.displayName)}
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline justify-between gap-2">
              <span class="truncate text-sm font-medium text-gray-900">
                {s.displayName}
                {#if s.kind === 'room'}
                  <span class="ml-1 text-[10px] font-normal text-gray-400">[group]</span>
                {/if}
              </span>
              <span class="shrink-0 text-[11px] text-gray-400">{formatHm(s.lastTs)}</span>
            </span>
            <span class="flex items-center justify-between gap-2">
              <span class="truncate text-xs text-gray-500">{s.lastPreview}</span>
              {#if s.unread > 0}
                <span class="shrink-0 rounded-full bg-red-500 px-1.5 text-[10px] font-medium text-white">
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
