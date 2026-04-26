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

  const sessionCount = $derived.by(() => {
    void tick;
    return store.sessions.length;
  });

  const label = $derived.by(() => {
    if (connection.status === 'reconnecting') return 'reconnecting…';
    if (connection.status === 'connecting') return 'connecting…';
    let base: string;
    if (loginState.status === 'logged-in')
      base = `logged in as ${loginState.userName}`;
    else if (loginState.status === 'connecting') base = 'waiting for wechat login…';
    else if (loginState.status === 'reconnecting') base = 'wechaty reconnecting…';
    else if (loginState.status === 'logged-out') base = 'logged out';
    else if (loginState.status === 'error') base = `error: ${loginState.message}`;
    else return '';
    if (sessionCount > 0) {
      return `${base} · ${sessionCount} 个会话`;
    }
    return `${base} · 等待消息中…`;
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
