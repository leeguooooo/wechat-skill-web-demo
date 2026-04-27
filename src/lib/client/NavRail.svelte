<script lang="ts">
  import { store } from './store';
  import { avatarColor, initials } from './format';
  import {
    MessageSquare,
    Users,
    Bookmark,
    Heart,
    Eye,
    Clapperboard,
    Tv,
    Boxes,
    Phone,
    Settings,
  } from './icons';

  let tick = $state(0);
  $effect(() => store.subscribe(() => { tick++; }));

  const loginState = $derived.by(() => { void tick; return store.loginState; });
  const connection = $derived.by(() => { void tick; return store.connection; });

  const userName = $derived.by(() => {
    void tick;
    if (loginState.status === 'logged-in') return loginState.userName;
    return '';
  });

  // Rail decoration items — match macOS WeChat ordering.
  // chat / contacts / favorites / moments / 看一看 / 视频号 / 直播 / 小程序 / 手机
  const items = [
    { key: 'chat', icon: MessageSquare, active: true },
    { key: 'contacts', icon: Users, active: false },
    { key: 'favorites', icon: Bookmark, active: false },
    { key: 'moments', icon: Heart, active: false },
    { key: 'topstories', icon: Eye, active: false },
    { key: 'channels', icon: Clapperboard, active: false },
    { key: 'live', icon: Tv, active: false },
    { key: 'miniprogram', icon: Boxes, active: false },
    { key: 'phone', icon: Phone, active: false },
  ];

  const statusColor = $derived.by(() => {
    void tick;
    if (loginState.status === 'logged-in' && connection.status === 'open')
      return 'bg-wechat-green';
    if (loginState.status === 'error') return 'bg-red-500';
    return 'bg-yellow-400';
  });

  const statusTitle = $derived.by(() => {
    void tick;
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
</script>

<nav
  class="flex h-full w-14 shrink-0 flex-col items-center bg-wechat-rail py-3 text-wechat-rail-icon"
>
  <!-- User avatar -->
  <div class="relative mb-5">
    <span
      class="flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium text-white"
      style="background-color: {avatarColor(userName || '?')}"
      title={statusTitle}
    >
      {initials(userName || '?')}
    </span>
    <span
      class="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full {statusColor} ring-2 ring-wechat-rail"
    ></span>
  </div>

  <!-- Decoration icons. WeChat uses a thin vertical accent on the left of
       the active row, plus a brighter icon color. -->
  <ul class="flex w-full flex-col items-center gap-1">
    {#each items as item (item.key)}
      <li class="relative flex w-full items-center justify-center">
        {#if item.active}
          <span
            class="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-sm bg-wechat-green"
          ></span>
        {/if}
        <span
          class="flex h-9 w-9 items-center justify-center rounded-md transition-colors {item.active ? 'text-wechat-rail-icon-active' : 'text-wechat-rail-icon hover:bg-wechat-rail-hover hover:text-white'}"
        >
          <item.icon size={20} strokeWidth={1.6} />
        </span>
      </li>
    {/each}
  </ul>

  <!-- Settings pinned to bottom -->
  <div class="mt-auto pt-4">
    <span
      class="flex h-9 w-9 items-center justify-center rounded-md text-wechat-rail-icon hover:bg-wechat-rail-hover hover:text-white"
    >
      <Settings size={20} strokeWidth={1.6} />
    </span>
  </div>
</nav>
