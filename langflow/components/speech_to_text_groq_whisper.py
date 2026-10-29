# Extracted from langflow/voice-to-transaction.json, node CustomComponent-DRIaU — keep in sync with the flow JSON.

import time
import random
import requests
from lfx.custom.custom_component.component import Component
from lfx.io import FileInput, SecretStrInput, Output
from lfx.schema.message import Message


class CustomComponent(Component):
    display_name = "Speech-to-Text (Groq Whisper)"
    description = "Transkrip audio Bahasa Indonesia memakai Groq Whisper API."
    documentation: str = "https://console.groq.com/docs/speech-to-text"
    icon = "code"
    name = "CustomComponent"

    inputs = [
        FileInput(
            name="audio_file",
            display_name="Audio File",
            file_types=["wav", "mp3", "m4a", "ogg", "webm", "mpeg"],
            info="Rekaman audio dari MediaRecorder di browser.",
        ),
        SecretStrInput(
            name="groq_api_key",
            display_name="Groq API Key",
            info="Dipakai untuk transkripsi audio lewat Groq Whisper API.",
        ),
    ]

    outputs = [
        Output(display_name="Transcript", name="transcript", method="transcribe"),
    ]

    def transcribe(self) -> Message:
        file_path = self.audio_file
        if not file_path:
            return Message(text="")

        url = "https://api.groq.com/openai/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self.groq_api_key}"}

        ext = str(file_path).rsplit(".", 1)[-1].lower()
        mime_map = {
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "m4a": "audio/mp4",
            "ogg": "audio/ogg",
            "webm": "audio/webm",
            "mpeg": "audio/mpeg",
        }
        mime_type = mime_map.get(ext, "audio/mpeg")

        # Groq free-tier keys are rate-limited (RPM). Retry transient 429/5xx
        # with exponential backoff (+ jitter) instead of failing the whole
        # pipeline on the first hiccup.
        max_attempts = 4
        base_delay_seconds = 3
        last_error = None

        for attempt in range(1, max_attempts + 1):
            with open(file_path, "rb") as audio_handle:
                files = {"file": (str(file_path).rsplit("/", 1)[-1], audio_handle, mime_type)}
                data = {
                    "model": "whisper-large-v3-turbo",
                    "language": "id",
                    "response_format": "json",
                }
                response = requests.post(
                    url, headers=headers, files=files, data=data, timeout=60
                )

            if response.status_code == 200:
                result = response.json()
                transcript_text = result["text"].strip()
                self.status = transcript_text
                return Message(text=transcript_text)

            if response.status_code == 429 or response.status_code >= 500:
                last_error = response
                if attempt == max_attempts:
                    break
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        delay = base_delay_seconds * (2 ** (attempt - 1))
                else:
                    delay = base_delay_seconds * (2 ** (attempt - 1))
                delay += random.uniform(0, 1)
                self.status = (
                    f"Groq API rate-limited (percobaan {attempt}/{max_attempts}), "
                    f"mencoba lagi dalam {delay:.1f} detik..."
                )
                time.sleep(delay)
                continue

            # Non-retryable error (4xx other than 429) â fail immediately.
            response.raise_for_status()

        detail = last_error.text[:300] if last_error is not None else "unknown error"
        raise RuntimeError(
            f"Groq API masih rate-limited setelah {max_attempts} percobaan. "
            f"Coba lagi dalam beberapa saat, atau cek kuota di console.groq.com. Detail: {detail}"
        )
