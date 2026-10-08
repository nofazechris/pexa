import type { MetadataRoute } from 'next';

/** Makes Pexa installable ("Add to Home Screen"): its own icon, no browser bars, opens straight into the app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pexa — your financial agent',
    short_name: 'Pexa',
    description: 'Send, request and manage stablecoin payments by chatting with your agent. Built on Celo.',
    id: '/app',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F6F7F9',
    theme_color: '#F6F7F9',
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
