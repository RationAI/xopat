import React, {useEffect, useState} from 'react';
import Link from '@docusaurus/Link';
import CodeBlock from '@theme/CodeBlock';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/**
 * Embeds the live xOpat demo viewer configured via the DEMO_URL environment
 * variable (siteConfig.customFields.demoUrl). Until the demo deployment
 * exists, renders an informational notice instead.
 *
 * @param {{path?: string, height?: string, config?: object|null, scale?: number}} props
 *   path   - appended to the demo base URL (e.g. a session query string)
 *   height - CSS height of the visible frame
 *   config - xOpat session config object; serialized onto the URL hash so the
 *            viewer parses it locally (no POST redirect). Takes precedence over
 *            `path` when provided.
 *   scale  - zoom-out factor (0 < scale <= 1). The iframe is rendered at a
 *            `1/scale` larger logical viewport and scaled down with CSS, so the
 *            viewer sees a wider/taller window and stays in desktop layout
 *            (avoids the cramped mobile menus in the narrow docs column).
 *   showSource - when a `config` is given, render an expandable block with the
 *            pretty-printed session JSON so readers can see how it is built.
 */
export default function DemoFrame({
  path = '',
  height = '80vh',
  config = null,
  scale = 1,
  showSource = true,
}) {
  const {siteConfig} = useDocusaurusContext();
  const demoUrl = siteConfig.customFields.demoUrl;

  // TEMPORARY: the viewer's WebGL renderer hits per-device GPU limits (shader
  // uniform array sizes) that vary across phones — so it works on some and not
  // others. We therefore DO load the viewer on mobile, but show a "support is
  // experimental / work in progress" warning above it. Detected after mount
  // (SSR-safe); defaults to desktop (no warning). Remove once mobile is solid.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || '';
    const mobileUA = /Mobi|Android|iPhone|iPod|IEMobile|Windows Phone/i.test(ua);
    // Touch-only device (no hover-capable mouse) — true on phones/tablets,
    // false on desktops even with a touchscreen (the trackpad/mouse hovers).
    const touchOnly =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse) and (hover: none)').matches;
    const narrow = Math.min(window.innerWidth, window.innerHeight) < 820;
    setIsMobile(mobileUA || (touchOnly && narrow));
  }, []);

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

  // Keep exactly one trailing slash on the base so the viewer URL reads
  // `.../xopatv3/#<config>` (the deployment expects the trailing slash).
  const base = demoUrl.replace(/\/+$/, '') + '/';
  const computedPath = config
    ? '#' + encodeURIComponent(JSON.stringify(config))
    : path;
  const src = base + computedPath;

  const heightCss = typeof height === 'number' ? `${height}px` : height;
  const zoom = scale > 0 && scale < 1;
  const frame = zoom ? (
    // Container clips the oversized iframe to the visible box; the iframe is
    // rendered `1/scale` larger then scaled back down from the top-left corner.
    <div style={{width: '100%', height: heightCss, overflow: 'hidden'}}>
      <iframe
        src={src}
        style={{
          width: `${100 / scale}%`,
          height: `calc(${heightCss} / ${scale})`,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
        title="xOpat live demo"
        allow="fullscreen"
      />
    </div>
  ) : (
    <iframe
      src={src}
      style={{width: '100%', height: heightCss, border: 0}}
      title="xOpat live demo"
      allow="fullscreen"
    />
  );

  const sourceDetails = config && showSource && (
    <details>
      <summary>View session configuration</summary>
      <CodeBlock language="json" title="xOpat session config">
        {JSON.stringify(config, null, 2)}
      </CodeBlock>
    </details>
  );

  return (
    <>
      {/* TEMPORARY mobile notice — the viewer loads, but may fail on phones
          whose GPU can't fit the renderer's shader uniforms. */}
      {isMobile && (
        <div className="alert alert--warning" role="alert" style={{marginBottom: '1rem'}}>
          <strong>Mobile support is experimental — we’re working on it.</strong>
          <p style={{margin: '0.5rem 0 0'}}>
            The viewer should load below, but depending on your phone it may not
            run yet (some devices hit GPU limits the renderer doesn’t handle
            yet). If it fails to load, please open this page on a computer.
          </p>
        </div>
      )}
      {frame}
      <p>
        <a href={src} target="_blank" rel="noopener noreferrer">
          Open the demo in a new tab ↗
        </a>
      </p>
      {sourceDetails}
    </>
  );
}
