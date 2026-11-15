"""Multimodal LLM calls with structured (Pydantic) output: aerial measurement + transcript extraction."""

from __future__ import annotations

import base64
import mimetypes
from functools import lru_cache
from pathlib import Path
from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field, field_validator

import config

_NULL_STRINGS = {"", "none", "null", "n/a", "na", "unknown"}


def _null_string_to_none(v):
    """Some models write null as the string "None"/"null"; treat that as a real null."""
    return None if isinstance(v, str) and v.strip().lower() in _NULL_STRINGS else v


class ParkingMeasurement(BaseModel):
    """Surface parking measured from one aerial tile."""

    est_spaces: int | None = Field(description="Estimated number of SURFACE parking stalls visible on the lot. null if not measurable.")
    surface_parking_pct: float | None = Field(description="Share of the parcel/lot covered by surface parking, 0-100. null if not measurable.")
    confidence: float = Field(ge=0, le=1, description="Your confidence in these measurements, 0-1.")
    notes: str = Field(description="One sentence on what you saw and any caveats (occlusion, garage, image quality).")

    _nulls = field_validator("est_spaces", "surface_parking_pct", mode="before")(_null_string_to_none)


class ExtractedAnswer(BaseModel):
    variable: str = Field(description="Target variable name, exactly as given.")
    value: float | None = Field(description="Numeric value; booleans as 1/0. null if the contact did not clearly answer.")
    confidence: float = Field(ge=0, le=1)
    quote: str | None = Field(description="The contact's exact words supporting the value; null if unanswered.")
    t: float | None = Field(description="Timestamp (s) of the quoted contact turn.")

    _nulls = field_validator("value", "quote", "t", mode="before")(_null_string_to_none)


class TranscriptExtraction(BaseModel):
    answers: list[ExtractedAnswer]


@lru_cache(maxsize=None)
def _model(name: str):
    return init_chat_model(name)


def measure_parking_image(image_path: Path) -> ParkingMeasurement:
    mime = mimetypes.guess_type(image_path.name)[0] or "image/png"
    b64 = base64.b64encode(image_path.read_bytes()).decode()
    msg = {
        "role": "user",
        "content": [
            {"type": "text", "text": (
                "You are measuring surface parking from an overhead (orthophoto) tile of one commercial property. "
                "Count surface stalls (striped spaces, occupied or not) and estimate what percent of the lot is surface "
                "parking. Exclude structured garages. If the image is unusable, return nulls with low confidence. "
                "Do not guess beyond what is visible.")},
            {"type": "image", "base64": b64, "mime_type": mime},
        ],
    }
    return _model(config.VISION_MODEL).with_structured_output(ParkingMeasurement).invoke([msg])


def extract_survey_answers(transcript: list[dict], targets: dict[str, str]) -> TranscriptExtraction:
    """targets: {variable_name: description incl. type}."""
    lines = "\n".join(f"[{turn['t']:>5}s] {turn['speaker'].upper()}: {turn['text']}" for turn in transcript)
    spec = "\n".join(f"- {k}: {v}" for k, v in targets.items())
    prompt = (
        "Extract survey answers from this phone transcript. Only use what the CONTACT said. "
        "If the contact did not clearly answer, value must be null. Never infer or estimate.\n\n"
        f"Target variables:\n{spec}\n\nTranscript:\n{lines}"
    )
    return _model(config.EXTRACTION_MODEL).with_structured_output(TranscriptExtraction).invoke(prompt)
