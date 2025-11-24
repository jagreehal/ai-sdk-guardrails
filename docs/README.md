# AI SDK Guardrails Documentation

This directory contains the documentation site for AI SDK Guardrails, built with [Astro](https://astro.build/) and [Starlight](https://starlight.astro.build/).

## Development

```bash
# Install dependencies (from repository root)
pnpm install

# Start dev server
pnpm --filter=@ai-sdk-guardrails/docs dev

# Or use turbo
pnpm turbo dev --filter=@ai-sdk-guardrails/docs
```

The site will be available at `http://localhost:4321`

## Building

```bash
# Build for production
pnpm turbo build --filter=@ai-sdk-guardrails/docs

# Preview production build
pnpm --filter=@ai-sdk-guardrails/docs preview
```

## Deployment

### GitHub Pages

The documentation is automatically deployed to GitHub Pages when changes are pushed to the `main` branch.

**Setup:**

1. Go to your repository Settings → Pages
2. Set Source to "GitHub Actions"
3. Push changes to `main` branch
4. The workflow will automatically build and deploy

### Manual Deployment

You can also deploy manually to any static hosting provider:

```bash
# Build the site
pnpm turbo build --filter=@ai-sdk-guardrails/docs

# Deploy the docs/dist directory to your hosting provider
```

**Compatible with:**
- GitHub Pages
- Vercel
- Netlify
- Cloudflare Pages
- AWS S3 + CloudFront
- Any static hosting service

## Structure

```
docs/
├── public/              # Static assets (favicon, images)
├── src/
│   ├── assets/          # Images, logos
│   ├── content/
│   │   └── docs/        # Documentation pages (Markdown/MDX)
│   └── styles/          # Custom CSS
├── astro.config.mjs     # Astro & Starlight configuration
└── package.json
```

## Writing Documentation

Documentation pages are written in Markdown or MDX and live in `src/content/docs/`.

### Adding a New Page

1. Create a new `.md` or `.mdx` file in `src/content/docs/`
2. Add frontmatter:

```md
---
title: Page Title
description: Page description for SEO
---

# Content here
```

3. Add to sidebar in `astro.config.mjs`:

```js
sidebar: [
  {
    label: 'Section',
    items: [
      { label: 'Page Title', link: '/path/' },
    ],
  },
],
```

### Using Components

MDX pages support React-like components:

```mdx
import { Card, CardGrid } from '@astrojs/starlight/components';

<CardGrid>
  <Card title="Feature" icon="star">
    Description here
  </Card>
</CardGrid>
```

## Configuration

Key configuration files:

- `astro.config.mjs` - Astro and Starlight settings
- `src/styles/custom.css` - Custom theme styles
- `tsconfig.json` - TypeScript configuration

## Learn More

- [Astro Documentation](https://docs.astro.build/)
- [Starlight Documentation](https://starlight.astro.build/)
- [Markdown Guide](https://www.markdownguide.org/)
