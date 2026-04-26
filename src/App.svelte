<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$lib/client/store';
  import Header from './lib/client/Header.svelte';
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

<div class="flex h-full flex-col">
  <Header />
  <div class="flex flex-1 overflow-hidden">
    <aside class="w-72 shrink-0 border-r border-gray-300 bg-wechat-panel">
      <SessionList />
    </aside>
    <main class="flex flex-1 flex-col bg-wechat-chat">
      <ChatThread />
    </main>
  </div>
</div>
