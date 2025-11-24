# GitHub Pages Deployment

This documentation site is configured to deploy automatically to GitHub Pages.

## Setup Instructions

1. **Enable GitHub Pages in Repository Settings:**
   - Go to your repository on GitHub
   - Navigate to **Settings** → **Pages**
   - Under **Source**, select **GitHub Actions**
   - Save the settings

2. **Push to Main Branch:**
   - The workflow will automatically trigger on pushes to `main` that affect the `docs/` directory
   - You can also manually trigger it from the **Actions** tab → **Deploy Docs to GitHub Pages** → **Run workflow**

3. **Access Your Docs:**
   - Once deployed, your docs will be available at:
     `https://jagreehal.github.io/ai-sdk-guardrails/`

## Custom Domain (Optional)

If you want to use a custom domain (e.g., `ai-sdk-guardrails.dev`):

1. Update `site` in `astro.config.mjs` to your custom domain
2. Remove or comment out the `base` property in `astro.config.mjs`
3. Add a `CNAME` file in `docs/public/` with your domain name
4. Configure DNS records as per GitHub Pages documentation

## Local Development

The `base` path is automatically ignored in development mode, so you can run:

```bash
cd docs
pnpm dev
```

The site will be available at `http://localhost:4321` (without the base path).

## Manual Deployment

If you need to deploy manually:

```bash
cd docs
pnpm build
# The dist/ folder contains the built site
```

