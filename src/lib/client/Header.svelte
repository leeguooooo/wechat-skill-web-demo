<script lang="ts">
  import { store } from './store';

  let tick = $state(0);
  $effect(() => {
    return store.subscribe(() => {
      tick++;
    });
  });

  const loginState = $derived.by(() => {
    void tick;
    return store.loginState;
  });
  const connection = $derived.by(() => {
    void tick;
    return store.connection;
  });

  const label = $derived.by(() => {
    if (connection.status === 'reconnecting') return 'reconnecting…';
    if (connection.status === 'connecting') return 'connecting…';
    if (loginState.status === 'logged-in')
      return `logged in as ${loginState.userName}`;
    if (loginState.status === 'connecting') return 'waiting for wechat login…';
    if (loginState.status === 'reconnecting') return 'wechaty reconnecting…';
    if (loginState.status === 'logged-out') return 'logged out';
    if (loginState.status === 'error') return `error: ${loginState.message}`;
    return '';
  });

  const dot = $derived.by(() => {
    void tick;
    if (loginState.status === 'logged-in' && connection.status === 'open')
      return 'bg-wechat-green';
    if (loginState.status === 'error') return 'bg-red-500';
    return 'bg-yellow-500 animate-pulse';
  });
</script>

<header
  class="flex h-12 shrink-0 items-center justify-between border-b border-gray-300 bg-white px-4"
>
  <div class="flex items-center gap-2">
    <span class="h-2.5 w-2.5 rounded-full {dot}"></span>
    <span class="text-sm text-gray-700">{label}</span>
  </div>
  <div class="text-xs text-gray-400">wechat-skill web demo</div>
</header>
