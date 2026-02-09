import type { ReactNode } from 'react';
import { IBM_Plex_Sans, Literata, Source_Sans_3, Work_Sans } from 'next/font/google';
import './globals.css';
import TopNav from '@/src/components/TopNav';

export const metadata = {
  title: 'Resume Builder',
  description: 'ATS-optimized resume builder',
};

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-ibm-plex-sans',
});

const literata = Literata({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-literata',
});

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-source-sans-3',
});

const workSans = Work_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-work-sans',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${ibmPlexSans.variable} ${literata.variable} ${sourceSans.variable} ${workSans.variable}`}>
      <body className={ibmPlexSans.className}>
        <div className="main-shell">
          <header className="topbar">
            <div className="brand">Resume Builder</div>
            <TopNav />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
