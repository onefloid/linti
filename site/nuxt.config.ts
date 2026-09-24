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
      routes: ['/rules', '/playground'],
    },
  },
})
