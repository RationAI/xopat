Run xOpat from [Google Colab](https://colab.research.google.com/). It works
exactly like [local Jupyter](jupyter_deployment.md) — the same `xopat` pip
package, the same `run_server` / `display` loop — with two Colab-specific
differences.

## Quick start

```python
!pip install xopat

import xopat
from xopat import run_server

# No setup_* call needed — run_server detects Colab and configures itself.
server = run_server(data_dir="/content")
xopat.display(server, "slide.tiff")
```

The `slide` argument behaves the same as everywhere else: a string slide path
relative to `data_dir`, or a full session config dict. See
[Jupyter Integration](jupyter_deployment.md#the-ropes) for the full API.

## What's different on Colab

### 1. No `setup_*` call

Unlike JupyterHub, you don't configure a host. Colab assigns each port its own
proxy subdomain, which can't be set in advance but **can** be resolved at runtime,
so `run_server` detects Colab and wires the proxy up automatically. Just call
`run_server` and `display`.

### 2. Third-party cookies must be allowed

The embedded viewer is served through Colab's kernel-port proxy on
`*.googleusercontent.com`, which is a **different domain** from
`colab.research.google.com` where the notebook runs. The proxy's auth check rides
on a cookie that is therefore **third-party**. If the browser blocks third-party
cookies, the proxy rejects the request and the viewer iframe fails to load (blank
frame / 404).

This bites:

- **Safari** — blocks third-party cookies by default (Intelligent Tracking
  Prevention).
- **Any browser with third-party cookies disabled**, and **incognito / private
  windows**, which strip the storage the proxy relies on.

:::tip Workarounds
- Allow third-party cookies for `googleusercontent.com` (or disable the
  cross-site tracking prevention) in the browser running the notebook.
- Use a Chromium-based browser with default settings, in a normal (non-private)
  window.
- Or open the viewer in a real tab with `display_link(server, "")` — a top-level
  tab on the proxy domain isn't a third-party context, so the auth cookie is
  accepted.
:::

## See also

- [Jupyter Integration](jupyter_deployment.md) — the full package API and the
  JupyterHub variant.
- [Viewer Configuration](xopat_configuration.md) — how session dicts are
  assembled.
- [Integration](../../INTEGRATION.md) — embedding xOpat in a larger product.
