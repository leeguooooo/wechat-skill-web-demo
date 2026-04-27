<script lang="ts">
  import { tick as svelteTick } from 'svelte';
  import { store } from './store';
  import { avatarColor, formatRelativeDate, initials } from './format';
  import {
    Phone,
    Video,
    MoreHorizontal,
    Smile,
    Paperclip,
    Scissors,
    Mic,
    ArrowUp,
  } from './icons';
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

  // Compute (message, showDivider) pairs. Show a time divider when the gap
  // since the previous message exceeds 5 minutes, or when this is the first
  // message in the thread.
  const TIME_DIVIDER_MS = 5 * 60 * 1000;
  type DisplayItem = { m: MessageRecord; showTime: boolean };
  const items = $derived.by<DisplayItem[]>(() => {
    void tick;
    const out: DisplayItem[] = [];
    let prevTs = 0;
    for (const m of messages) {
      const showTime = !prevTs || m.ts - prevTs > TIME_DIVIDER_MS;
      out.push({ m, showTime });
      prevTs = m.ts;
    }
    return out;
  });

  let input = $state('');
  let scrollEl = $state<HTMLDivElement | null>(null);
  let lastLen = 0;
  let isAtBottom = $state(true);
  let unseenCount = $state(0);

  function checkAtBottom() {
    if (!scrollEl) return true;
    const slack = 64; // px
    return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < slack;
  }

  function onScroll() {
    isAtBottom = checkAtBottom();
    if (isAtBottom) unseenCount = 0;
  }

  function scrollToBottom(force = false) {
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    if (force) {
      isAtBottom = true;
      unseenCount = 0;
    }
  }

  $effect(() => {
    void messages.length;
    if (!scrollEl) return;
    if (messages.length !== lastLen) {
      const grew = messages.length > lastLen;
      const wasAtBottom = isAtBottom;
      lastLen = messages.length;
      if (grew && !wasAtBottom) {
        // count incoming as unseen unless self
        const last = messages[messages.length - 1];
        if (last && !last.self) unseenCount += 1;
      }
      void svelteTick().then(() => {
        if (!scrollEl) return;
        if (wasAtBottom) {
          scrollToBottom(true);
        }
      });
    }
  });

  // Reset state when the conversation switches.
  let lastActive: string | null = null;
  $effect(() => {
    void activeId;
    if (lastActive !== activeId) {
      lastActive = activeId;
      lastLen = 0;
      unseenCount = 0;
      isAtBottom = true;
      void svelteTick().then(() => scrollToBottom(true));
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

  // ---- IntersectionObserver-driven image fetch -----------------------------
  // Track ids we've already requested so we don't spam the server.
  const requestedImageIds = new Set<string>();

  function imageVisibility(node: HTMLElement, messageId: string) {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !requestedImageIds.has(messageId)) {
            requestedImageIds.add(messageId);
            store.requestImage(messageId);
          }
        }
      },
      { root: scrollEl ?? null, threshold: 0.1 },
    );
    obs.observe(node);
    return {
      destroy() {
        obs.disconnect();
      },
    };
  }
</script>

{#if !activeId}
  <div class="flex h-full items-center justify-center bg-wechat-chat-bg text-sm text-wechat-text-meta">
    在左侧选择一个会话开始聊天
  </div>
{:else}
  <!-- Chat header -->
  <div
    class="flex h-14 shrink-0 items-center justify-between border-b border-wechat-border bg-white px-5"
  >
    <div class="min-w-0 flex items-baseline gap-1.5">
      <span class="truncate text-base font-semibold text-wechat-text-primary">
        {session?.displayName ?? activeId}
      </span>
      {#if session?.kind === 'room' && session.memberCount}
        <span class="shrink-0 text-sm text-wechat-text-secondary">({session.memberCount})</span>
      {/if}
    </div>
    <div class="flex items-center gap-3 text-wechat-text-secondary">
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-gray-100"
        title="语音通话"
      >
        <Phone size={18} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-gray-100"
        title="视频通话"
      >
        <Video size={18} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-gray-100"
        title="更多"
      >
        <MoreHorizontal size={18} strokeWidth={1.75} />
      </button>
    </div>
  </div>

  <!-- Messages region (relative for floating pill) -->
  <div class="relative flex-1 overflow-hidden bg-wechat-chat-bg">
    <div
      bind:this={scrollEl}
      onscroll={onScroll}
      class="h-full overflow-y-auto px-6 py-4"
    >
      {#if items.length === 0}
        <div class="text-center text-xs text-wechat-text-meta">暂无消息</div>
      {:else}
        {#each items as { m, showTime } (m.id)}
          {#if showTime}
            <div class="my-3 text-center text-[11px] text-wechat-text-meta">
              {formatRelativeDate(m.ts)}
            </div>
          {/if}
          <div class="my-1.5 flex {m.self ? 'justify-end' : 'justify-start'} gap-2">
            {#if !m.self}
              <span
                class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-medium text-white"
                style="background-color: {avatarColor(m.senderName)}"
              >
                {initials(m.senderName)}
              </span>
            {/if}
            <div class="flex max-w-[60%] min-w-0 flex-col {m.self ? 'items-end' : 'items-start'}">
              {#if !m.self && m.conversationKind === 'room'}
                <div class="mb-1 px-1 text-[11px] text-wechat-text-secondary">
                  {m.senderName}
                </div>
              {/if}
              <div
                class="rounded-md px-3 py-2 text-sm leading-relaxed shadow-sm {m.self ? 'bg-wechat-self-bubble text-wechat-text-primary' : 'bg-wechat-bubble text-wechat-text-primary'}"
              >
                {#if m.kind === 'text'}
                  <span class="whitespace-pre-wrap break-words">{m.text}</span>
                {:else if m.kind === 'image'}
                  {#if m.imageDataUrl}
                    <img
                      src={m.imageDataUrl}
                      alt=""
                      class="block max-w-[240px] rounded"
                      loading="lazy"
                    />
                  {:else}
                    <div
                      use:imageVisibility={m.id}
                      class="flex h-32 w-44 items-center justify-center rounded bg-gray-200/70"
                    >
                      <div class="h-4 w-4 animate-pulse rounded-full bg-gray-300"></div>
                    </div>
                  {/if}
                {:else}
                  <span class="whitespace-pre-wrap break-words text-wechat-text-secondary">{m.text}</span>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    {#if !isAtBottom && unseenCount > 0}
      <button
        type="button"
        onclick={() => scrollToBottom(true)}
        class="absolute right-5 top-3 flex items-center gap-1 rounded-full border border-wechat-green bg-white px-3 py-1 text-xs font-medium text-wechat-green shadow"
      >
        <ArrowUp size={12} strokeWidth={2.25} />
        {unseenCount} 条新消息
      </button>
    {/if}
  </div>

  <!-- Input area -->
  <div class="shrink-0 border-t border-wechat-border bg-white">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-4 py-2 text-wechat-text-secondary">
      <button type="button" class="hover:text-wechat-text-primary" title="表情">
        <Smile size={18} strokeWidth={1.75} />
      </button>
      <button type="button" class="hover:text-wechat-text-primary" title="文件">
        <Paperclip size={18} strokeWidth={1.75} />
      </button>
      <button type="button" class="hover:text-wechat-text-primary" title="截图">
        <Scissors size={18} strokeWidth={1.75} />
      </button>
      <button type="button" class="hover:text-wechat-text-primary" title="语音">
        <Mic size={18} strokeWidth={1.75} />
      </button>
    </div>
    <!-- Textarea -->
    <div class="relative px-4 pb-3">
      <textarea
        bind:value={input}
        onkeydown={onKeyDown}
        rows="3"
        placeholder="type a message — Enter 发送，Shift+Enter 换行"
        class="w-full resize-none border-0 bg-transparent text-sm leading-relaxed text-wechat-text-primary placeholder:text-wechat-text-meta focus:outline-none"
      ></textarea>
      {#if input.trim()}
        <button
          type="button"
          onclick={submit}
          class="absolute bottom-3 right-4 rounded-md bg-wechat-green px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-wechat-green-dark"
        >
          发送
        </button>
      {/if}
    </div>
  </div>
{/if}
