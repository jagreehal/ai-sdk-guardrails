import starlight from '@astrojs/starlight';
import { pluginCollapsibleSections } from '@expressive-code/plugin-collapsible-sections';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import starlightThemeNext from 'starlight-theme-next';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages URL (update if using custom domain)
  site: 'https://jagreehal.github.io',
  // Use base path for GitHub Pages deployment
  // For local development, you can override with: BASE=/ pnpm dev
  base: process.env.BASE || '/ai-sdk-guardrails',
  integrations: [
    starlight({
      title: 'AI SDK Guardrails',
      description: 'Production-ready guardrails for AI SDK applications',
      logo: {
        src: './src/assets/logo.svg',
      },
      favicon: '/favicon.svg',
      social: [
        {
          label: 'GitHub',
          icon: 'github',
          href: 'https://github.com/jagreehal/ai-sdk-guardrails',
        },
        {
          label: 'npm',
          icon: 'external',
          href: 'https://www.npmjs.com/package/ai-sdk-guardrails',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/jagreehal/ai-sdk-guardrails/edit/main/docs/',
      },
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: 'https://jagreehal.github.io/ai-sdk-guardrails/og.png',
          },
        },
      ],
      customCss: ['./src/styles/global.css'],
      plugins: [starlightThemeNext()],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', link: '/introduction/' },
            { label: 'Quick Start', link: '/quick-start/' },
            { label: 'Installation', link: '/installation/' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'How Guardrails Work', link: '/core-concepts/how-it-works/' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Basic Protection', link: '/guides/basic-protection/' },
            { label: 'Streaming', link: '/guides/streaming/' },
            { label: 'Custom Guardrails', link: '/guides/custom-guardrails/' },
            { label: 'Advanced Features', link: '/guides/advanced-features/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Built-in Guardrails', link: '/reference/built-in-guardrails/' },
          ],
        },
      ],
      expressiveCode: {
        plugins: [pluginCollapsibleSections()],
        themes: ['github-dark', 'github-light'],
      },
    }),
    sitemap(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  trailingSlash: 'always',
});
