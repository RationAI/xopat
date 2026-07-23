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

> `include.json` is strict JSON (no comments) — it is parsed with `JSON.parse` by the
> module/plugin loader. Keep configuration examples here in the README rather than as
> inline comments in the manifest.
