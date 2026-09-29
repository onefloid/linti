export default defineNuxtConfig({
  extends: ['docus'],
  compatibilityDate: '2025-07-18',
  app: {
    baseURL: '/linti/',
  },
  site: {
    name: 'LinTi',
    url: 'https://onefloid.github.io',
  },
  robots: {
    robotsTxt: false,
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
