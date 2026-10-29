# Extracted from langflow/voice-to-transaction.json, node CustomComponent-StructOut1 — keep in sync with the flow JSON.

import json
import re
from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output
from lfx.schema.message import Message


class CustomComponent(Component):
    display_name = "Structured Output Parser"
    description = "Validasi & rapikan JSON hasil watsonx.ai supaya sesuai schema VoiceExtractionResult."
    icon = "code"
    name = "CustomComponent"

    inputs = [
        MessageTextInput(
            name="model_response",
            display_name="Model Response",
            info="Teks JSON mentah dari IBM watsonx.ai.",
        ),
    ]

    outputs = [
        Output(display_name="Structured JSON", name="structured_output", method="parse"),
    ]

    def parse(self) -> Message:
        raw = (self.model_response or "").strip()

        candidate = raw
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            candidate = match.group(0)

        try:
            data = json.loads(candidate)
            if not isinstance(data, dict):
                raise ValueError("Model tidak mengembalikan JSON object.")
        except (json.JSONDecodeError, ValueError) as exc:
            self.status = f"Gagal parse JSON: {exc}\nRaw: {raw[:300]}"
            fallback = {
                "amount": None,
                "itemLabel": None,
                "confidence": 0.0,
                "isClosingReport": False,
            }
            return Message(text=json.dumps(fallback, ensure_ascii=False))

        def to_number_or_none(value):
            if value is None:
                return None
            try:
                return float(value)
            except (TypeError, ValueError):
                return None

        def to_bool(value):
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.strip().lower() in ("true", "1", "yes", "ya")
            return bool(value)

        amount = to_number_or_none(data.get("amount"))
        item_label = data.get("itemLabel")
        if item_label is not None and not isinstance(item_label, str):
            item_label = str(item_label)

        confidence_raw = to_number_or_none(data.get("confidence"))
        confidence = 0.5 if confidence_raw is None else max(0.0, min(1.0, confidence_raw))

        is_closing_report = to_bool(data.get("isClosingReport", False))

        clean = {
            "amount": amount,
            "itemLabel": item_label,
            "confidence": confidence,
            "isClosingReport": is_closing_report,
        }

        self.status = json.dumps(clean, ensure_ascii=False)
        return Message(text=json.dumps(clean, ensure_ascii=False))
