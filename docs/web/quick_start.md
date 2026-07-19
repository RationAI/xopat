The fastest way to try xOpat is to **download a prebuilt standalone build** and
run it on your own machine. No servers to configure, no command line — it bundles
the viewer, an image server, and sample handling into a single desktop app.

:::tip
This standalone build is meant for trying xOpat and for local/desktop use. It
hardwires a fixed server setup, so it is **not** how you deploy xOpat for real.
When you are ready for that, see the [Deployment](deployment.md) section.
:::

## 1. Download

Go to the **[xOpat releases page](https://github.com/RationAI/xopat-deploy/releases)**
and download the build for your operating system from the latest release's
**Assets**.

:::note
Available platforms are listed under each release's assets. If a build for your
OS is not there yet, use the [Docker bundle](#alternative-run-with-docker) below
or follow a full [deployment](deployment.md).
:::

## 2. Install & launch

- **Windows** — run the downloaded installer. It installs xOpat to your home
  folder and adds **xOpat** shortcuts to the Start Menu and Desktop. Launch from
  either; xOpat lives in the system tray while running.
- **Linux** — unpack the downloaded archive and start it with the included
  `start_all.sh` script.

On first launch, xOpat asks you to **pick a folder containing your slides**. You
can change it later (tray menu → *Change slides folder* on Windows, or the
`change_slides_dir.sh` script on Linux).

## 3. View your slides

xOpat starts a local image server and the viewer, then opens your browser at
**<http://localhost:9001>** automatically. Drop whole-slide images into the
folder you selected and they become available to open.

To open a specific slide directly via the URL, see
[Opening the Viewer](xopat_configuration.md#dynamic-configuration--opening-the-viewer).

That's the whole loop: download → run → point it at a slides folder.

## Unlock the full viewer

The standalone build trades flexibility for convenience. The real strength of
xOpat — connecting to your own image servers and turning on the broader feature
set — comes from a **custom deployment with proper module and plugin
configuration**. A few examples of what that unlocks:

- **AI chat assistants** (e.g. the `chat-anthropic` / `chat-openai-compatible`
  plugins) need a deployment that can hold their API keys and proxy config.
- **Authentication** (OIDC), **custom annotation backends**, and **alternative
  image servers** all require static configuration the standalone build does not
  expose.

When you are ready to go beyond the quick demo:

- **[Deployment overview](deployment.md)** — the ways to host xOpat and when to
  choose each.
- **[Viewer Configuration](xopat_configuration.md)** — the static / dynamic /
  cached configuration levels, plugins, and sessions.
- **[Glossary](glossary.md)** — unfamiliar with a term? Start here.
