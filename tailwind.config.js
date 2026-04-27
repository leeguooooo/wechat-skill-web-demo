/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,ts,js}'],
  theme: {
    extend: {
      colors: {
        wechat: {
          green: '#07C160',
          'green-dark': '#06AE56',
          'self-bubble': '#95EC69',
          bubble: '#FFFFFF',
          panel: '#EDEDED',
          'panel-hover': '#E2E2E2',
          'panel-active': '#D9D9D9',
          'chat-bg': '#F5F5F5',
          // Keep alias for legacy class usage in case anything missed.
          chat: '#F5F5F5',
          rail: '#1F1F1F',
          'rail-hover': '#2A2A2A',
          'rail-icon': '#9A9A9A',
          'rail-icon-active': '#FFFFFF',
          border: '#E5E5E5',
          'text-primary': '#1A1A1A',
          'text-secondary': '#888888',
          'text-meta': '#B0B0B0',
          'unread-badge': '#FA5151',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
