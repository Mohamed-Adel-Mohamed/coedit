import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'CoEdit — write together, in the same breath',
    template: '%s · CoEdit',
  },
  description:
    'A real-time collaborative markdown workspace. Conflict-free CRDT sync, live cursors, role-based share links, and restorable version history.',
};

export const viewport: Viewport = {
  themeColor: '#f4f0e6',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
