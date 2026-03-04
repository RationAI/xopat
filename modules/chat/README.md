# Chat Module – Developer Guide

This document explains how to use the **chat module** in the viewer and how to plug in
your own models via a **generic provider interface**.

You should be able to add a new LLM backend in just a few lines of code.
Look at existing chat providers in plugins for inspiration.

---

## Configuring the behavior




## Folder structure

```text
chat/
  chat.mjs          # ChatModule singleton – entry point
  chatPanel.mjs     # UI component (chat panel)
  chatService.mjs   # Provider registry + routing
  providers/
    openai.mjs      # (optional) shared OpenAI-style provider helper
  include.json      # Module manifest for the chat module
```
Your own chat plugins live elsewhere (e.g. in plugins/chat-...), and they talk to
ChatModule.