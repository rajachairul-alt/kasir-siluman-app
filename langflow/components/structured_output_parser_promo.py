# Extracted from langflow/generative-promo.json, node CustomComponent-StructOut1 — keep in sync with the flow JSON.

import json
import re
from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, Output
from lfx.schema.message import Message


class CustomComponent(Component):
    display_name = "Structured Output Parser"
    description = "Validasi & rapikan JSON hasil watsonx.ai supaya sesuai schema PromoResult."
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
                "posterText": "Yuk mampir ke lapak kami - banyak pilihan makanan lezat menanti!",
                "imagePrompt": "Street food cart with delicious Indonesian food, warm lighting, appetizing food photography",
            }
            return Message(text=json.dumps(fallback, ensure_ascii=False))

        def to_str_or_fallback(value, fallback_text):
            if value is None:
                return fallback_text
            s = str(value).strip()
            return s if s else fallback_text

        poster_text = to_str_or_fallback(
            data.get("posterText"),
            "Yuk mampir ke lapak kami - banyak pilihan makanan lezat menanti!"
        )
        image_prompt = to_str_or_fallback(
            data.get("imagePrompt"),
            "Street food cart with delicious Indonesian food, warm lighting, appetizing food photography"
        )

        clean = {
            "posterText": poster_text,
            "imagePrompt": image_prompt,
        }

        self.status = json.dumps(clean, ensure_ascii=False)
        return Message(text=json.dumps(clean, ensure_ascii=False))
