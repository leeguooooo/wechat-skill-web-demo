<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/client/store';
  import NavRail from './lib/client/NavRail.svelte';
  import SessionList from './lib/client/SessionList.svelte';
  import ChatThread from './lib/client/ChatThread.svelte';

  // tick increments on every store.notify(). We use a $state primitive plus
  // store.subscribe() to force component re-render — cleanest way to bridge
  // a non-rune store into Svelte 5 components without restructuring everything.
  let tick = $state(0);

  onMount(() => {
    const unsub = store.subscribe(() => {
      tick++;
    });
    store.connect();
    void store.loadSessions();
    return () => unsub();
  });

  const _ = $derived(tick); // keep `tick` reactive in template
</script>

<div class="flex h-full bg-wechat-chat-bg">
  <NavRail />
  <aside class="w-80 shrink-0 border-r border-wechat-border bg-wechat-panel">
    <SessionList />
  </aside>
  <main class="flex flex-1 flex-col overflow-hidden bg-wechat-chat-bg">
    <ChatThread />
  </main>
</div>
