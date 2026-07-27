// BYOK ("bring your own key") AI-chat demo session for the docs
// (docs/byok-chat-demo.mdx). Rendered by <DemoFrame config={byokChatConfig} />.
//
// WHAT MAKES IT BYOK — server side, not here. A chat provider is BYOK when the
// deployment registers it with an EMPTY `apiKey` (server-secure config); the
// viewer then asks each user to supply their own key from the fullscreen
// Plugins ▸ chat provider-keys panel, and stores it locally (never shipped in
// the session). This session only *enables the client plugin and opens the
// chat*; it assumes the demo deployment already exposes a BYOK-configured
// provider (empty apiKey, `requiresLogin: false`). Until the remote viewer is
// updated with that provider, the chat tab loads but lists no model to pick.
//
// Data: the same H&E slide the other demos use, so the assistant has a real
// slide to talk about. Keep every dataID inside the demo's available set.

const SLIDE = 'Projects/demo/summer-school-coolab/slide.tiff';

// The client plugin that speaks the OpenAI wire format — the natural BYOK
// provider (the user brings the key; the deployment fixes the base URL). Swap
// for `chat-openai` or `chat-anthropic` if the demo registers those instead.
const CHAT_PLUGIN_ID = 'chat-openai-compatible';

export const byokChatConfig = {
  params: {
    // Full UI on purpose: the BYOK key panel lives in the Plugins fullscreen
    // menu, so the app bar and Plugins tab must stay visible (do NOT set
    // disablePluginsUi / ui.globalMenu:false here the way the shader demos do).
    bypassCache: true,
    notificationsPosition: 'top',
  },
  data: [SLIDE],
  background: [{dataReference: 0, goalIndex: 0}],
  plugins: {
    // Enable the chat plugin for this session. Its provider(s) still come from
    // the server; an empty-apiKey provider is what turns it into BYOK.
    [CHAT_PLUGIN_ID]: {},
    'extra-tutorials': {
      data: [
        {
          title: 'BYOK AI chat: add your key and ask',
          attach: true,
          runDelay: 700,
          confirm: {
            title: 'Bring your own key',
            message:
              'This demo runs the AI assistant in <b>BYOK</b> mode — no key ships ' +
              'with it. In under a minute we will show you where to paste your own ' +
              'provider key (it stays in <b>your browser</b>) and how to ask the ' +
              'assistant about the slide.',
            acceptLabel: 'Show me',
            declineLabel: 'Skip',
            illustrationIcon: 'ph-key',
          },
          content: [
            {
              'next #osd-0':
                'This is the slide the assistant can inspect — an H&amp;E ' +
                'whole-slide image. Pan with drag, zoom with the wheel.',
            },
            {
              'click #viewer-container-menu-b-chat':
                'Open the <b>AI chat</b> tab in the right-side dock.',
            },
            {
              'next #viewer-container-menu-c-chat':
                'The assistant panel. Pick a <b>provider</b> and <b>model</b> at the ' +
                'top. Because this is BYOK, a provider that needs a key shows a ' +
                '<b>“key required”</b> notice with an <b>Add key</b> link — click it, ' +
                'or use the Plugins menu in the next step.',
            },
            {
              'click #visual-menu-b-plugins':
                'You can also reach it here: open <b>Plugins</b> and choose ' +
                '<b>Chat provider keys</b>. Paste your key and save — it is stored ' +
                'locally in this browser and sent only to the model provider ' +
                'through the viewer proxy, never saved into the session.',
            },
            {
              'next #viewer-container-menu-c-chat':
                'Once a key is stored the input unlocks. Try ' +
                '<i>“Describe what you see on this slide”</i> or ask it to zoom to a ' +
                'region — the assistant can drive the viewer through the scripting API.',
            },
          ],
        },
      ],
    },
  },
};
