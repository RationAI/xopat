xOpat is server-agnostic and assembled from configuration, plugins, and modules,
so the *same* viewer can be set up in very different ways. This section collects
**showcases** — concrete, end-to-end examples that each demonstrate one way of
putting the viewer to use.

Each showcase will walk through a real setup: what it is for, the static
configuration behind it (image server, protocols, secure values, enabled
plugins/modules, IO), and how to reproduce it. Use them as starting points to
adapt to your own environment.

:::note
This section is just getting started — showcases are being added over time. In
the meantime, see the [Quick Start](quick_start.md) to run the viewer locally,
the [Deployment overview](deployment.md) for the ways to host it, and the
[`env/`](https://github.com/RationAI/xopat/tree/master/env) directory for
ready-made configuration examples (DICOM, chat assistants, GitHub IO sink,
authenticated proxies, and more).
:::

## Planned showcases

Examples we intend to document here include:

- **Standalone desktop viewer** — the bundled download from the Quick Start.
- **Image server + viewer** — connecting xOpat to a WSI image server.
- **AI chat assistant** — a deployment with a chat plugin and a secured proxy.
- **Annotations with a persistence backend** — routing IO to a remote sink.
- **Notebook-driven** — opening the viewer from Jupyter / collaborative notebooks.

Have a setup worth showcasing? [Open an issue](https://github.com/RationAI/xopat/issues)
or contribute one.
