# OpenAI Codex generic model instructions

These files are copied byte-for-byte from the official OpenAI Codex source at
commit `740e5af33c71225640e0c1c1555c514c2c93ab74`, tagged
`rust-v0.162.0-alpha.17.2`, matching the CLI used during local verification.

- [prompt.md source](https://github.com/openai/codex/blob/740e5af33c71225640e0c1c1555c514c2c93ab74/codex-rs/models-manager/prompt.md): the generic instructions referenced by `model_info_from_slug` for unknown model IDs.
- [LICENSE source](https://github.com/openai/codex/blob/740e5af33c71225640e0c1c1555c514c2c93ab74/LICENSE): Apache License 2.0.
- [NOTICE source](https://github.com/openai/codex/blob/740e5af33c71225640e0c1c1555c514c2c93ab74/NOTICE): upstream copyright and attribution notices.

Lite uses this prompt for allowed Responses-compatible model IDs absent from the
installed CLI catalog. The instructions do not establish provider capabilities;
Lite supplies conservative metadata separately. Preserve the original file bytes
and accompanying license and notice when updating the pinned source.
