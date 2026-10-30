// The public URL including the GitHub Pages subpath. Docus builds canonical and
// og:url as site.url + route path, and its sitemap reads only NUXT_SITE_URL.
const siteUrl = 'https://onefloid.github.io/linti'
process.env.NUXT_SITE_URL ||= siteUrl

export default defineNuxtConfig({
  extends: ['docus'],
  compatibilityDate: '2025-07-18',
  app: {
    baseURL: '/linti/',
  },
  site: {
    name: 'LinTi',
    url: siteUrl,
  },
  robots: {
    robotsTxt: false,
  },
  // A static Pages build has no server for the MCP endpoint, so the header
  // menu's MCP entries are removed too (components/docs/DocsPageHeaderLinks.vue).
  mcp: {
    enabled: false,
  },
  nitro: {
    prerender: {
      routes: ['/rules', '/playground', '/config'],
      // Deep links like /rules?rule=F110 render the same page (the query is
      // applied in the browser), so crawling them only adds duplicate OG images.
      ignore: [(route: string) => route.includes('?') && !route.includes('_payload.json')],
    },
  },
})
