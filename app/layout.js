import './globals.css';

export const metadata = {
  title: 'SRE Troubleshoot Relay',
  description: 'Multiplayer realtime SRE incident-troubleshooting relay game',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
