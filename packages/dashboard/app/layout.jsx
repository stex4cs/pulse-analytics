import './globals.css';

export const metadata = {
  title: 'Pulse — analitika tvarenasport.com',
  description: 'First-party analitika za sportski portal: autori, kategorije, tagovi, kanali, A/B testovi.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="sr">
      <body className="min-h-screen bg-[var(--surface-0)] font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
