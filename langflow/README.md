# Langflow flows (sanitized exports)

The three AI pipelines that the Next.js app calls, exported from Langflow so they can be reviewed and reproduced. Secrets were removed with `scripts/sanitize_langflow_export.py` (see "What was removed").

| File | Flow | Flow ID | Components | `.env` variables |
|---|---|---|---|---|
| `voice-to-transaction.json` | Kasir Siluman - Voice to Transaction | `55e7c1cb-7aea-46b5-b6f4-e702e6b6e824` | Speech-to-Text (Groq Whisper, custom) → Prompt Template → IBM watsonx.ai (`ibm/granite-4-h-small`) → Structured Output Parser (custom) | `LANGFLOW_VOICE_TO_TRANSACTION_FLOW_ID`, `LANGFLOW_VOICE_STT_COMPONENT_ID=CustomComponent-DRIaU` |
| `radar-tetangga.json` | Kasir Siluman - Radar Tetangga | `1b7fa2b9-cc76-4228-a7a3-fa6c05210cbd` | Radar Tetangga Aggregator (custom Python, deterministic, no LLM) | `LANGFLOW_RADAR_TETANGGA_FLOW_ID`, `LANGFLOW_RADAR_AGGREGATOR_COMPONENT_ID=CustomComponent-RadarAgg1` |
| `generative-promo.json` | Kasir Siluman - Generative Promo | `87e1d9df-9484-4ce6-8250-d018063bc09e` | Prompt Template → IBM watsonx.ai (`ibm/granite-4-h-small`) → Structured Output Parser (custom) | `LANGFLOW_PROMO_FLOW_ID`, `LANGFLOW_PROMO_PROMPT_TEMPLATE_COMPONENT_ID=Prompt Template-vrR7b` |

Readable copies for review (extracted from the JSON; the JSON is the source of truth):

- `prompts/voice-to-transaction.prompt.md`, `prompts/generative-promo.prompt.md`
- `components/speech_to_text_groq_whisper.py` — calls Groq's OpenAI-compatible transcription endpoint with `whisper-large-v3-turbo`, `language=id`
- `components/structured_output_parser_voice.py`, `components/structured_output_parser_promo.py`
- `components/radar_tetangga_aggregator.py` — fetches prices from `GET {app_base_url}/api/internal/item-prices` (header `x-radar-internal-secret`), returns the average and sample size, and suppresses the result when the sample is below 2

## What was removed

- `api_key` and `project_id` on both **IBM watsonx.ai** nodes (blanked).
- Account identifiers (`user_id`, `folder_id`, `workspace_id`, and the per-node `_frontend_node_folder_id`).

Kept on purpose: references to Langflow **global variables** (not their values) — `GROQ_API_KEY` on the Speech-to-Text node and `RADAR_INTERNAL_SECRET` on the Radar node — and the public watsonx.ai endpoint URL.

## Import

1. In Langflow, import each JSON file (New Flow → Import / upload).
2. Settings → Global Variables: create `GROQ_API_KEY` and `RADAR_INTERNAL_SECRET` (same value as `RADAR_INTERNAL_SECRET` in the app's `.env`).
3. On both IBM watsonx.ai nodes, fill in your API key and project ID; keep model `ibm/granite-4-h-small`.
4. On the Radar node, set `app_base_url` to a Next.js URL that Langflow can reach.
5. If Langflow gives the imported flows new IDs, update the matching `.env` variables above.

## After changing a flow

Export it again from Langflow, then sanitize before committing:

```bash
python scripts/sanitize_langflow_export.py "<exported file>.json" langflow/<name>.json
```

Then refresh the readable copies in `prompts/` and `components/` if the prompt or component code changed.
