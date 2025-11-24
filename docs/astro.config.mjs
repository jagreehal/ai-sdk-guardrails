import starlight from '@astrojs/starlight';
import { pluginCollapsibleSections } from '@expressive-code/plugin-collapsible-sections';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages base path (remove this if using custom domain)
  // For local dev, this will be ignored. For GitHub Pages, it's required.
  base: '/ai-sdk-guardrails',
  // GitHub Pages URL (update if using custom domain)
  site: 'https://jagreehal.github.io',
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
      customCss: [
        './src/styles/custom.css',
      ],
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
  trailingSlash: 'always',
});
