/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,ts,js}'],
  theme: {
    extend: {
      colors: {
        wechat: {
          green: '#1AAD19',
          'green-dark': '#149314',
          panel: '#ededed',
          chat: '#f5f5f5',
          bubble: '#ffffff',
          'self-bubble': '#95ec69',
          'text-secondary': '#888888',
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
