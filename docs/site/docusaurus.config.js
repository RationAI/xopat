// @ts-check
// Domain configuration is fully env-driven so no domain string lives in the repo.
// CI supplies these from GitHub repository variables (see docs/site/README.md):
//   DOCS_URL  e.g. https://xopat.example.com   (the docs site itself)
//   BASE_URL  defaults to '/'; set to '/xopat/' when serving from rationai.github.io/xopat
//   DEMO_URL  e.g. https://demo.xopat.example.com (live viewer; empty = demo page shows a notice)
const DOCS_URL = process.env.DOCS_URL || 'https://rationai.github.io';
const BASE_URL = process.env.BASE_URL || '/';
const DEMO_URL = process.env.DEMO_URL || '';

const {themes: prismThemes} = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'xOpat',
  tagline: 'Explainable Open Pathology Analysis Tool',
  favicon: 'img/favicon.png',

  url: DOCS_URL,
  baseUrl: BASE_URL,
  organizationName: 'RationAI',
  projectName: 'xopat',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  customFields: {
    demoUrl: DEMO_URL,
  },

  markdown: {
    // Load-bearing: migrated/generated content is plain `.md` and must parse as
    // CommonMark (raw HTML, `<placeholders>` etc.), not MDX. Hand-written pages use `.mdx`.
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          // Per-document custom_edit_url frontmatter (injected by the sync scripts)
          // points "Edit this page" at the real source files in the repository.
        },
        blog: false,
        pages: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      /** @type {import('@easyops-cn/docusaurus-search-local').PluginOptions} */
      ({
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/xopat-banner.png',
      colorMode: {
        defaultMode: 'light',
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'xOpat',
        logo: {
          alt: 'xOpat logo',
          src: 'img/logo.png',
        },
        items: [
          {type: 'doc', docId: 'index', position: 'left', label: 'Docs'},
          {type: 'doc', docId: 'generated/plugins/catalogue', position: 'left', label: 'Plugins'},
          {type: 'doc', docId: 'generated/modules/catalogue', position: 'left', label: 'Modules'},
          {to: '/live-demo', position: 'left', label: 'Live Demo'},
          // pathname:// escapes the SPA router (and the broken-link checker):
          // the JSDoc API reference is a static site copied into static/api/.
          {href: `pathname://${BASE_URL}api/`, position: 'left', label: 'API', target: '_self'},
          {href: 'https://github.com/RationAI/xopat', position: 'right', label: 'GitHub'},
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              {label: 'Getting Started', to: '/generated/getting-started/overview'},
              {label: 'Changelog', to: '/generated/intro/changelog'},
              {label: 'API Reference', href: `pathname://${BASE_URL}api/`, target: '_self'},
            ],
          },
          {
            title: 'Community',
            items: [
              {label: 'GitHub', href: 'https://github.com/RationAI/xopat'},
              {label: 'Issues', href: 'https://github.com/RationAI/xopat/issues'},
            ],
          },
          {
            title: 'Organizations',
            items: [
              {label: 'RationAI', href: 'https://rationai.fi.muni.cz/'},
              {label: 'BBMRI-ERIC', href: 'https://www.bbmri-eric.eu/'},
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} RationAI. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['json', 'bash', 'php', 'docker', 'yaml'],
      },
    }),
};

module.exports = config;
