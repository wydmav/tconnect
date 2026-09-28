import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-grotesk' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" className={`${grotesk.variable} ${mono.variable}`}>
    <body className="font-sans antialiased">{children}</body></html>);
}