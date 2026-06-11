import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/**
 * Embeds the live xOpat demo viewer configured via the DEMO_URL environment
 * variable (siteConfig.customFields.demoUrl). Until the demo deployment
 * exists, renders an informational notice instead.
 *
 * @param {{path?: string, height?: string}} props
 *   path   - appended to the demo base URL (e.g. a session query string)
 *   height - CSS height of the iframe
 */
export default function DemoFrame({path = '', height = '80vh'}) {
  const {siteConfig} = useDocusaurusContext();
  const demoUrl = siteConfig.customFields.demoUrl;

  if (!demoUrl) {
    return (
      <div className="alert alert--info" role="alert">
        The live demo is not available yet. You can run xOpat locally instead
        — see the{' '}
        <Link to="/generated/getting-started/quick-start">Quick Start</Link>{' '}
        guide.
      </div>
    );
  }

  const src = demoUrl.replace(/\/$/, '') + path;
  return (
    <>
      <iframe
        src={src}
        style={{width: '100%', height, border: 0}}
        title="xOpat live demo"
        allow="fullscreen"
      />
      <p>
        <a href={src} target="_blank" rel="noopener noreferrer">
          Open the demo in a new tab ↗
        </a>
      </p>
    </>
  );
}
