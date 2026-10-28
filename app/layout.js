import './globals.css';
import Link from 'next/link';
import { readJson } from '../lib/store.js';
import { WhoAmI } from './Controls.js';
import { ResetButton } from './Controls.js';

export const metadata = { title: 'Arda Batuhan AYDIN - Assignment' };

export default function RootLayout({ children }) {
  const people = readJson('people.json');
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/">Iggnita Assignment</Link>
          <span className="muted" style={{ color: '#cbd6e6' }}>Today in the data: 26 Oct 2026</span>
          <WhoAmI people={people} /> <ResetButton />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
