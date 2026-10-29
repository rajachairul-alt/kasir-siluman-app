# Extracted from langflow/radar-tetangga.json, node CustomComponent-RadarAgg1 — keep in sync with the flow JSON.

import json
import requests
from lfx.custom.custom_component.component import Component
from lfx.io import MessageTextInput, SecretStrInput, Output
from lfx.schema.message import Message


class CustomComponent(Component):
    display_name = "Radar Tetangga Aggregator"
    description = (
        "Menghitung rata-rata harga barang lintas pedagang secara deterministik "
        "(bukan LLM) dari data /api/internal/item-prices, dan menyembunyikan "
        "hasil kalau sampel < 2 pedagang."
    )
    icon = "code"
    name = "CustomComponent"

    inputs = [
        MessageTextInput(
            name="item_label",
            display_name="Item Label",
            info="Nama barang yang dicari, mis. 'bakso'.",
        ),
        MessageTextInput(
            name="app_base_url",
            display_name="App Base URL",
            info="Base URL Next.js app, mis. http://localhost:3000.",
            value="http://localhost:3000",
        ),
        SecretStrInput(
            name="internal_secret",
            display_name="Internal Secret",
            info="Dicocokkan dengan RADAR_INTERNAL_SECRET di app Next.js.",
        ),
    ]

    outputs = [
        Output(display_name="Neighborhood Pricing", name="pricing", method="aggregate"),
    ]

    def aggregate(self) -> Message:
        item_label = (self.item_label or "").strip()
        if not item_label:
            result = {"itemLabel": item_label, "averagePrice": None, "sampleSize": 0}
            self.status = json.dumps(result, ensure_ascii=False)
            return Message(text=json.dumps(result, ensure_ascii=False))

        base_url = (self.app_base_url or "http://localhost:3000").rstrip("/")
        url = f"{base_url}/api/internal/item-prices"
        headers = {"x-radar-internal-secret": self.internal_secret}
        params = {"itemLabel": item_label}

        response = requests.get(url, headers=headers, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()
        amounts = data.get("amounts", [])

        # Deterministic arithmetic â never let an LLM compute this average.
        # A wrong average is worse than no average, since this feature's
        # entire value proposition is trust (see Langflow-Pipeline-Specs.md).
        sample_size = len(amounts)
        if sample_size < 2:
            # Suppress: fewer than 2 contributing merchants would make the
            # "average" identifiable as a single merchant's price.
            result = {"itemLabel": item_label, "averagePrice": None, "sampleSize": sample_size}
        else:
            average_price = round(sum(amounts) / sample_size)
            result = {"itemLabel": item_label, "averagePrice": average_price, "sampleSize": sample_size}

        self.status = json.dumps(result, ensure_ascii=False)
        return Message(text=json.dumps(result, ensure_ascii=False))
