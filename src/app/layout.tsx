import type { Metadata } from 'next';
import { Caveat, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { DensityProvider } from '@/components/density-provider';
import { SpellcheckProvider } from '@/components/spellcheck-provider';
import { PwaRegistrar } from '@/components/pwa-registrar';
import { SwUpdateBanner } from '@/components/sw-update-banner';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';
import 'katex/dist/katex.min.css';

export const metadata: Metadata = {
  title: 'Smart Notes',
  description: 'Clarity design-system foundation for Smart Notes.',
  manifest: '/manifest.json'
};

const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-hanken-grotesk'
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono'
});

const accent = Caveat({
  adjustFontFallback: false,
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-caveat'
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${hankenGrotesk.variable} ${mono.variable} ${accent.variable} font-sans`}
    >
      <body>
        <ThemeProvider>
          <DensityProvider>
            <SpellcheckProvider>
              <PwaRegistrar />
              <SwUpdateBanner />
              {children}
              <Toaster position="bottom-right" />
            </SpellcheckProvider>
          </DensityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
