<script lang="ts">
  import { tick as svelteTick } from 'svelte';
  import { store } from './store';
  import { formatHm } from './format';
  import type { MessageRecord, SessionSummary } from '$shared/types';

  let tick = $state(0);
  $effect(() => store.subscribe(() => { tick++; }));

  const activeId = $derived.by(() => { void tick; return store.activeId; });
  const session = $derived.by<SessionSummary | undefined>(() => {
    void tick;
    return store.sessions.find((s) => s.id === store.activeId);
  });
  const messages = $derived.by<MessageRecord[]>(() => {
    void tick;
    if (!store.activeId) return [];
    return store.threads.get(store.activeId) ?? [];
  });

  let input = $state('');
  let scrollEl = $state<HTMLDivElement | null>(null);
  let lastLen = 0;

  $effect(() => {
    void messages.length;
    if (!scrollEl) return;
    if (messages.length !== lastLen) {
      lastLen = messages.length;
      void svelteTick().then(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
  });

  function submit() {
    if (!activeId) return;
    if (!input.trim()) return;
    store.sendText(activeId, input);
    input = '';
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      submit();
    }
  }

  function loadImage(m: MessageRecord) {
    if (m.imageDataUrl) return;
    store.requestImage(m.id);
  }
</script>

{#if !activeId}
  <div class="flex h-full items-center justify-center text-sm text-gray-400">
    select a conversation on the left
  </div>
{:else}
  <div class="flex h-12 shrink-0 items-center border-b border-gray-300 bg-white px-4">
    <span class="text-sm font-medium text-gray-900">{session?.displayName ?? activeId}</span>
    {#if session?.kind === 'room'}
      <span class="ml-2 text-[11px] text-gray-400">[group]</span>
    {/if}
  </div>

  <div bind:this={scrollEl} class="flex-1 overflow-y-auto px-4 py-3">
    {#if messages.length === 0}
      <div class="text-center text-xs text-gray-400">no messages yet</div>
    {:else}
      {#each messages as m (m.id)}
        <div class="my-1 flex {m.self ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[68%]">
            {#if !m.self && session?.kind === 'room'}
              <div class="mb-0.5 px-1 text-[11px] text-gray-500">{m.senderName}</div>
            {/if}
            <div
              class="rounded-md px-3 py-2 text-sm leading-relaxed shadow-sm {m.self ? 'bg-wechat-self-bubble text-gray-900' : 'bg-wechat-bubble text-gray-900'}"
            >
              {#if m.kind === 'text'}
                <span class="whitespace-pre-wrap break-words">{m.text}</span>
              {:else if m.kind === 'image'}
                {#if m.imageDataUrl}
                  <img
                    src={m.imageDataUrl}
                    alt=""
                    class="max-w-[240px] rounded"
                    loading="lazy"
                  />
                {:else}
                  <button
                    type="button"
                    class="text-xs text-blue-600 underline"
                    onclick={() => loadImage(m)}
                  >
                    [图片] tap to load
                  </button>
                {/if}
              {:else}
                <span class="text-xs text-gray-500">{m.text}</span>
              {/if}
            </div>
            <div class="mt-0.5 px-1 text-right text-[10px] text-gray-400">
              {formatHm(m.ts)}
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="shrink-0 border-t border-gray-300 bg-white p-3">
    <div class="flex gap-2">
      <textarea
        bind:value={input}
        onkeydown={onKeyDown}
        rows="2"
        placeholder="type a message — Enter to send, Shift+Enter for newline"
        class="flex-1 resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:border-wechat-green focus:outline-none"
      ></textarea>
      <button
        type="button"
        onclick={submit}
        class="self-end rounded bg-wechat-green px-4 py-2 text-sm font-medium text-white hover:bg-wechat-green-dark disabled:opacity-50"
        disabled={!input.trim()}
      >
        send
      </button>
    </div>
  </div>
{/if}
