# Annotations: Segment Anything (experimental)

Runs Segment Anything mask inference **in-browser** (via `@huggingface/transformers`) as an
annotation tool, and exposes it as a local segmentation driver for the pathology
foundation-model namespace. Requires the **Annotations** plugin.

## Configuration

Deployment config lives under this plugin's `ENV.plugins["sam-segment-tool-experimental"]`
block (merged into `include.json`).

### `models`

Map of model id → HuggingFace repo used for in-client execution:

```json
"models": {
  "slimsam-77-uniform": "Xenova/slimsam-77-uniform",
  "medsam-vit-base": "Xenova/medsam-vit-base"
}
```

### `servers`

By default only in-client execution is supported, so `servers` is an empty array.
To offload inference to a GPU server hosting supported segmentations for transformers,
add entries of the form:

```json
"servers": [
  { "name": "A10", "path": "https://example.com/slimsam-a10" }
]
```

### `transformers`

Pins the inference library. `library` is the CDN URL, `hash` its SHA-256: the bundle is
fetched through `HttpClient`, verified against the hash, and only then imported. A
mismatch aborts the load, and **secure mode refuses remote library loading outright**, so
in-browser inference is unavailable there by design.

```json
"transformers": {
  "library": "//cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1",
  "hash": "aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa",
  "remoteHost": "https://weights.example.org/"
}
```

#### Where the model weights come from — read before deploying

The pin above covers the **library**, not the **weights**. `from_pretrained` resolves each
id in `models` inside transformers.js and downloads the ONNX graph, tokenizer and
preprocessor config with the library's own fetch — not through `HttpClient`, with no hash
and no proxy. By default that is `huggingface.co`, so those artifacts are whatever the
third-party repo serves at the time, and they are not covered by the library pin.

Two mitigations are in place:

- Model ids from config are validated as repo paths (`SAMInference.isValidModelId`). An id
  that is an absolute URL, protocol-relative, or contains `..` is refused, so config alone
  cannot redirect the download elsewhere.
- Optional **`remoteHost`** (https only) repoints transformers.js at a deployment-controlled
  mirror holding vetted weights. Omit it and the library keeps its own default — existing
  deployments are unaffected.

A deployment with a strict supply-chain requirement should set `remoteHost` and serve
reviewed, pinned artifacts from it.

> `include.json` is parsed as **JSONC** — `comment-json` in the Node backend, a comment-aware
> decoder in the PHP one — so `//` comments are legal in the manifest (the shipped `servers`
> block uses them). Substantial configuration examples still belong here in the README.
