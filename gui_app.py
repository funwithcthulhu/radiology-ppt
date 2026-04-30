from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import traceback
from datetime import datetime
from pathlib import Path
from queue import Empty, Queue
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageOps, ImageTk


APP_TITLE = "Radiopaedia Case PowerPoint Builder"
IS_FROZEN = bool(getattr(sys, "frozen", False))
APP_ROOT = Path(sys.executable).resolve().parent if IS_FROZEN else Path(__file__).resolve().parent
RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", APP_ROOT)).resolve() if IS_FROZEN else APP_ROOT
PROJECT_ROOT = APP_ROOT
CLI_SCRIPT = RESOURCE_ROOT / "src" / "cli.mjs"
GENERATE_SCRIPT = RESOURCE_ROOT / "generate-case-deck.ps1"
OUTPUTS_DIR = APP_ROOT / "outputs"
STATE_PATH = APP_ROOT / "gui_state.json"
LIBRARY_DIR = APP_ROOT / "library"
LIBRARY_PATH = LIBRARY_DIR / "case-library.json"
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

REQUEST_MODE_SPECIFIC = "Specific Diagnosis"
REQUEST_MODE_RANDOM = "Random Case"
REQUEST_MODE_MANUAL = "Manual Case URL"
REQUEST_MODE_OPTIONS = [REQUEST_MODE_SPECIFIC, REQUEST_MODE_RANDOM, REQUEST_MODE_MANUAL]
RANDOM_STYLE_ANY = "Any Case"
RANDOM_STYLE_SUBSPECIALTY = "Subspecialty Browser"
RANDOM_STYLE_MODALITY = "Modality Browser"
RANDOM_STYLE_ANATOMY = "Anatomy Browser"
RANDOM_STYLE_MIXED = "Mixed Deck"
RANDOM_STYLE_OPTIONS = [
    RANDOM_STYLE_ANY,
    RANDOM_STYLE_SUBSPECIALTY,
    RANDOM_STYLE_MODALITY,
    RANDOM_STYLE_ANATOMY,
    RANDOM_STYLE_MIXED,
]
CROP_MODE_DEFAULT = "Default"
CROP_MODE_TIGHTER = "Tighter"
CROP_MODE_WIDER = "Wider"
CROP_MODE_OPTIONS = [CROP_MODE_DEFAULT, CROP_MODE_TIGHTER, CROP_MODE_WIDER]
MARKUP_STYLE_NONE = "None"
MARKUP_STYLE_RING = "Focus Ring"
MARKUP_STYLE_OPTIONS = [MARKUP_STYLE_NONE, MARKUP_STYLE_RING]
THEME_CLASSIC = "Radiopaedia Classic"
THEME_CLEAN = "Clean Light"
THEME_DARK = "Conference Dark"
THEME_WARM = "Teaching Warm"
THEME_OPTIONS = [THEME_CLASSIC, THEME_CLEAN, THEME_DARK, THEME_WARM]
AGE_GROUP_OPTIONS = ["Any", "Adult", "Pediatric", "Neonatal"]
TOPIC_OPTIONS = ["Any", "Tumor", "Trauma", "Infection", "Vascular", "Congenital"]
DIFFICULTY_OPTIONS = ["Any", "Easy", "Medium", "Hard"]

BODY_SYSTEMS = [
    "Chest",
    "Gastrointestinal",
    "Hepatobiliary",
    "Urogenital",
    "Gynaecology",
    "Obstetrics",
]

MODALITY_OPTIONS = [
    "Any",
    "MRI",
    "CT",
    "X-ray",
    "Ultrasound",
    "Fluoroscopy",
    "PET",
    "Mammography",
    "Angiography",
]
MODALITY_HINTS = {
    "Any": "",
    "MRI": "MRI",
    "CT": "CT",
    "X-ray": "X-ray",
    "Ultrasound": "Ultrasound",
    "Fluoroscopy": "Fluoroscopy",
    "PET": "PET",
    "Mammography": "Mammography",
    "Angiography": "Angiography",
}
MODALITY_PATTERNS = [
    ("MRI", [r"\bmri\b", r"\bmr\b", r"\bmagnetic resonance\b"]),
    ("CT", [r"\bct\b", r"\bcomputed tomography\b", r"\bcat scan\b"]),
    ("X-ray", [r"\bx-?ray\b", r"\bradiograph(?:y|ic)?\b", r"\bcxr\b"]),
    ("Ultrasound", [r"\bultrasound\b", r"\bsonograph(?:y|ic)?\b"]),
    ("Fluoroscopy", [r"\bfluoro(?:scopy)?\b"]),
    ("PET", [r"\bpet\b"]),
    ("Mammography", [r"\bmammograph(?:y|ic)?\b", r"\bmammo\b"]),
    ("Angiography", [r"\bangiograph(?:y|ic)?\b", r"\bangio\b"]),
]

ANATOMY_OPTIONS = [
    "Any",
    "Brain",
    "Head & Neck",
    "Spine",
    "Chest",
    "Cardiac",
    "Abdomen",
    "Pelvis",
    "Abdomen/Pelvis",
    "Breast",
    "Shoulder",
    "Elbow",
    "Wrist/Hand",
    "Hip",
    "Knee",
    "Ankle/Foot",
    "Fetal",
]
ANATOMY_HINTS = {
    "Any": "",
    "Brain": "brain",
    "Head & Neck": "head neck",
    "Spine": "spine",
    "Chest": "chest",
    "Cardiac": "cardiac",
    "Abdomen": "abdomen",
    "Pelvis": "pelvis",
    "Abdomen/Pelvis": "abdomen pelvis",
    "Breast": "breast",
    "Shoulder": "shoulder",
    "Elbow": "elbow",
    "Wrist/Hand": "wrist hand",
    "Hip": "hip",
    "Knee": "knee",
    "Ankle/Foot": "ankle foot",
    "Fetal": "fetal",
}
ANATOMY_PATTERNS = [
    ("Head & Neck", [r"\bhead\s*(?:and|&)\s*neck\b", r"\bhead neck\b"]),
    ("Abdomen/Pelvis", [r"\babd(?:omen)?\s*/?\s*pelvis\b", r"\babdomen pelvis\b", r"\babdominopelvic\b"]),
    ("Wrist/Hand", [r"\bwrist\b", r"\bhand\b"]),
    ("Ankle/Foot", [r"\bankle\b", r"\bfoot\b"]),
    ("Brain", [r"\bbrain\b"]),
    ("Spine", [r"\bspine\b", r"\bspinal\b"]),
    ("Chest", [r"\bchest\b", r"\bthorax\b", r"\bthoracic\b", r"\blung\b", r"\bpulmonary\b"]),
    ("Cardiac", [r"\bcardiac\b", r"\bheart\b"]),
    ("Abdomen", [r"\babdomen\b", r"\babdominal\b"]),
    ("Pelvis", [r"\bpelvis\b", r"\bpelvic\b"]),
    ("Breast", [r"\bbreast\b"]),
    ("Shoulder", [r"\bshoulder\b"]),
    ("Elbow", [r"\belbow\b"]),
    ("Hip", [r"\bhip\b"]),
    ("Knee", [r"\bknee\b"]),
    ("Fetal", [r"\bfetal\b", r"\bfoetal\b", r"\bprenatal\b"]),
]

SUBSPECIALTY_OPTIONS = [
    "Any",
    "Neuro",
    "Pediatrics",
    "Pediatric Neuro",
    "MSK",
    "Body",
    "Chest",
    "Cardiac",
    "Head & Neck",
    "Spine",
    "GI",
    "Hepatobiliary",
    "GU",
    "Breast",
    "Vascular",
    "Trauma",
    "Oncology",
    "Obstetrics",
    "Gynecology",
    "Hematology",
    "Interventional",
    "Forensic",
]
SUBSPECIALTY_FILTERS = {
    "Any": {"systems": [], "mode": "all"},
    "Neuro": {"systems": ["Central Nervous System"], "mode": "all"},
    "Pediatrics": {"systems": ["Paediatrics"], "mode": "all"},
    "Pediatric Neuro": {"systems": ["Paediatrics", "Central Nervous System"], "mode": "all"},
    "MSK": {"systems": ["Musculoskeletal"], "mode": "all"},
    "Body": {"systems": BODY_SYSTEMS, "mode": "any"},
    "Chest": {"systems": ["Chest"], "mode": "all"},
    "Cardiac": {"systems": ["Cardiac"], "mode": "all"},
    "Head & Neck": {"systems": ["Head & Neck"], "mode": "all"},
    "Spine": {"systems": ["Spine"], "mode": "all"},
    "GI": {"systems": ["Gastrointestinal"], "mode": "all"},
    "Hepatobiliary": {"systems": ["Hepatobiliary"], "mode": "all"},
    "GU": {"systems": ["Urogenital"], "mode": "all"},
    "Breast": {"systems": ["Breast"], "mode": "all"},
    "Vascular": {"systems": ["Vascular"], "mode": "all"},
    "Trauma": {"systems": ["Trauma"], "mode": "all"},
    "Oncology": {"systems": ["Oncology"], "mode": "all"},
    "Obstetrics": {"systems": ["Obstetrics"], "mode": "all"},
    "Gynecology": {"systems": ["Gynaecology"], "mode": "all"},
    "Hematology": {"systems": ["Haematology"], "mode": "all"},
    "Interventional": {"systems": ["Interventional"], "mode": "all"},
    "Forensic": {"systems": ["Forensic"], "mode": "all"},
}
SUBSPECIALTY_ALIASES = [
    ("Pediatric Neuro", ["pediatric neuro", "paediatric neuro", "peds neuro", "ped neuro"]),
    ("Pediatrics", ["pediatrics", "pediatric", "paediatrics", "paediatric", "peds"]),
    ("MSK", ["msk", "musculoskeletal", "muskuloskeletal", "muskuloskletal", "orthopedic", "orthopaedic"]),
    ("Body", ["body", "body imaging"]),
    ("Neuro", ["neuro", "neuroradiology", "cns"]),
    ("Chest", ["chest", "thoracic", "thorax"]),
    ("Cardiac", ["cardiac", "cardio"]),
    ("Head & Neck", ["head and neck", "head & neck", "head neck", "ent"]),
    ("Spine", ["spine", "spinal"]),
    ("GI", ["gi", "gastrointestinal", "gastro"]),
    ("Hepatobiliary", ["hepatobiliary", "biliary"]),
    ("GU", ["gu", "genitourinary", "urogenital"]),
    ("Breast", ["breast"]),
    ("Vascular", ["vascular"]),
    ("Trauma", ["trauma"]),
    ("Oncology", ["oncology", "oncologic"]),
    ("Obstetrics", ["obstetrics", "obstetric", "ob"]),
    ("Gynecology", ["gynecology", "gynaecology", "gyn"]),
    ("Hematology", ["hematology", "haematology"]),
    ("Interventional", ["interventional", "interventional radiology", "ir"]),
    ("Forensic", ["forensic"]),
]
KNOWN_RANDOM_SUBSPECIALTY_ALIASES = {
    normalized_alias
    for _label, aliases in SUBSPECIALTY_ALIASES
    for normalized_alias in [re.sub(r"\s+", " ", alias).strip().lower() for alias in aliases]
}
SUBSPECIALTY_REVERSE = {
    ("all", tuple(["Central Nervous System"])): "Neuro",
    ("all", tuple(["Paediatrics"])): "Pediatrics",
    ("all", tuple(["Central Nervous System", "Paediatrics"])): "Pediatric Neuro",
    ("all", tuple(["Musculoskeletal"])): "MSK",
    ("any", tuple(sorted(BODY_SYSTEMS))): "Body",
    ("all", tuple(["Chest"])): "Chest",
    ("all", tuple(["Cardiac"])): "Cardiac",
    ("all", tuple(["Head & Neck"])): "Head & Neck",
    ("all", tuple(["Spine"])): "Spine",
    ("all", tuple(["Gastrointestinal"])): "GI",
    ("all", tuple(["Hepatobiliary"])): "Hepatobiliary",
    ("all", tuple(["Urogenital"])): "GU",
    ("all", tuple(["Breast"])): "Breast",
    ("all", tuple(["Vascular"])): "Vascular",
    ("all", tuple(["Trauma"])): "Trauma",
    ("all", tuple(["Oncology"])): "Oncology",
    ("all", tuple(["Obstetrics"])): "Obstetrics",
    ("all", tuple(["Gynaecology"])): "Gynecology",
    ("all", tuple(["Haematology"])): "Hematology",
    ("all", tuple(["Interventional"])): "Interventional",
    ("all", tuple(["Forensic"])): "Forensic",
}


def powershell_path() -> str:
    return shutil.which("powershell.exe") or shutil.which("powershell") or "powershell.exe"


def node_path() -> str:
    packaged = APP_ROOT / "runtime" / "node.exe"
    if packaged.exists():
        return str(packaged)
    bundled = Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node.exe"
    if bundled.exists():
        return str(bundled)
    return shutil.which("node.exe") or shutil.which("node") or "node"


def command_env() -> dict[str, str]:
    env = os.environ.copy()
    env["RADIOLOGY_PPT_APP_ROOT"] = str(APP_ROOT)
    env["RADIOLOGY_PPT_RESOURCE_ROOT"] = str(RESOURCE_ROOT)
    return env


def hidden_subprocess_kwargs() -> dict[str, object]:
    startupinfo = None
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return {
        "creationflags": CREATE_NO_WINDOW,
        "startupinfo": startupinfo,
    }


def collapse_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalized(value: object) -> str:
    return collapse_text(value).lower()


def safe_int(value: object, default: int = 1) -> int:
    try:
        parsed = int(value)
    except Exception:
        return default
    return parsed if parsed > 0 else default


def first_match(text: str, options: list[tuple[str, list[str]]], default: str = "Any") -> str:
    lowered = normalized(text)
    for label, patterns in options:
        for pattern in patterns:
            if re.search(pattern, lowered):
                return label
    return default


def parse_study_hint(study_hint: str) -> tuple[str, str]:
    return (
        first_match(study_hint, MODALITY_PATTERNS),
        first_match(study_hint, ANATOMY_PATTERNS),
    )


def build_study_hint(modality_label: str, anatomy_label: str) -> str:
    parts = [MODALITY_HINTS.get(modality_label, ""), ANATOMY_HINTS.get(anatomy_label, "")]
    return collapse_text(" ".join(part for part in parts if part))


def normalize_manual_case_path(value: str) -> tuple[str, str]:
    text = collapse_text(value)
    if not text:
        return "", ""

    if text.startswith("/cases/"):
        case_path = text if "?lang=us" in text else f"{text}?lang=us"
        return case_path, text

    match = re.search(r"(https?://radiopaedia\.org)?(/cases/[^?\s]+)(?:\?[^ \t]*)?", text, re.IGNORECASE)
    if match:
        case_path = match.group(2)
        if "?lang=us" not in case_path:
            case_path = f"{case_path}?lang=us"
        return case_path, text

    return "", text


def title_from_case_path(case_path: str) -> str:
    slug = collapse_text(case_path).split("/cases/")[-1].split("?")[0]
    slug = re.sub(r"-\d+$", "", slug)
    return collapse_text(slug.replace("-", " "))


def default_library_state() -> dict:
    return {
        "saved": [],
        "favorites": [],
        "blocked": [],
    }


def theme_cli_value(label: str) -> str:
    return {
        THEME_CLASSIC: "classic",
        THEME_CLEAN: "clean-light",
        THEME_DARK: "conference-dark",
        THEME_WARM: "teaching-warm",
    }.get(label, "classic")


def theme_label_from_cli(value: str) -> str:
    reverse = {
        "classic": THEME_CLASSIC,
        "clean-light": THEME_CLEAN,
        "conference-dark": THEME_DARK,
        "teaching-warm": THEME_WARM,
    }
    return reverse.get(collapse_text(value), THEME_CLASSIC)


def crop_cli_value(label: str) -> str:
    return {
        CROP_MODE_DEFAULT: "default",
        CROP_MODE_TIGHTER: "tighter",
        CROP_MODE_WIDER: "wider",
    }.get(label, "default")


def crop_label_from_cli(value: str) -> str:
    reverse = {
        "default": CROP_MODE_DEFAULT,
        "tighter": CROP_MODE_TIGHTER,
        "wider": CROP_MODE_WIDER,
    }
    return reverse.get(collapse_text(value), CROP_MODE_DEFAULT)


def markup_cli_value(label: str) -> str:
    return {
        MARKUP_STYLE_NONE: "none",
        MARKUP_STYLE_RING: "focus-ring",
    }.get(label, "none")


def markup_label_from_cli(value: str) -> str:
    reverse = {
        "none": MARKUP_STYLE_NONE,
        "focus-ring": MARKUP_STYLE_RING,
    }
    return reverse.get(collapse_text(value), MARKUP_STYLE_NONE)


def infer_subspecialty(text: str) -> str:
    lowered = normalized(text)
    for label, aliases in SUBSPECIALTY_ALIASES:
        for alias in aliases:
            if re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", lowered):
                return label
    return "Any"


def detect_random_legacy_request(text: str) -> bool:
    lowered = normalized(text)
    if not lowered:
        return False
    if lowered.isdigit():
        return True
    if "random" in lowered:
        return True
    if lowered.endswith(" diagnosis") or lowered.endswith(" diagnoses") or lowered.endswith(" case") or lowered.endswith(" cases"):
        return True
    stripped = collapse_text(re.sub(r"\b\d{1,2}\b", " ", lowered))
    if stripped in KNOWN_RANDOM_SUBSPECIALTY_ALIASES:
        return True
    modality, anatomy = parse_study_hint(lowered)
    return modality != "Any" and lowered == normalized(build_study_hint(modality, anatomy) or modality)


def row_state_defaults(mode: str = REQUEST_MODE_SPECIFIC) -> dict:
    return {
        "mode": mode,
        "diagnosis": "",
        "count": 1,
        "random_style": RANDOM_STYLE_ANY,
        "subspecialty": "Any",
        "modality": "Any",
        "secondary_modality": "Any",
        "anatomy": "Any",
        "age_group": "Any",
        "topic_focus": "Any",
        "difficulty": "Any",
    }


class MatchReviewDialog(tk.Toplevel):
    SKIP_LABEL = "[Skip this entry]"

    def __init__(self, parent: tk.Tk, entries: list[dict]) -> None:
        super().__init__(parent)
        self.title("Review Possible Matches")
        self.transient(parent)
        self.grab_set()
        self.configure(bg="#eef4f8")
        self.geometry("920x560")
        self.minsize(780, 420)

        self.entries = entries
        self.result: list[dict] | None = None
        self.choice_vars: list[tk.StringVar] = []

        root = ttk.Frame(self, padding=16)
        root.pack(fill="both", expand=True)

        ttk.Label(
            root,
            text="Clarify Matches",
            font=("Segoe UI Semibold", 18),
        ).pack(anchor="w")
        ttk.Label(
            root,
            text="These requests were ambiguous. Pick the case you want for each one before the deck is built.",
            foreground="#4c6477",
        ).pack(anchor="w", pady=(2, 12))

        content = ttk.Frame(root)
        content.pack(fill="both", expand=True)

        canvas = tk.Canvas(content, background="#eef4f8", highlightthickness=0)
        scrollbar = ttk.Scrollbar(content, orient="vertical", command=canvas.yview)
        body = ttk.Frame(canvas)

        body.bind(
            "<Configure>",
            lambda _event: canvas.configure(scrollregion=canvas.bbox("all")),
        )
        canvas_window = canvas.create_window((0, 0), window=body, anchor="nw")
        canvas.bind("<Configure>", lambda event: canvas.itemconfigure(canvas_window, width=event.width))
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        for index, entry in enumerate(entries, start=1):
            frame = ttk.LabelFrame(body, text=f"Request {index}", padding=12)
            frame.pack(fill="x", expand=True, pady=(0, 10))
            frame.columnconfigure(1, weight=1)

            ttk.Label(frame, text="Request:", foreground="#4c6477").grid(row=0, column=0, sticky="nw", padx=(0, 12))
            ttk.Label(frame, text=entry["rawInput"], font=("Segoe UI Semibold", 11)).grid(row=0, column=1, sticky="w")

            parsed_bits = [entry.get("diagnosis", "")]
            if entry.get("studyHint"):
                parsed_bits.append(entry["studyHint"])
            ttk.Label(frame, text="Parsed as:", foreground="#4c6477").grid(row=1, column=0, sticky="nw", padx=(0, 12), pady=(8, 0))
            ttk.Label(frame, text=" | ".join(bit for bit in parsed_bits if bit), foreground="#123046").grid(row=1, column=1, sticky="w", pady=(8, 0))

            values = [self.SKIP_LABEL] + [candidate["title"] for candidate in entry["candidates"]]
            choice_var = tk.StringVar(value=values[1] if len(values) > 1 else values[0])
            combo = ttk.Combobox(frame, values=values, textvariable=choice_var, state="readonly")
            combo.grid(row=2, column=1, sticky="ew", pady=(10, 0))
            ttk.Label(frame, text="Choose case:", foreground="#4c6477").grid(row=2, column=0, sticky="nw", padx=(0, 12), pady=(12, 0))

            preview_lines = []
            for candidate in entry["candidates"][:3]:
                snippet = candidate.get("snippet") or ""
                if snippet:
                    preview_lines.append(f"- {candidate['title']}: {snippet}")
                else:
                    preview_lines.append(f"- {candidate['title']}")

            ttk.Label(
                frame,
                text="\n".join(preview_lines),
                foreground="#4c6477",
                wraplength=620,
                justify="left",
            ).grid(row=3, column=1, sticky="w", pady=(8, 0))

            self.choice_vars.append(choice_var)

        buttons = ttk.Frame(root)
        buttons.pack(fill="x", pady=(12, 0))
        ttk.Button(buttons, text="Cancel", command=self._cancel).pack(side="right")
        ttk.Button(buttons, text="Continue", command=self._accept).pack(side="right", padx=(0, 8))

        self.bind("<Escape>", lambda _event: self._cancel())
        self.bind("<Return>", lambda _event: self._accept())

    def _cancel(self) -> None:
        self.result = None
        self.destroy()

    def _accept(self) -> None:
        selections: list[dict] = []
        for entry, choice_var in zip(self.entries, self.choice_vars):
            selected_title = choice_var.get()
            if selected_title == self.SKIP_LABEL:
                continue

            selected_candidate = next(
                (candidate for candidate in entry["candidates"] if candidate["title"] == selected_title),
                None,
            )
            if not selected_candidate:
                continue

            selections.append(
                {
                    "rawInput": entry["rawInput"],
                    "diagnosis": entry.get("diagnosis", ""),
                    "studyHint": entry.get("studyHint", ""),
                    "selectedCasePath": selected_candidate["casePath"],
                    "selectedCaseTitle": selected_candidate["title"],
                    "originalInput": entry.get("originalInput"),
                    "randomSystems": entry.get("randomSystems", []),
                    "randomQuery": entry.get("randomQuery", ""),
                    "requestId": entry.get("requestId"),
                    "sourceRequest": entry.get("sourceRequest"),
                }
            )

        self.result = selections
        self.destroy()


class CaseReviewDialog(tk.Toplevel):
    def __init__(
        self,
        parent: tk.Tk,
        items: list[dict],
        reroll_callback,
        repick_callback,
        favorite_callback,
        block_callback,
        save_callback,
    ) -> None:
        super().__init__(parent)
        self.title("Review Prepared Cases")
        self.transient(parent)
        self.grab_set()
        self.configure(bg="#eef4f8")
        self.geometry("1320x900")
        self.minsize(1140, 780)

        self.items = list(items)
        self.reroll_callback = reroll_callback
        self.repick_callback = repick_callback
        self.favorite_callback = favorite_callback
        self.block_callback = block_callback
        self.save_callback = save_callback
        self.result: list[dict] | None = None
        self.index = 0
        self.kept_items: list[dict] = []
        self.image_refs: list[ImageTk.PhotoImage] = []

        self.image_count_var = tk.IntVar(value=3)
        self.crop_mode_var = tk.StringVar(value=CROP_MODE_DEFAULT)
        self.markup_style_var = tk.StringVar(value=MARKUP_STYLE_NONE)

        root = ttk.Frame(self, padding=18)
        root.pack(fill="both", expand=True)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(1, weight=1)

        header = ttk.Frame(root)
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(1, weight=1)

        self.step_var = tk.StringVar()
        ttk.Label(header, textvariable=self.step_var, font=("Segoe UI Semibold", 18)).grid(row=0, column=0, sticky="w")
        ttk.Label(
            header,
            text="Review each case, then keep it, reroll it, repick images, favorite it, or skip it before export.",
            foreground="#4c6477",
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(4, 0))

        content = ttk.Frame(root)
        content.grid(row=1, column=0, sticky="nsew", pady=(12, 0))
        content.columnconfigure(0, weight=1)
        content.rowconfigure(3, weight=1)

        summary = ttk.LabelFrame(content, text="Current Case", padding=14)
        summary.grid(row=0, column=0, sticky="ew")
        summary.columnconfigure(1, weight=1)

        ttk.Label(summary, text="Selected case", foreground="#4c6477").grid(row=0, column=0, sticky="nw", padx=(0, 12))
        self.case_title_var = tk.StringVar()
        ttk.Label(summary, textvariable=self.case_title_var, font=("Segoe UI Semibold", 16), wraplength=980).grid(row=0, column=1, sticky="w")

        ttk.Label(summary, text="Prompt line", foreground="#4c6477").grid(row=1, column=0, sticky="nw", padx=(0, 12), pady=(8, 0))
        self.case_intro_var = tk.StringVar()
        ttk.Label(summary, textvariable=self.case_intro_var, wraplength=980, foreground="#123046").grid(row=1, column=1, sticky="w", pady=(8, 0))

        ttk.Label(summary, text="Quality", foreground="#4c6477").grid(row=2, column=0, sticky="nw", padx=(0, 12), pady=(8, 0))
        self.quality_var = tk.StringVar()
        ttk.Label(summary, textvariable=self.quality_var, wraplength=980, foreground="#123046").grid(row=2, column=1, sticky="w", pady=(8, 0))

        ttk.Label(summary, text="Source", foreground="#4c6477").grid(row=3, column=0, sticky="nw", padx=(0, 12), pady=(8, 0))
        self.source_var = tk.StringVar()
        ttk.Label(summary, textvariable=self.source_var, wraplength=980, foreground="#123046").grid(row=3, column=1, sticky="w", pady=(8, 0))

        ttk.Label(summary, text="Ollama", foreground="#4c6477").grid(row=4, column=0, sticky="nw", padx=(0, 12), pady=(8, 0))
        self.ollama_var = tk.StringVar()
        ttk.Label(summary, textvariable=self.ollama_var, wraplength=980, foreground="#123046").grid(row=4, column=1, sticky="w", pady=(8, 0))

        controls = ttk.LabelFrame(content, text="Review Controls", padding=14)
        controls.grid(row=1, column=0, sticky="ew", pady=(12, 0))
        for column in range(6):
            controls.columnconfigure(column, weight=1 if column in {1, 3, 5} else 0)

        ttk.Label(controls, text="Images", foreground="#4c6477").grid(row=0, column=0, sticky="w")
        self.image_count_spin = ttk.Spinbox(controls, from_=1, to=4, textvariable=self.image_count_var, width=6)
        self.image_count_spin.grid(row=0, column=1, sticky="w", padx=(0, 14))

        ttk.Label(controls, text="Crop", foreground="#4c6477").grid(row=0, column=2, sticky="w")
        self.crop_combo = ttk.Combobox(
            controls,
            values=CROP_MODE_OPTIONS,
            textvariable=self.crop_mode_var,
            state="readonly",
            width=14,
        )
        self.crop_combo.grid(row=0, column=3, sticky="w", padx=(0, 14))

        ttk.Label(controls, text="Markup", foreground="#4c6477").grid(row=0, column=4, sticky="w")
        self.markup_combo = ttk.Combobox(
            controls,
            values=MARKUP_STYLE_OPTIONS,
            textvariable=self.markup_style_var,
            state="readonly",
            width=16,
        )
        self.markup_combo.grid(row=0, column=5, sticky="w")

        ttk.Label(
            controls,
            text="Use these controls to repick the same case with fewer images, tighter crops, or focus-ring overlays.",
            foreground="#4c6477",
        ).grid(row=1, column=0, columnspan=6, sticky="w", pady=(8, 0))

        image_frame = ttk.LabelFrame(content, text="Images", padding=14)
        image_frame.grid(row=3, column=0, sticky="nsew", pady=(12, 0))
        image_frame.columnconfigure(0, weight=1)
        image_frame.rowconfigure(0, weight=1)

        self.image_grid = ttk.Frame(image_frame)
        self.image_grid.grid(row=0, column=0, sticky="nsew")

        buttons = ttk.Frame(root)
        buttons.grid(row=2, column=0, sticky="ew", pady=(14, 0))

        self.keep_button = ttk.Button(buttons, text="Keep This Case", command=self._keep_current)
        self.keep_button.pack(side="left")
        self.reroll_button = ttk.Button(buttons, text="Re-roll Case", command=self._reroll_current)
        self.reroll_button.pack(side="left", padx=(8, 0))
        self.repick_button = ttk.Button(buttons, text="Re-pick Images", command=self._repick_current)
        self.repick_button.pack(side="left", padx=(8, 0))
        self.favorite_button = ttk.Button(buttons, text="Favorite", command=self._favorite_current)
        self.favorite_button.pack(side="left", padx=(8, 0))
        self.block_button = ttk.Button(buttons, text="Never Use Again", command=self._block_current)
        self.block_button.pack(side="left", padx=(8, 0))
        self.skip_button = ttk.Button(buttons, text="Skip Case", command=self._skip_current)
        self.skip_button.pack(side="left", padx=(8, 0))
        ttk.Button(buttons, text="Cancel Build", command=self._cancel).pack(side="right")

        self.bind("<Escape>", lambda _event: self._cancel())
        self._show_current()

    def _cancel(self) -> None:
        self.result = None
        self.destroy()

    def _current_item(self) -> dict:
        return self.items[self.index]

    def _review_options_for(self, item: dict) -> dict:
        review_options = dict(item.get("reviewOptions") or {})
        request = dict(item.get("request") or {})
        return {
            "requestedImagesPerCase": max(
                1,
                safe_int(
                    review_options.get("requestedImagesPerCase") or request.get("requestedImagesPerCase") or len(item.get("caseData", {}).get("images", [])) or 3,
                    3,
                ),
            ),
            "cropModeLabel": crop_label_from_cli(review_options.get("cropMode") or request.get("cropMode") or "default"),
            "markupStyleLabel": markup_label_from_cli(review_options.get("markupStyle") or request.get("markupStyle") or "none"),
        }

    def _current_review_payload(self) -> dict:
        return {
            "requestedImagesPerCase": max(1, safe_int(self.image_count_var.get(), 3)),
            "cropMode": crop_cli_value(self.crop_mode_var.get()),
            "markupStyle": markup_cli_value(self.markup_style_var.get()),
        }

    def _store_current_review_options(self) -> None:
        self._current_item()["reviewOptions"] = self._current_review_payload()

    def _set_action_state(self, enabled: bool) -> None:
        button_state = "normal" if enabled else "disabled"
        for widget in [
            self.keep_button,
            self.reroll_button,
            self.repick_button,
            self.favorite_button,
            self.block_button,
            self.skip_button,
        ]:
            widget.configure(state=button_state)
        self.image_count_spin.configure(state="normal" if enabled else "disabled")
        self.crop_combo.configure(state="readonly" if enabled else "disabled")
        self.markup_combo.configure(state="readonly" if enabled else "disabled")

    def _advance(self) -> None:
        self.index += 1
        if self.index >= len(self.items):
            self.result = self.kept_items
            self.destroy()
            return
        self._show_current()

    def _keep_current(self) -> None:
        self._store_current_review_options()
        kept_item = self._current_item()
        self.save_callback(kept_item)
        self.kept_items.append(kept_item)
        self._advance()

    def _skip_current(self) -> None:
        self._advance()

    def _reroll_current(self) -> None:
        self._store_current_review_options()
        self._set_action_state(False)
        self.quality_var.set("Fetching another case...")
        self.update_idletasks()
        try:
            refreshed = self.reroll_callback(self._current_item())
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Could not reroll this case.\n\n{exc}")
            refreshed = None
        if refreshed:
            self.items[self.index] = refreshed
        self._set_action_state(True)
        self._show_current()

    def _repick_current(self) -> None:
        self._store_current_review_options()
        self._set_action_state(False)
        self.quality_var.set("Repicking images from the same case...")
        self.update_idletasks()
        try:
            refreshed = self.repick_callback(self._current_item())
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Could not repick images for this case.\n\n{exc}")
            refreshed = None
        if refreshed:
            self.items[self.index] = refreshed
        self._set_action_state(True)
        self._show_current()

    def _favorite_current(self) -> None:
        self.favorite_callback(self._current_item())
        messagebox.showinfo(APP_TITLE, "This case was added to your favorites.")

    def _block_current(self) -> None:
        self._store_current_review_options()
        self._set_action_state(False)
        self.quality_var.set("Blocking this case and finding another one...")
        self.update_idletasks()
        try:
            refreshed = self.block_callback(self._current_item())
        except Exception as exc:
            self._set_action_state(True)
            messagebox.showerror(APP_TITLE, f"Could not block this case.\n\n{exc}")
            return

        if refreshed:
            self.items[self.index] = refreshed
            self._set_action_state(True)
            self._show_current()
            return

        self._set_action_state(True)
        messagebox.showinfo(APP_TITLE, "This case was blocked. There were no replacement cases, so it will be skipped.")
        self._skip_current()

    def _show_current(self) -> None:
        item = self._current_item()
        case_data = item["caseData"]
        self.step_var.set(f"Case Review {self.index + 1} of {len(self.items)}")
        self.case_title_var.set(case_data.get("caseTitle", "Radiopaedia case"))
        self.case_intro_var.set(case_data.get("caseIntro") or "Case slide will use a minimal title with no extra filler.")
        quality = case_data.get("quality", {})
        warnings = quality.get("warnings") or []
        summary = quality.get("summary") or "No quality notes."
        if warnings:
            summary = f"{summary}\nWarnings: {' | '.join(warnings)}"
        self.quality_var.set(summary)
        self.source_var.set(case_data.get("displayUrl") or case_data.get("caseUrl") or "")

        ollama_lines = []
        for image in case_data.get("images", []):
            if image.get("ollamaScore") is not None:
                reason = image.get("ollamaReason") or ""
                ollama_lines.append(f"{image.get('label', 'Image')}: {image['ollamaScore']}/10 {reason}".strip())
        self.ollama_var.set("\n".join(ollama_lines) if ollama_lines else "No Ollama review was available for this case.")

        review_options = self._review_options_for(item)
        self.image_count_var.set(review_options["requestedImagesPerCase"])
        self.crop_mode_var.set(review_options["cropModeLabel"])
        self.markup_style_var.set(review_options["markupStyleLabel"])

        for child in self.image_grid.winfo_children():
            child.destroy()
        self.image_refs = []

        for column, image_data in enumerate(case_data.get("images", [])):
            card = ttk.Frame(self.image_grid)
            card.grid(row=0, column=column, sticky="nsew", padx=(0 if column == 0 else 12, 0))
            self.image_grid.columnconfigure(column, weight=1)

            image_label = ttk.Label(card)
            image_label.pack(fill="both", expand=True)
            preview = self._thumbnail_for(image_data.get("localPath", ""))
            if preview:
                image_label.configure(image=preview)
                self.image_refs.append(preview)
            else:
                image_label.configure(text="Preview unavailable", anchor="center")

            notes = [image_data.get("label", "Image")]
            if image_data.get("ollamaScore") is not None:
                notes.append(f"Ollama: {image_data['ollamaScore']}/10")
            ttk.Label(card, text=" | ".join(notes), wraplength=320, foreground="#123046").pack(anchor="w", pady=(8, 0))

    def _thumbnail_for(self, image_path: str) -> ImageTk.PhotoImage | None:
        if not image_path:
            return None

        path = Path(image_path)
        if not path.exists():
            return None

        try:
            with Image.open(path) as image:
                preview = ImageOps.contain(image.convert("RGB"), (360, 360))
                return ImageTk.PhotoImage(preview)
        except Exception:
            return None


class LibraryPickerDialog(tk.Toplevel):
    def __init__(self, parent: tk.Tk, title_text: str, subtitle: str, entries: list[dict]) -> None:
        super().__init__(parent)
        self.title(title_text)
        self.transient(parent)
        self.grab_set()
        self.configure(bg="#eef4f8")
        self.geometry("760x560")
        self.minsize(640, 440)

        self.entries = entries
        self.result: list[dict] | None = None

        root = ttk.Frame(self, padding=16)
        root.pack(fill="both", expand=True)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(1, weight=1)

        ttk.Label(root, text=title_text, font=("Segoe UI Semibold", 18)).grid(row=0, column=0, sticky="w")
        ttk.Label(root, text=subtitle, foreground="#4c6477").grid(row=1, column=0, sticky="nw", pady=(4, 10))

        body = ttk.Frame(root)
        body.grid(row=2, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(0, weight=1)

        self.listbox = tk.Listbox(body, selectmode="extended", font=("Segoe UI", 10))
        self.listbox.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(body, orient="vertical", command=self.listbox.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.listbox.configure(yscrollcommand=scroll.set)

        for entry in entries:
            study_hint = collapse_text(entry.get("studyHint", ""))
            label = entry.get("caseTitle", "Radiopaedia case")
            if study_hint:
                label = f"{label}  |  {study_hint}"
            self.listbox.insert("end", label)

        buttons = ttk.Frame(root)
        buttons.grid(row=3, column=0, sticky="ew", pady=(12, 0))
        ttk.Button(buttons, text="Cancel", command=self._cancel).pack(side="right")
        ttk.Button(buttons, text="Load All", command=self._accept_all).pack(side="right", padx=(0, 8))
        ttk.Button(buttons, text="Load Selected", command=self._accept_selected).pack(side="right", padx=(0, 8))

        self.bind("<Escape>", lambda _event: self._cancel())
        self.bind("<Return>", lambda _event: self._accept_selected())

    def _cancel(self) -> None:
        self.result = None
        self.destroy()

    def _accept_all(self) -> None:
        self.result = list(self.entries)
        self.destroy()

    def _accept_selected(self) -> None:
        selection = list(self.listbox.curselection())
        if not selection:
            messagebox.showinfo(APP_TITLE, "Select one or more cases to load, or choose Load All.")
            return
        self.result = [self.entries[index] for index in selection]
        self.destroy()


class RequestRow:
    def __init__(self, parent: ttk.Frame, app: "DeckBuilderApp", index: int, initial_state: dict | None = None) -> None:
        self.app = app
        self.busy = False
        state = row_state_defaults()
        if initial_state:
            state.update(initial_state)

        self.mode_var = tk.StringVar(value=state.get("mode", REQUEST_MODE_SPECIFIC))
        self.diagnosis_var = tk.StringVar(value=state.get("diagnosis", ""))
        self.count_var = tk.IntVar(value=max(1, safe_int(state.get("count", 1), 1)))
        self.random_style_var = tk.StringVar(value=state.get("random_style", RANDOM_STYLE_ANY))
        self.subspecialty_var = tk.StringVar(value=state.get("subspecialty", "Any"))
        self.modality_var = tk.StringVar(value=state.get("modality", "Any"))
        self.secondary_modality_var = tk.StringVar(value=state.get("secondary_modality", "Any"))
        self.anatomy_var = tk.StringVar(value=state.get("anatomy", "Any"))
        self.age_group_var = tk.StringVar(value=state.get("age_group", "Any"))
        self.topic_focus_var = tk.StringVar(value=state.get("topic_focus", "Any"))
        self.difficulty_var = tk.StringVar(value=state.get("difficulty", "Any"))
        self.primary_input_label_var = tk.StringVar(value="Diagnosis")
        self.random_summary_var = tk.StringVar()
        self.filters_visible = tk.BooleanVar(value=self._has_expanded_filters(state))
        self.filters_button_var = tk.StringVar()

        self.frame = ttk.LabelFrame(parent, text="", padding=8, style="Section.TLabelframe")
        self.frame.pack(fill="x", expand=True, pady=(0, 8))
        self.frame.columnconfigure(0, weight=1)

        self.content = ttk.Frame(self.frame, style="Card.TFrame")
        self.content.grid(row=0, column=0, sticky="ew")
        self.content.columnconfigure(0, weight=1)

        top = ttk.Frame(self.content, style="Card.TFrame")
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        ttk.Label(top, text="Request Type", style="CardSub.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(top, textvariable=self.primary_input_label_var, style="CardSub.TLabel").grid(row=0, column=1, sticky="w", padx=(12, 0))
        ttk.Label(top, text="Count", style="CardSub.TLabel").grid(row=0, column=2, sticky="w", padx=(12, 0))

        self.mode_combo = ttk.Combobox(
            top,
            values=REQUEST_MODE_OPTIONS,
            textvariable=self.mode_var,
            state="readonly",
            width=18,
        )
        self.mode_combo.grid(row=1, column=0, sticky="ew", padx=(0, 12), pady=(4, 0))
        self.mode_combo.bind("<<ComboboxSelected>>", lambda _event: self._apply_state())

        self.diagnosis_entry = ttk.Entry(top, textvariable=self.diagnosis_var, width=34)
        self.diagnosis_entry.grid(row=1, column=1, sticky="ew", padx=(12, 12), pady=(4, 0))

        self.random_summary_label = ttk.Label(
            top,
            textvariable=self.random_summary_var,
            style="CardHint.TLabel",
            justify="left",
            wraplength=460,
        )
        self.random_summary_label.grid(row=1, column=1, sticky="ew", padx=(12, 12), pady=(4, 0))
        self.random_summary_label.grid_remove()

        self.count_spin = ttk.Spinbox(top, from_=1, to=20, textvariable=self.count_var, width=5)
        self.count_spin.grid(row=1, column=2, sticky="w", padx=(0, 12), pady=(4, 0))
        self.count_label = top.grid_slaves(row=0, column=2)[0]

        self.remove_button = ttk.Button(top, text="Remove", command=lambda: self.app.remove_request_row(self), style="CardGhost.TButton")
        self.remove_button.grid(row=1, column=3, sticky="e", pady=(2, 0))

        self.primary_filters_frame = ttk.Frame(self.content, style="Card.TFrame")
        self.primary_filters_frame.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        self.primary_filters_frame.columnconfigure(1, weight=1)
        self.primary_filters_frame.columnconfigure(3, weight=1)

        ttk.Label(self.primary_filters_frame, text="Primary Modality", style="CardSub.TLabel").grid(row=0, column=0, sticky="w")
        self.modality_combo = ttk.Combobox(
            self.primary_filters_frame,
            values=MODALITY_OPTIONS,
            textvariable=self.modality_var,
            state="readonly",
            width=14,
        )
        self.modality_combo.grid(row=0, column=1, sticky="ew", padx=(8, 16))

        ttk.Label(self.primary_filters_frame, text="Anatomy", style="CardSub.TLabel").grid(row=0, column=2, sticky="w")
        self.anatomy_combo = ttk.Combobox(
            self.primary_filters_frame,
            values=ANATOMY_OPTIONS,
            textvariable=self.anatomy_var,
            state="readonly",
            width=18,
        )
        self.anatomy_combo.grid(row=0, column=3, sticky="ew", padx=(8, 0))

        self.random_frame = ttk.Frame(self.content, style="Card.TFrame")
        self.random_frame.grid(row=2, column=0, sticky="ew", pady=(8, 0))
        self.random_frame.columnconfigure(1, weight=1)
        self.random_frame.columnconfigure(3, weight=1)

        ttk.Label(self.random_frame, text="Random Browser", style="CardSub.TLabel").grid(row=0, column=0, sticky="w")
        self.random_style_combo = ttk.Combobox(
            self.random_frame,
            values=RANDOM_STYLE_OPTIONS,
            textvariable=self.random_style_var,
            state="readonly",
            width=18,
        )
        self.random_style_combo.grid(row=0, column=1, sticky="ew", padx=(8, 16))
        self.random_style_combo.bind("<<ComboboxSelected>>", lambda _event: self._apply_state())

        ttk.Label(self.random_frame, text="Subspecialty", style="CardSub.TLabel").grid(row=0, column=2, sticky="w")
        self.subspecialty_combo = ttk.Combobox(
            self.random_frame,
            values=SUBSPECIALTY_OPTIONS,
            textvariable=self.subspecialty_var,
            state="readonly",
            width=18,
        )
        self.subspecialty_combo.grid(row=0, column=3, sticky="ew", padx=(8, 0))

        footer = ttk.Frame(self.content, style="Card.TFrame")
        footer.grid(row=3, column=0, sticky="ew", pady=(6, 0))

        self.filters_toggle_button = ttk.Button(
            footer,
            textvariable=self.filters_button_var,
            command=self._toggle_filters,
            style="CardGhost.TButton",
        )
        self.filters_toggle_button.grid(row=0, column=0, sticky="w")

        self.help_var = tk.StringVar()

        self.extra_filters_frame = ttk.Frame(self.content, style="Card.TFrame")
        self.extra_filters_frame.grid(row=4, column=0, sticky="ew", pady=(6, 0))
        self.extra_filters_frame.columnconfigure(1, weight=1)
        self.extra_filters_frame.columnconfigure(3, weight=1)
        self.extra_filters_frame.columnconfigure(5, weight=1)
        self.extra_filters_frame.columnconfigure(7, weight=1)

        ttk.Label(self.extra_filters_frame, text="Secondary Modality", style="CardSub.TLabel").grid(row=0, column=0, sticky="w")

        self.secondary_modality_combo = ttk.Combobox(
            self.extra_filters_frame,
            values=MODALITY_OPTIONS,
            textvariable=self.secondary_modality_var,
            state="readonly",
            width=12,
        )
        self.secondary_modality_combo.grid(row=0, column=1, sticky="ew", padx=(8, 16))

        ttk.Label(self.extra_filters_frame, text="Age Group", style="CardSub.TLabel").grid(row=0, column=2, sticky="w")

        self.age_group_combo = ttk.Combobox(
            self.extra_filters_frame,
            values=AGE_GROUP_OPTIONS,
            textvariable=self.age_group_var,
            state="readonly",
            width=12,
        )
        self.age_group_combo.grid(row=0, column=3, sticky="ew", padx=(8, 16))

        ttk.Label(self.extra_filters_frame, text="Topic Focus", style="CardSub.TLabel").grid(row=0, column=4, sticky="w")

        self.topic_focus_combo = ttk.Combobox(
            self.extra_filters_frame,
            values=TOPIC_OPTIONS,
            textvariable=self.topic_focus_var,
            state="readonly",
            width=14,
        )
        self.topic_focus_combo.grid(row=0, column=5, sticky="ew", padx=(8, 16))

        ttk.Label(self.extra_filters_frame, text="Difficulty", style="CardSub.TLabel").grid(row=0, column=6, sticky="w")

        self.difficulty_combo = ttk.Combobox(
            self.extra_filters_frame,
            values=DIFFICULTY_OPTIONS,
            textvariable=self.difficulty_var,
            state="readonly",
            width=10,
        )
        self.difficulty_combo.grid(row=0, column=7, sticky="ew", padx=(8, 0))

        self.update_index(index)
        self._set_filters_visible(self.filters_visible.get())
        self._apply_state()

    def update_index(self, index: int) -> None:
        self.frame.configure(text=f"Case Request {index}")

    def _has_expanded_filters(self, state: dict) -> bool:
        return any(
            state.get(key, default) != default
            for key, default in {
                "secondary_modality": "Any",
                "age_group": "Any",
                "topic_focus": "Any",
                "difficulty": "Any",
            }.items()
        )

    def _set_filters_visible(self, visible: bool) -> None:
        enabled = bool(visible)
        self.filters_visible.set(enabled)
        self.filters_button_var.set("Hide More Filters" if enabled else "Show More Filters")
        if enabled:
            self.extra_filters_frame.grid()
        else:
            self.extra_filters_frame.grid_remove()

    def _toggle_filters(self) -> None:
        self._set_filters_visible(not self.filters_visible.get())

    def set_busy(self, busy: bool) -> None:
        self.busy = busy
        self._apply_state()

    def destroy(self) -> None:
        self.frame.destroy()

    def serialize(self) -> dict:
        return {
            "mode": self.mode_var.get(),
            "diagnosis": collapse_text(self.diagnosis_var.get()),
            "count": max(1, safe_int(self.count_var.get(), 1)),
            "random_style": self.random_style_var.get() if self.random_style_var.get() in RANDOM_STYLE_OPTIONS else RANDOM_STYLE_ANY,
            "subspecialty": self.subspecialty_var.get() if self.subspecialty_var.get() in SUBSPECIALTY_OPTIONS else "Any",
            "modality": self.modality_var.get() if self.modality_var.get() in MODALITY_OPTIONS else "Any",
            "secondary_modality": self.secondary_modality_var.get() if self.secondary_modality_var.get() in MODALITY_OPTIONS else "Any",
            "anatomy": self.anatomy_var.get() if self.anatomy_var.get() in ANATOMY_OPTIONS else "Any",
            "age_group": self.age_group_var.get() if self.age_group_var.get() in AGE_GROUP_OPTIONS else "Any",
            "topic_focus": self.topic_focus_var.get() if self.topic_focus_var.get() in TOPIC_OPTIONS else "Any",
            "difficulty": self.difficulty_var.get() if self.difficulty_var.get() in DIFFICULTY_OPTIONS else "Any",
        }

    def to_request_payload(self, index: int) -> dict:
        state = self.serialize()
        study_hint = build_study_hint(state["modality"], state["anatomy"])
        secondary_modality = MODALITY_HINTS.get(state["secondary_modality"], "")

        if state["mode"] == REQUEST_MODE_MANUAL:
            case_path, raw_input = normalize_manual_case_path(state["diagnosis"])
            if not case_path:
                raise ValueError(f"Request {index}: enter a Radiopaedia case URL or /cases/... path.")

            payload = {
                "requestMode": "manual",
                "rawInput": raw_input or case_path,
                "selectedCasePath": case_path,
                "selectedCaseTitle": title_from_case_path(case_path) or "Radiopaedia case",
                "diagnosis": title_from_case_path(case_path),
            }
            if state["modality"] != "Any":
                payload["modality"] = MODALITY_HINTS[state["modality"]]
            if state["secondary_modality"] != "Any":
                payload["secondaryModality"] = secondary_modality
            if state["anatomy"] != "Any":
                payload["anatomy"] = ANATOMY_HINTS[state["anatomy"]]
            if state["age_group"] != "Any":
                payload["ageGroup"] = state["age_group"]
            if state["topic_focus"] != "Any":
                payload["topicFocus"] = state["topic_focus"]
            if state["difficulty"] != "Any":
                payload["difficulty"] = state["difficulty"]
            return payload

        if state["mode"] == REQUEST_MODE_SPECIFIC:
            diagnosis = collapse_text(state["diagnosis"])
            if not diagnosis:
                raise ValueError(f"Request {index}: enter a diagnosis.")

            payload = {
                "requestMode": "specific",
                "diagnosis": diagnosis,
                "rawInput": collapse_text(", ".join(bit for bit in [diagnosis, study_hint] if bit)),
            }
            if state["modality"] != "Any":
                payload["modality"] = MODALITY_HINTS[state["modality"]]
            if state["secondary_modality"] != "Any":
                payload["secondaryModality"] = secondary_modality
            if state["anatomy"] != "Any":
                payload["anatomy"] = ANATOMY_HINTS[state["anatomy"]]
            if state["age_group"] != "Any":
                payload["ageGroup"] = state["age_group"]
            if state["topic_focus"] != "Any":
                payload["topicFocus"] = state["topic_focus"]
            if state["difficulty"] != "Any":
                payload["difficulty"] = state["difficulty"]
            return payload

        count = max(1, min(20, safe_int(state["count"], 1)))
        random_style = state["random_style"]
        filter_config = SUBSPECIALTY_FILTERS.get(state["subspecialty"], SUBSPECIALTY_FILTERS["Any"])
        parts = ["Random"]
        if count > 1:
            parts.append(str(count))
        if random_style == RANDOM_STYLE_SUBSPECIALTY and state["subspecialty"] != "Any":
            parts.append(state["subspecialty"])
        if study_hint:
            parts.append(study_hint)

        payload = {
            "requestMode": "random",
            "randomCount": count,
            "rawInput": " | ".join(parts),
        }
        if random_style == RANDOM_STYLE_SUBSPECIALTY and filter_config["systems"]:
            payload["randomSystems"] = list(filter_config["systems"])
        if random_style == RANDOM_STYLE_SUBSPECIALTY and filter_config.get("mode") == "any":
            payload["randomSystemMode"] = "any"
        if random_style == RANDOM_STYLE_MIXED:
            payload["randomDiversity"] = "mixed"
        if state["modality"] != "Any":
            payload["modality"] = MODALITY_HINTS[state["modality"]]
        if state["secondary_modality"] != "Any":
            payload["secondaryModality"] = secondary_modality
        if state["anatomy"] != "Any":
            payload["anatomy"] = ANATOMY_HINTS[state["anatomy"]]
        if state["age_group"] != "Any":
            payload["ageGroup"] = state["age_group"]
        if state["topic_focus"] != "Any":
            payload["topicFocus"] = state["topic_focus"]
        if state["difficulty"] != "Any":
            payload["difficulty"] = state["difficulty"]
        return payload

    def _apply_state(self) -> None:
        mode = self.mode_var.get()

        if self.busy:
            self.mode_combo.configure(state="disabled")
            self.diagnosis_entry.configure(state="disabled")
            self.count_spin.configure(state="disabled")
            self.random_style_combo.configure(state="disabled")
            self.subspecialty_combo.configure(state="disabled")
            self.modality_combo.configure(state="disabled")
            self.secondary_modality_combo.configure(state="disabled")
            self.anatomy_combo.configure(state="disabled")
            self.age_group_combo.configure(state="disabled")
            self.topic_focus_combo.configure(state="disabled")
            self.difficulty_combo.configure(state="disabled")
            self.remove_button.configure(state="disabled")
            self.filters_toggle_button.configure(state="disabled")
            return

        self.mode_combo.configure(state="readonly")
        self.modality_combo.configure(state="readonly")
        self.secondary_modality_combo.configure(state="readonly")
        self.anatomy_combo.configure(state="readonly")
        self.age_group_combo.configure(state="readonly")
        self.topic_focus_combo.configure(state="readonly")
        self.difficulty_combo.configure(state="readonly")
        self.remove_button.configure(state="normal")
        self.filters_toggle_button.configure(state="normal")
        self.help_var.set("")

        if mode == REQUEST_MODE_RANDOM:
            self.primary_input_label_var.set("Random Selection")
            self.random_summary_var.set("No typed diagnosis is needed. Choose how many cases you want, then use the filters below to steer the random pull.")
            self.diagnosis_entry.grid_remove()
            self.random_summary_label.grid()
            self.random_frame.grid()
            self.count_label.grid()
            self.count_spin.grid()
            self.count_spin.configure(state="normal")
            self.random_style_combo.configure(state="readonly")
            random_style = self.random_style_var.get()

            if random_style == RANDOM_STYLE_SUBSPECIALTY:
                self.subspecialty_combo.configure(state="readonly")
                self.modality_combo.configure(state="readonly")
                self.secondary_modality_combo.configure(state="readonly")
                self.anatomy_combo.configure(state="readonly")
            elif random_style == RANDOM_STYLE_MODALITY:
                self.subspecialty_combo.configure(state="disabled")
                self.modality_combo.configure(state="readonly")
                self.secondary_modality_combo.configure(state="readonly")
                self.anatomy_combo.configure(state="readonly")
            elif random_style == RANDOM_STYLE_ANATOMY:
                self.subspecialty_combo.configure(state="disabled")
                self.modality_combo.configure(state="readonly")
                self.secondary_modality_combo.configure(state="readonly")
                self.anatomy_combo.configure(state="readonly")
            elif random_style == RANDOM_STYLE_MIXED:
                self.subspecialty_combo.configure(state="disabled")
                self.modality_combo.configure(state="readonly")
                self.secondary_modality_combo.configure(state="readonly")
                self.anatomy_combo.configure(state="readonly")
            else:
                self.subspecialty_combo.configure(state="disabled")
                self.modality_combo.configure(state="readonly")
                self.secondary_modality_combo.configure(state="readonly")
                self.anatomy_combo.configure(state="readonly")
        elif mode == REQUEST_MODE_MANUAL:
            self.primary_input_label_var.set("Radiopaedia Case URL")
            self.random_summary_label.grid_remove()
            self.diagnosis_entry.grid()
            self.diagnosis_entry.configure(state="normal")
            self.count_label.grid_remove()
            self.count_spin.grid_remove()
            self.count_spin.configure(state="disabled")
            self.random_style_combo.configure(state="disabled")
            self.subspecialty_combo.configure(state="disabled")
            self.modality_combo.configure(state="readonly")
            self.secondary_modality_combo.configure(state="readonly")
            self.anatomy_combo.configure(state="readonly")
            self.random_frame.grid_remove()
        else:
            self.primary_input_label_var.set("Diagnosis")
            self.random_summary_label.grid_remove()
            self.diagnosis_entry.grid()
            self.diagnosis_entry.configure(state="normal")
            self.count_label.grid_remove()
            self.count_spin.grid_remove()
            self.count_spin.configure(state="disabled")
            self.random_style_combo.configure(state="disabled")
            self.subspecialty_combo.configure(state="disabled")
            self.modality_combo.configure(state="readonly")
            self.secondary_modality_combo.configure(state="readonly")
            self.anatomy_combo.configure(state="readonly")
            self.random_frame.grid_remove()

        self._set_filters_visible(self.filters_visible.get())


class DeckBuilderApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(APP_TITLE)
        self.configure(bg="#eef4f8")
        self._configure_initial_window()

        self.log_queue: Queue[tuple[str, str | int]] = Queue()
        self.worker: threading.Thread | None = None
        self.current_process: subprocess.Popen[str] | None = None
        self.request_rows: list[RequestRow] = []
        self.form_widgets: list[tuple[tk.Widget, str]] = []

        self.title_var = tk.StringVar()
        self.images_var = tk.IntVar(value=3)
        self.output_var = tk.StringVar()
        self.last_output_path = ""
        self.last_output_var = tk.StringVar(value="No deck generated yet")
        self.status_var = tk.StringVar(value="Ready")
        self.auto_open_var = tk.BooleanVar(value=True)
        self.clinical_history_var = tk.BooleanVar(value=True)
        self.ollama_assist_var = tk.BooleanVar(value=True)
        self.theme_var = tk.StringVar(value=THEME_CLASSIC)
        self.crop_mode_var = tk.StringVar(value=CROP_MODE_DEFAULT)
        self.markup_style_var = tk.StringVar(value=MARKUP_STYLE_NONE)
        self.teaching_points_var = tk.BooleanVar(value=False)
        self.library_state = default_library_state()
        self.deck_advanced_visible = False
        self.log_visible = False
        self.deck_advanced_button_var = tk.StringVar(value="Show Advanced Options")
        self.log_toggle_var = tk.StringVar(value="Open Activity")

        self._configure_style()
        self._build_ui()
        self._load_library_state()
        self._load_state()

        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.bind("<Control-Return>", lambda _event: self.start_generation())
        self.after(125, self._drain_queue)

    def _configure_initial_window(self) -> None:
        screen_w = max(1024, self.winfo_screenwidth())
        screen_h = max(720, self.winfo_screenheight())
        width = min(1360, max(1120, screen_w - 40))
        height = min(900, max(680, screen_h - 80))
        x = max(0, (screen_w - width) // 2)
        y = max(0, (screen_h - height) // 2)
        self.geometry(f"{width}x{height}+{x}+{y}")

        min_width = min(width, max(980, screen_w - 120))
        min_height = min(height, max(620, screen_h - 140))
        self.minsize(min_width, min_height)

        if os.name == "nt" and screen_h <= 760:
            try:
                self.state("zoomed")
            except Exception:
                pass

    def _track_widget(self, widget: tk.Widget, normal_state: str = "normal") -> None:
        self.form_widgets.append((widget, normal_state))

    def _configure_style(self) -> None:
        self.option_add("*Font", "{Segoe UI} 10")
        style = ttk.Style(self)
        if "clam" in style.theme_names():
            style.theme_use("clam")

        app_bg = "#eef4f8"
        card_bg = "#ffffff"
        ink = "#123046"
        muted = "#5a7182"
        border = "#d8e3ec"
        accent = "#0f766e"
        accent_active = "#115e59"
        accent_disabled = "#a7c8c2"
        subtle_active = "#f3f8fb"

        style.configure("App.TFrame", background=app_bg)
        style.configure("Card.TFrame", background=card_bg)
        style.configure("PageTitle.TLabel", background=app_bg, foreground=ink, font=("Segoe UI Semibold", 21))
        style.configure("PageSub.TLabel", background=app_bg, foreground=muted, font=("Segoe UI", 10))
        style.configure("Sub.TLabel", background=card_bg, foreground=muted, font=("Segoe UI", 10))
        style.configure("CardSub.TLabel", background=card_bg, foreground=muted, font=("Segoe UI", 10))
        style.configure("CardHint.TLabel", background=card_bg, foreground=ink, font=("Segoe UI", 10))
        style.configure("Card.TCheckbutton", background=card_bg, foreground=ink, font=("Segoe UI", 10))
        style.map(
            "Card.TCheckbutton",
            background=[("active", card_bg), ("disabled", card_bg)],
            foreground=[("disabled", "#8ca5b7")],
        )
        style.configure(
            "Section.TLabelframe",
            background=card_bg,
            bordercolor=border,
            borderwidth=1,
            relief="solid",
            padding=0,
        )
        style.configure(
            "Section.TLabelframe.Label",
            background=card_bg,
            foreground=ink,
            font=("Segoe UI Semibold", 11),
        )
        style.configure("Status.TLabel", background=app_bg, foreground=ink, font=("Segoe UI Semibold", 10))

        style.configure(
            "Primary.TButton",
            background=accent,
            foreground="#ffffff",
            borderwidth=0,
            focusthickness=0,
            font=("Segoe UI Semibold", 11),
            padding=(16, 12),
        )
        style.map(
            "Primary.TButton",
            background=[("active", accent_active), ("disabled", accent_disabled)],
            foreground=[("disabled", "#f5fbfa")],
        )

        style.configure(
            "Secondary.TButton",
            background=card_bg,
            foreground=ink,
            bordercolor=border,
            borderwidth=1,
            focusthickness=0,
            font=("Segoe UI Semibold", 10),
            padding=(12, 9),
        )
        style.map(
            "Secondary.TButton",
            background=[("active", subtle_active), ("disabled", "#f4f6f8")],
            bordercolor=[("active", "#c5d6e3"), ("disabled", border)],
        )

        style.configure(
            "Ghost.TButton",
            background=app_bg,
            foreground="#0f5d91",
            borderwidth=0,
            focusthickness=0,
            font=("Segoe UI Semibold", 9),
            padding=(6, 4),
        )
        style.map(
            "Ghost.TButton",
            background=[("active", "#e6f0f7"), ("disabled", app_bg)],
            foreground=[("disabled", "#8ca5b7")],
        )

        style.configure(
            "CardGhost.TButton",
            background=card_bg,
            foreground="#0f5d91",
            borderwidth=0,
            focusthickness=0,
            font=("Segoe UI Semibold", 9),
            padding=(6, 4),
        )
        style.map(
            "CardGhost.TButton",
            background=[("active", subtle_active), ("disabled", card_bg)],
            foreground=[("disabled", "#8ca5b7")],
        )

        style.configure(
            "Secondary.TMenubutton",
            background=card_bg,
            foreground=ink,
            bordercolor=border,
            borderwidth=1,
            focusthickness=0,
            font=("Segoe UI Semibold", 10),
            padding=(12, 9),
            arrowcolor=ink,
        )
        style.map(
            "Secondary.TMenubutton",
            background=[("active", subtle_active), ("disabled", "#f4f6f8")],
            bordercolor=[("active", "#c5d6e3"), ("disabled", border)],
            arrowcolor=[("disabled", "#8ca5b7")],
        )
        style.configure("App.TNotebook", background=app_bg, borderwidth=0, tabmargins=(0, 0, 0, 0))
        style.configure(
            "App.TNotebook.Tab",
            background="#dfe9f1",
            foreground=ink,
            padding=(18, 10),
            font=("Segoe UI Semibold", 10),
            borderwidth=0,
        )
        style.map(
            "App.TNotebook.Tab",
            background=[("selected", card_bg), ("active", "#edf4f8")],
            foreground=[("selected", ink)],
        )

    def _build_ui(self) -> None:
        root = ttk.Frame(self, padding=18, style="App.TFrame")
        root.pack(fill="both", expand=True)

        hero = tk.Frame(root, bg="#102132", bd=0, highlightthickness=0)
        hero.pack(fill="x")
        tk.Label(
            hero,
            text=APP_TITLE,
            bg="#102132",
            fg="#ffffff",
            font=("Segoe UI Semibold", 20),
            anchor="w",
        ).pack(anchor="w", padx=18, pady=(14, 2))
        tk.Label(
            hero,
            text="Build case-based radiology decks from diagnoses, random categories, or exact Radiopaedia case URLs.",
            bg="#102132",
            fg="#c6d5e1",
            font=("Segoe UI", 10),
            anchor="w",
        ).pack(anchor="w", padx=18, pady=(0, 12))

        notebook = ttk.Notebook(root, style="App.TNotebook")
        notebook.pack(fill="both", expand=True, pady=(10, 10))
        self.main_notebook = notebook

        self.cases_tab = ttk.Frame(notebook, padding=14, style="App.TFrame")
        self.build_tab = ttk.Frame(notebook, padding=14, style="App.TFrame")
        self.activity_tab = ttk.Frame(notebook, padding=14, style="App.TFrame")
        notebook.add(self.cases_tab, text="Cases")
        notebook.add(self.build_tab, text="Build")
        notebook.add(self.activity_tab, text="Activity")

        self.cases_tab.columnconfigure(0, weight=1)
        self.cases_tab.rowconfigure(1, weight=1)

        request_tools = ttk.Frame(self.cases_tab, style="App.TFrame")
        request_tools.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        request_tools.columnconfigure(4, weight=1)

        ttk.Label(
            request_tools,
            text="Case Requests",
            font=("Segoe UI Semibold", 16),
            foreground="#123046",
        ).grid(row=0, column=0, sticky="w")

        self.add_request_button = ttk.Menubutton(request_tools, text="Add Request", style="Secondary.TMenubutton")
        self.add_request_button.grid(row=0, column=1, sticky="w", padx=(14, 0))
        self.add_request_menu = tk.Menu(self.add_request_button, tearoff=0)
        self.add_request_menu.add_command(
            label="Specific Diagnosis",
            command=lambda: self.add_request_row({"mode": REQUEST_MODE_SPECIFIC}),
        )
        self.add_request_menu.add_command(
            label="Random Case",
            command=lambda: self.add_request_row({"mode": REQUEST_MODE_RANDOM}),
        )
        self.add_request_menu.add_command(
            label="Manual Radiopaedia URL",
            command=lambda: self.add_request_row({"mode": REQUEST_MODE_MANUAL}),
        )
        self.add_request_button["menu"] = self.add_request_menu
        self._track_widget(self.add_request_button)

        self.load_button = ttk.Button(request_tools, text="Load File", command=self.load_diagnoses_file, style="Secondary.TButton")
        self.load_button.grid(row=0, column=2, sticky="w", padx=(8, 0))
        self._track_widget(self.load_button)

        self.library_button = ttk.Menubutton(request_tools, text="Library", style="Secondary.TMenubutton")
        self.library_button.grid(row=0, column=3, sticky="w", padx=(8, 0))
        self.library_menu = tk.Menu(self.library_button, tearoff=0)
        self.library_menu.add_command(label="Load Favorite Cases", command=self.load_favorite_cases)
        self.library_menu.add_command(label="Load Saved Library Cases", command=self.load_saved_library_cases)
        self.library_button["menu"] = self.library_menu
        self._track_widget(self.library_button)
        self._track_widget(self.library_button)

        ttk.Label(
            request_tools,
            text="Build requests here first. A single request should fit cleanly; scrolling only kicks in once you add more.",
            style="PageSub.TLabel",
            anchor="e",
            justify="right",
        ).grid(row=0, column=4, sticky="e", padx=(16, 0))

        request_canvas_frame = ttk.Frame(self.cases_tab, style="Card.TFrame", padding=8)
        request_canvas_frame.grid(row=1, column=0, sticky="nsew")
        request_canvas_frame.columnconfigure(0, weight=1)
        request_canvas_frame.rowconfigure(0, weight=1)
        self.requests_frame = request_canvas_frame

        self.request_canvas = tk.Canvas(
            request_canvas_frame,
            background="#eef4f8",
            highlightthickness=0,
            bd=0,
        )
        self.request_canvas.grid(row=0, column=0, sticky="nsew")
        self.request_scroll = ttk.Scrollbar(request_canvas_frame, orient="vertical", command=self.request_canvas.yview)
        self.request_scroll.grid(row=0, column=1, sticky="ns")
        self.request_canvas.configure(yscrollcommand=self.request_scroll.set)

        self.request_body = ttk.Frame(self.request_canvas, style="App.TFrame")
        self.request_canvas_window = self.request_canvas.create_window((0, 0), window=self.request_body, anchor="nw")
        self.request_body.bind("<Configure>", lambda _event: self.request_canvas.configure(scrollregion=self.request_canvas.bbox("all")))
        self.request_canvas.bind("<Configure>", lambda event: self.request_canvas.itemconfigure(self.request_canvas_window, width=event.width))
        request_canvas_frame.bind("<Enter>", lambda _event: self.request_canvas.focus_set())
        self.request_canvas.bind("<Enter>", lambda _event: self.request_canvas.focus_set())
        self.request_body.bind("<Enter>", lambda _event: self.request_canvas.focus_set())
        self.bind_all("<MouseWheel>", self._on_global_mousewheel, add="+")
        self.bind_all("<Button-4>", self._on_global_mousewheel_linux, add="+")
        self.bind_all("<Button-5>", self._on_global_mousewheel_linux, add="+")

        self.build_tab.columnconfigure(0, weight=3)
        self.build_tab.columnconfigure(1, weight=2)

        build_intro = ttk.Frame(self.build_tab, style="App.TFrame")
        build_intro.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 10))
        ttk.Label(
            build_intro,
            text="Build Settings",
            font=("Segoe UI Semibold", 16),
            foreground="#123046",
        ).pack(anchor="w")
        ttk.Label(
            build_intro,
            text="Keep this tab lean: title the deck, choose output options, and generate after your case review.",
            style="PageSub.TLabel",
        ).pack(anchor="w", pady=(4, 0))

        build_form = ttk.Frame(self.build_tab, style="Card.TFrame", padding=14)
        build_form.grid(row=1, column=0, sticky="nsew", padx=(0, 10))
        build_form.columnconfigure(1, weight=1)
        build_form.columnconfigure(3, weight=1)

        ttk.Label(build_form, text="Deck title", style="CardSub.TLabel").grid(row=0, column=0, sticky="w")
        title_entry = ttk.Entry(build_form, textvariable=self.title_var)
        title_entry.grid(row=0, column=1, columnspan=3, sticky="ew", pady=(4, 10))
        self._track_widget(title_entry)

        ttk.Label(build_form, text="Images per case", style="CardSub.TLabel").grid(row=1, column=0, sticky="w")
        images_spin = ttk.Spinbox(build_form, from_=1, to=4, textvariable=self.images_var, width=6)
        images_spin.grid(row=1, column=1, sticky="w", pady=(4, 10), padx=(0, 12))
        self._track_widget(images_spin)

        ttk.Label(build_form, text="Output .pptx (optional)", style="CardSub.TLabel").grid(row=1, column=2, sticky="w")
        output_row = ttk.Frame(build_form, style="Card.TFrame")
        output_row.grid(row=1, column=3, sticky="ew", pady=(4, 10))
        output_row.columnconfigure(0, weight=1)
        output_entry = ttk.Entry(output_row, textvariable=self.output_var)
        output_entry.grid(row=0, column=0, sticky="ew")
        self._track_widget(output_entry)
        browse_button = ttk.Button(output_row, text="Browse", command=self.choose_output, style="Secondary.TButton")
        browse_button.grid(row=0, column=1, padx=(8, 0))
        self._track_widget(browse_button)

        options_row = ttk.Frame(build_form, style="Card.TFrame")
        options_row.grid(row=2, column=0, columnspan=4, sticky="ew", pady=(0, 0))
        auto_open = ttk.Checkbutton(options_row, text="Open the generated deck when finished", variable=self.auto_open_var, style="Card.TCheckbutton")
        auto_open.pack(side="left")
        self._track_widget(auto_open)

        clinical_history = ttk.Checkbutton(
            options_row,
            text="Use minimal clinical history when available",
            variable=self.clinical_history_var,
            style="Card.TCheckbutton",
        )
        clinical_history.pack(side="left", padx=(18, 0))
        self._track_widget(clinical_history)

        self.deck_advanced_button = ttk.Button(
            build_form,
            textvariable=self.deck_advanced_button_var,
            command=self._toggle_deck_advanced,
            style="CardGhost.TButton",
        )
        self.deck_advanced_button.grid(row=3, column=0, columnspan=4, sticky="w", pady=(8, 0))
        self._track_widget(self.deck_advanced_button)

        self.deck_advanced_frame = ttk.Frame(build_form, style="Card.TFrame")
        self.deck_advanced_frame.grid(row=4, column=0, columnspan=4, sticky="ew", pady=(8, 0))
        self.deck_advanced_frame.columnconfigure(1, weight=1)
        self.deck_advanced_frame.columnconfigure(3, weight=1)

        ttk.Label(self.deck_advanced_frame, text="Theme", style="CardSub.TLabel").grid(row=0, column=0, sticky="w")
        theme_combo = ttk.Combobox(self.deck_advanced_frame, values=THEME_OPTIONS, textvariable=self.theme_var, state="readonly")
        theme_combo.grid(row=0, column=1, sticky="ew", padx=(0, 12), pady=(4, 8))
        self._track_widget(theme_combo)

        ttk.Label(self.deck_advanced_frame, text="Default crop", style="CardSub.TLabel").grid(row=0, column=2, sticky="w")
        crop_combo = ttk.Combobox(self.deck_advanced_frame, values=CROP_MODE_OPTIONS, textvariable=self.crop_mode_var, state="readonly")
        crop_combo.grid(row=0, column=3, sticky="ew", pady=(4, 8))
        self._track_widget(crop_combo)

        ttk.Label(self.deck_advanced_frame, text="Default markup", style="CardSub.TLabel").grid(row=1, column=0, sticky="w")
        markup_combo = ttk.Combobox(self.deck_advanced_frame, values=MARKUP_STYLE_OPTIONS, textvariable=self.markup_style_var, state="readonly")
        markup_combo.grid(row=1, column=1, sticky="ew", padx=(0, 12), pady=(4, 8))
        self._track_widget(markup_combo)

        teaching_points = ttk.Checkbutton(
            self.deck_advanced_frame,
            text="Add a teaching points slide after each diagnosis slide",
            variable=self.teaching_points_var,
            style="Card.TCheckbutton",
        )
        teaching_points.grid(row=2, column=0, columnspan=4, sticky="w", pady=(4, 0))
        self._track_widget(teaching_points)

        ollama_assist = ttk.Checkbutton(
            self.deck_advanced_frame,
            text="Use Ollama image review when a vision model is installed",
            variable=self.ollama_assist_var,
            style="Card.TCheckbutton",
        )
        ollama_assist.grid(row=3, column=0, columnspan=4, sticky="w", pady=(4, 0))
        self._track_widget(ollama_assist)

        action_panel = ttk.Frame(self.build_tab, style="Card.TFrame", padding=14)
        action_panel.grid(row=1, column=1, sticky="nsew")
        action_panel.columnconfigure(0, weight=1)

        ttk.Label(
            action_panel,
            text="Ready To Build",
            font=("Segoe UI Semibold", 14),
            foreground="#123046",
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(
            action_panel,
            text="Generate only after you are happy with the case requests on the Cases tab.",
            style="CardSub.TLabel",
            wraplength=360,
            justify="left",
        ).grid(row=1, column=0, sticky="w", pady=(4, 12))

        self.generate_button = ttk.Button(
            action_panel,
            text="Generate PowerPoint",
            command=self.start_generation,
            style="Primary.TButton",
        )
        self.generate_button.grid(row=2, column=0, sticky="ew")

        open_last_button = ttk.Button(action_panel, text="Open Last Deck", command=self.open_last_output, style="Secondary.TButton")
        open_last_button.grid(row=3, column=0, sticky="ew", pady=(10, 0))
        self._track_widget(open_last_button)

        self.more_button = ttk.Menubutton(action_panel, text="More", style="Secondary.TMenubutton")
        self.more_button.grid(row=4, column=0, sticky="ew", pady=(10, 0))
        self.more_menu = tk.Menu(self.more_button, tearoff=0)
        self.more_menu.add_command(label="Open Outputs Folder", command=self.open_outputs_folder)
        self.more_menu.add_command(label="Open Library Folder", command=self.open_library_folder)
        self.more_menu.add_separator()
        self.more_menu.add_command(label="Clear Form", command=self.clear_form)
        self.more_button["menu"] = self.more_menu
        self._track_widget(self.more_button)

        self.activity_tab.columnconfigure(0, weight=1)
        self.activity_tab.rowconfigure(1, weight=1)

        activity_header = ttk.Frame(self.activity_tab, style="App.TFrame")
        activity_header.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        activity_header.columnconfigure(1, weight=1)
        ttk.Label(
            activity_header,
            text="Activity Log",
            font=("Segoe UI Semibold", 16),
            foreground="#123046",
        ).grid(row=0, column=0, sticky="w")
        ttk.Button(activity_header, text="Open Outputs Folder", command=self.open_outputs_folder, style="Secondary.TButton").grid(row=0, column=1, sticky="e")

        self.log_frame = ttk.Frame(self.activity_tab, style="Card.TFrame", padding=10)
        self.log_frame.grid(row=1, column=0, sticky="nsew")
        self.log_frame.columnconfigure(0, weight=1)
        self.log_frame.rowconfigure(0, weight=1)

        self.log_text = tk.Text(
            self.log_frame,
            wrap="word",
            height=7,
            state="disabled",
            font=("Consolas", 10),
            bg="#0f2537",
            fg="#d9ebf7",
            insertbackground="#d9ebf7",
            relief="solid",
            borderwidth=1,
        )
        self.log_text.grid(row=0, column=0, sticky="nsew")
        log_scroll = ttk.Scrollbar(self.log_frame, orient="vertical", command=self.log_text.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log_text.configure(yscrollcommand=log_scroll.set)

        status_row = ttk.Frame(root, style="App.TFrame")
        status_row.pack(fill="x", pady=(0, 2))
        self.progress = ttk.Progressbar(status_row, mode="indeterminate", length=180)
        self.progress.pack(side="left")
        ttk.Label(status_row, textvariable=self.status_var, style="Status.TLabel").pack(side="left", padx=(12, 0))
        self.log_toggle_button = ttk.Button(
            status_row,
            textvariable=self.log_toggle_var,
            command=self._toggle_log_visibility,
            style="Ghost.TButton",
        )
        self.log_toggle_button.pack(side="left", padx=(16, 0))
        self._track_widget(self.log_toggle_button)
        ttk.Label(status_row, textvariable=self.last_output_var, style="PageSub.TLabel").pack(side="right")

        self._set_deck_advanced_visible(False)
        self._set_log_visible(False)

    def _set_deck_advanced_visible(self, visible: bool) -> None:
        self.deck_advanced_visible = bool(visible)
        self.deck_advanced_button_var.set("Hide Advanced Options" if self.deck_advanced_visible else "Show Advanced Options")
        if self.deck_advanced_visible:
            self.deck_advanced_frame.grid()
        else:
            self.deck_advanced_frame.grid_remove()

    def _toggle_deck_advanced(self) -> None:
        self._set_deck_advanced_visible(not self.deck_advanced_visible)

    def _set_log_visible(self, visible: bool) -> None:
        self.log_visible = bool(visible)
        self.log_toggle_var.set("Open Activity")
        if self.log_visible:
            try:
                self.main_notebook.select(self.activity_tab)
            except Exception:
                pass

    def _toggle_log_visibility(self) -> None:
        self._set_log_visible(True)

    def _requests_container(self) -> tk.Widget:
        return self.requests_frame

    def _bind_request_focus_widgets(self, widget: tk.Widget) -> None:
        try:
            widget.bind("<Enter>", lambda _event: self.request_canvas.focus_set(), add="+")
        except Exception:
            return
        for child in widget.winfo_children():
            self._bind_request_focus_widgets(child)

    def _widget_is_in_request_area(self, widget: tk.Widget | None) -> bool:
        current = widget
        while current is not None:
            if current in {self.request_canvas, self.request_body, self.requests_frame, self.request_scroll}:
                return True
            current = getattr(current, "master", None)
        return False

    def _pointer_widget(self) -> tk.Widget | None:
        try:
            x, y = self.winfo_pointerxy()
            return self.winfo_containing(x, y)
        except Exception:
            return None

    def _request_area_can_scroll(self) -> bool:
        try:
            return self.request_body.winfo_height() > self.request_canvas.winfo_height() + 4
        except Exception:
            return False

    def _on_global_mousewheel(self, event: tk.Event) -> str | None:
        pointer_widget = self._pointer_widget() or getattr(event, "widget", None)
        if not self._widget_is_in_request_area(pointer_widget):
            return None
        if not self._request_area_can_scroll():
            return "break"

        delta = int(getattr(event, "delta", 0))
        if delta == 0:
            return "break"
        units = -max(1, abs(delta) // 120) if delta > 0 else max(1, abs(delta) // 120)
        self.request_canvas.yview_scroll(units, "units")
        return "break"

    def _on_global_mousewheel_linux(self, event: tk.Event) -> str | None:
        pointer_widget = self._pointer_widget() or getattr(event, "widget", None)
        if not self._widget_is_in_request_area(pointer_widget):
            return None
        if not self._request_area_can_scroll():
            return "break"

        num = int(getattr(event, "num", 0))
        if num == 4:
            self.request_canvas.yview_scroll(-1, "units")
        elif num == 5:
            self.request_canvas.yview_scroll(1, "units")
        return "break"

    def _clear_request_rows(self) -> None:
        for row in self.request_rows:
            row.destroy()
        self.request_rows = []

    def _scroll_row_into_view(self, row: RequestRow) -> None:
        try:
            self.request_canvas.update_idletasks()
            frame = row.frame
            content_height = max(1, self.request_body.winfo_height())
            canvas_height = max(1, self.request_canvas.winfo_height())
            top = self.request_canvas.canvasy(0)
            bottom = top + canvas_height
            row_top = frame.winfo_y()
            row_bottom = row_top + max(1, frame.winfo_height())

            if row_top < top:
                self.request_canvas.yview_moveto(max(0.0, row_top / content_height))
            elif row_bottom > bottom:
                target = (row_bottom - canvas_height + 16) / content_height
                self.request_canvas.yview_moveto(min(1.0, max(0.0, target)))
        except Exception:
            pass

    def _focus_row_primary_input(self, row: RequestRow) -> None:
        try:
            if row.mode_var.get() in {REQUEST_MODE_SPECIFIC, REQUEST_MODE_MANUAL}:
                row.diagnosis_entry.focus_set()
            else:
                row.count_spin.focus_set()
        except Exception:
            pass

    def add_request_row(self, initial_state: dict | None = None, *, scroll_into_view: bool = True) -> None:
        row = RequestRow(self.request_body, self, len(self.request_rows) + 1, initial_state)
        self.request_rows.append(row)
        self._bind_request_focus_widgets(row.frame)
        def finalize() -> None:
            self.request_canvas.configure(scrollregion=self.request_canvas.bbox("all"))
            if scroll_into_view:
                self._scroll_row_into_view(row)
                self._focus_row_primary_input(row)

        self.request_canvas.after(10, finalize)

    def remove_request_row(self, row: RequestRow) -> None:
        if row not in self.request_rows:
            return
        row.destroy()
        self.request_rows.remove(row)
        if not self.request_rows:
            self.add_request_row({"mode": REQUEST_MODE_SPECIFIC})
        self._refresh_request_rows()

    def _refresh_request_rows(self) -> None:
        for index, row in enumerate(self.request_rows, start=1):
            row.update_index(index)
        self.request_canvas.after(10, lambda: self.request_canvas.configure(scrollregion=self.request_canvas.bbox("all")))

    def _populate_request_rows(self, row_states: list[dict]) -> None:
        self._clear_request_rows()
        for row_state in row_states:
            self.add_request_row(row_state, scroll_into_view=False)
        if not self.request_rows:
            self.add_request_row({"mode": REQUEST_MODE_SPECIFIC}, scroll_into_view=False)
        self._refresh_request_rows()
        self.request_canvas.after(10, lambda: self.request_canvas.yview_moveto(0.0))

    def _load_library_state(self) -> None:
        try:
            if LIBRARY_PATH.exists():
                parsed = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
                if isinstance(parsed, dict):
                    self.library_state = default_library_state()
                    for key in ["saved", "favorites", "blocked"]:
                        values = parsed.get(key, [])
                        self.library_state[key] = values if isinstance(values, list) else []
                    return
        except Exception:
            pass
        self.library_state = default_library_state()

    def _save_library_state(self) -> None:
        LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
        LIBRARY_PATH.write_text(json.dumps(self.library_state, indent=2), encoding="utf-8")

    def _library_entry_from_item(self, item: dict) -> dict | None:
        case_data = dict(item.get("caseData") or {})
        request = dict(item.get("request") or {})
        source_request = dict(request.get("sourceRequest") or request)
        case_path = collapse_text(case_data.get("casePath") or request.get("selectedCasePath"))
        if not case_path:
            return None

        case_url = collapse_text(case_data.get("caseUrl") or "")
        if not case_url and case_path.startswith("/cases/"):
            case_url = f"https://radiopaedia.org{case_path.split('?')[0]}"

        return {
            "casePath": case_path,
            "caseUrl": case_url,
            "caseTitle": case_data.get("caseTitle", "Radiopaedia case"),
            "studyHint": case_data.get("studyHint") or source_request.get("studyHint") or "",
            "rawInput": case_data.get("rawInput") or request.get("rawInput") or "",
            "sourceRequest": source_request,
            "savedAt": datetime.utcnow().isoformat(),
        }

    def _upsert_library_bucket(self, bucket: str, entry: dict) -> None:
        case_path = collapse_text(entry.get("casePath", ""))
        if not case_path:
            return

        current = [
            existing
            for existing in self.library_state.get(bucket, [])
            if collapse_text(existing.get("casePath", "")) != case_path
        ]
        self.library_state[bucket] = [entry] + current

    def _remove_from_library_bucket(self, bucket: str, case_path: str) -> None:
        clean_path = collapse_text(case_path)
        self.library_state[bucket] = [
            entry
            for entry in self.library_state.get(bucket, [])
            if collapse_text(entry.get("casePath", "")) != clean_path
        ]

    def _blocked_case_paths(self) -> list[str]:
        return [
            collapse_text(entry.get("casePath", ""))
            for entry in self.library_state.get("blocked", [])
            if collapse_text(entry.get("casePath", ""))
        ]

    def save_prepared_case(self, item: dict) -> None:
        entry = self._library_entry_from_item(item)
        if not entry:
            return
        self._upsert_library_bucket("saved", entry)
        self._save_library_state()

    def favorite_prepared_case(self, item: dict) -> None:
        entry = self._library_entry_from_item(item)
        if not entry:
            return
        self._upsert_library_bucket("saved", entry)
        self._upsert_library_bucket("favorites", entry)
        self._remove_from_library_bucket("blocked", entry["casePath"])
        self._save_library_state()

    def block_prepared_case(self, item: dict) -> None:
        entry = self._library_entry_from_item(item)
        if not entry:
            return
        blocked_entry = {
            "casePath": entry["casePath"],
            "caseUrl": entry.get("caseUrl", ""),
            "caseTitle": entry.get("caseTitle", "Radiopaedia case"),
            "savedAt": entry.get("savedAt", ""),
        }
        self._upsert_library_bucket("blocked", blocked_entry)
        self._remove_from_library_bucket("favorites", entry["casePath"])
        self._save_library_state()

    def _library_rows_from_entries(self, entries: list[dict]) -> list[dict]:
        rows = []
        for entry in entries:
            study_hint = collapse_text(entry.get("studyHint", ""))
            modality, anatomy = parse_study_hint(study_hint)
            source_request = entry.get("sourceRequest") if isinstance(entry.get("sourceRequest"), dict) else {}
            row_state = row_state_defaults(REQUEST_MODE_MANUAL)
            row_state.update(
                {
                    "mode": REQUEST_MODE_MANUAL,
                    "diagnosis": entry.get("caseUrl") or entry.get("casePath") or "",
                    "modality": modality,
                    "secondary_modality": first_match(str(source_request.get("secondaryModality", "")), MODALITY_PATTERNS),
                    "anatomy": anatomy,
                    "age_group": source_request.get("ageGroup", "Any") if source_request.get("ageGroup") in AGE_GROUP_OPTIONS else "Any",
                    "topic_focus": source_request.get("topicFocus", "Any") if source_request.get("topicFocus") in TOPIC_OPTIONS else "Any",
                    "difficulty": source_request.get("difficulty", "Any") if source_request.get("difficulty") in DIFFICULTY_OPTIONS else "Any",
                }
            )
            rows.append(row_state)
        return rows

    def _has_meaningful_requests(self) -> bool:
        for row in self.request_rows:
            state = row.serialize()
            if state["mode"] == REQUEST_MODE_RANDOM and state["count"] >= 1:
                return True
            if collapse_text(state["diagnosis"]):
                return True
        return False

    def _load_library_bucket_into_rows(self, bucket: str, title_text: str) -> None:
        entries = list(self.library_state.get(bucket, []))
        if not entries:
            messagebox.showinfo(APP_TITLE, f"There are no cases in {title_text.lower()} yet.")
            return

        dialog = LibraryPickerDialog(
            self,
            title_text,
            "Choose one or more cases to load back into the request list as manual Radiopaedia case rows.",
            entries,
        )
        self.wait_window(dialog)
        if dialog.result is None:
            return

        row_states = self._library_rows_from_entries(dialog.result)
        if not self._has_meaningful_requests():
            self._populate_request_rows(row_states)
        else:
            for row_state in row_states:
                self.add_request_row(row_state)
            self._refresh_request_rows()

    def load_favorite_cases(self) -> None:
        self._load_library_bucket_into_rows("favorites", "Favorite Cases")

    def load_saved_library_cases(self) -> None:
        self._load_library_bucket_into_rows("saved", "Saved Library Cases")

    def _load_state(self) -> None:
        if not STATE_PATH.exists():
            self.add_request_row({"mode": REQUEST_MODE_SPECIFIC})
            return

        try:
            state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            self.add_request_row({"mode": REQUEST_MODE_SPECIFIC})
            return

        self.title_var.set(state.get("title", ""))
        self.images_var.set(max(1, int(state.get("images_per_case", 3))))
        self.output_var.set(state.get("output_path", ""))
        self.last_output_path = state.get("last_output", "")
        self.last_output_var.set(self._last_output_label(self.last_output_path))
        self.auto_open_var.set(bool(state.get("auto_open", True)))
        self.clinical_history_var.set(bool(state.get("clinical_history", True)))
        self.ollama_assist_var.set(bool(state.get("ollama_assist", True)))
        self.theme_var.set(theme_label_from_cli(state.get("theme", "classic")))
        self.crop_mode_var.set(crop_label_from_cli(state.get("crop_mode", "default")))
        self.markup_style_var.set(markup_label_from_cli(state.get("markup_style", "none")))
        self.teaching_points_var.set(bool(state.get("teaching_points", False)))

        request_rows = state.get("requests", [])
        if isinstance(request_rows, list) and request_rows:
            self._populate_request_rows(
                self._compact_loaded_row_states([self._normalize_row_state(item) for item in request_rows])
            )
            return

        diagnoses = state.get("diagnoses", "")
        if diagnoses:
            self._populate_request_rows(self._compact_loaded_row_states(self._legacy_text_to_rows(diagnoses)))
            return

        self.add_request_row({"mode": REQUEST_MODE_SPECIFIC})

    def _save_state(self) -> None:
        state = {
            "title": self.title_var.get().strip(),
            "images_per_case": self.images_var.get(),
            "output_path": self.output_var.get().strip(),
            "last_output": self.last_output_path,
            "auto_open": self.auto_open_var.get(),
            "clinical_history": self.clinical_history_var.get(),
            "ollama_assist": self.ollama_assist_var.get(),
            "theme": theme_cli_value(self.theme_var.get()),
            "crop_mode": crop_cli_value(self.crop_mode_var.get()),
            "markup_style": markup_cli_value(self.markup_style_var.get()),
            "teaching_points": self.teaching_points_var.get(),
            "requests": [row.serialize() for row in self.request_rows],
        }
        STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")

    def _normalize_row_state(self, item: object) -> dict:
        if isinstance(item, str):
            return self._legacy_line_to_row(item)
        if not isinstance(item, dict):
            return row_state_defaults()

        state = row_state_defaults()
        state.update(
            {
                "mode": item.get("mode", REQUEST_MODE_SPECIFIC) if item.get("mode") in REQUEST_MODE_OPTIONS else REQUEST_MODE_SPECIFIC,
                "diagnosis": collapse_text(item.get("diagnosis", "")),
                "count": max(1, safe_int(item.get("count", 1), 1)),
                "random_style": item.get("random_style", RANDOM_STYLE_ANY) if item.get("random_style") in RANDOM_STYLE_OPTIONS else RANDOM_STYLE_ANY,
                "subspecialty": item.get("subspecialty", "Any") if item.get("subspecialty") in SUBSPECIALTY_OPTIONS else "Any",
                "modality": item.get("modality", "Any") if item.get("modality") in MODALITY_OPTIONS else "Any",
                "secondary_modality": item.get("secondary_modality", "Any") if item.get("secondary_modality") in MODALITY_OPTIONS else "Any",
                "anatomy": item.get("anatomy", "Any") if item.get("anatomy") in ANATOMY_OPTIONS else "Any",
                "age_group": item.get("age_group", "Any") if item.get("age_group") in AGE_GROUP_OPTIONS else "Any",
                "topic_focus": item.get("topic_focus", "Any") if item.get("topic_focus") in TOPIC_OPTIONS else "Any",
                "difficulty": item.get("difficulty", "Any") if item.get("difficulty") in DIFFICULTY_OPTIONS else "Any",
            }
        )
        return state

    def _row_state_is_effectively_empty(self, state: dict) -> bool:
        mode = state.get("mode", REQUEST_MODE_SPECIFIC)
        diagnosis = collapse_text(state.get("diagnosis", ""))
        if mode in {REQUEST_MODE_SPECIFIC, REQUEST_MODE_MANUAL}:
            return not diagnosis

        return (
            not diagnosis
            and max(1, safe_int(state.get("count", 1), 1)) == 1
            and state.get("random_style", RANDOM_STYLE_ANY) == RANDOM_STYLE_ANY
            and state.get("subspecialty", "Any") == "Any"
            and state.get("modality", "Any") == "Any"
            and state.get("secondary_modality", "Any") == "Any"
            and state.get("anatomy", "Any") == "Any"
            and state.get("age_group", "Any") == "Any"
            and state.get("topic_focus", "Any") == "Any"
            and state.get("difficulty", "Any") == "Any"
        )

    def _compact_loaded_row_states(self, row_states: list[dict]) -> list[dict]:
        compacted = [state for state in row_states if not self._row_state_is_effectively_empty(state)]
        if compacted:
            return compacted

        if row_states:
            return [row_state_defaults(row_states[0].get("mode", REQUEST_MODE_SPECIFIC))]
        return [row_state_defaults()]

    def _legacy_text_to_rows(self, raw_text: str) -> list[dict]:
        rows = []
        for line in raw_text.splitlines():
            clean = re.sub(r"#.*$", "", line).strip()
            if clean:
                rows.append(self._legacy_line_to_row(clean))
        return rows or [row_state_defaults()]

    def _legacy_line_to_row(self, line: str) -> dict:
        clean = collapse_text(line)
        if not clean:
            return row_state_defaults()

        case_path, raw_input = normalize_manual_case_path(clean)
        if case_path:
            return {
                "mode": REQUEST_MODE_MANUAL,
                "diagnosis": raw_input or case_path,
                "count": 1,
                "subspecialty": "Any",
                "modality": "Any",
                "secondary_modality": "Any",
                "anatomy": "Any",
                "age_group": "Any",
                "topic_focus": "Any",
                "difficulty": "Any",
            }

        if detect_random_legacy_request(clean):
            return self._legacy_random_row(clean)

        diagnosis = clean
        study_hint = ""
        if "," in clean:
            left, right = clean.split(",", 1)
            diagnosis = collapse_text(left)
            study_hint = collapse_text(right)

        modality, anatomy = parse_study_hint(study_hint)
        return {
            "mode": REQUEST_MODE_SPECIFIC,
            "diagnosis": diagnosis,
            "count": 1,
            "subspecialty": "Any",
            "modality": modality,
            "secondary_modality": "Any",
            "anatomy": anatomy,
            "age_group": "Any",
            "topic_focus": "Any",
            "difficulty": "Any",
        }

    def _legacy_random_row(self, line: str) -> dict:
        clean = collapse_text(line)
        count_match = re.search(r"\b(\d{1,2})\b", clean)
        count = max(1, min(20, safe_int(count_match.group(1), 1))) if count_match else 1

        base_text = clean
        study_hint = ""
        if "," in clean:
            base_text, study_hint = [collapse_text(part) for part in clean.split(",", 1)]

        modality_source = study_hint or clean
        modality, anatomy = parse_study_hint(modality_source)
        subspecialty = infer_subspecialty(base_text)

        return {
            "mode": REQUEST_MODE_RANDOM,
            "diagnosis": "",
            "count": count,
            "random_style": RANDOM_STYLE_SUBSPECIALTY if subspecialty != "Any" else RANDOM_STYLE_ANY,
            "subspecialty": subspecialty,
            "modality": modality,
            "secondary_modality": "Any",
            "anatomy": anatomy,
            "age_group": "Any",
            "topic_focus": "Any",
            "difficulty": "Any",
        }

    def _row_from_json_item(self, item: object) -> dict:
        if isinstance(item, str):
            return self._legacy_line_to_row(item)
        if not isinstance(item, dict):
            return row_state_defaults()

        request_mode = normalized(item.get("requestMode", ""))
        if request_mode == "manual" or item.get("selectedCasePath"):
            study_hint = collapse_text(item.get("studyHint", ""))
            modality, anatomy = parse_study_hint(study_hint)
            return {
                "mode": REQUEST_MODE_MANUAL,
                "diagnosis": item.get("caseUrl") or item.get("rawInput") or item.get("selectedCasePath") or "",
                "count": 1,
                "random_style": RANDOM_STYLE_ANY,
                "subspecialty": "Any",
                "modality": modality,
                "secondary_modality": first_match(str(item.get("secondaryModality", "")), MODALITY_PATTERNS),
                "anatomy": anatomy,
                "age_group": item.get("ageGroup", "Any") if item.get("ageGroup") in AGE_GROUP_OPTIONS else "Any",
                "topic_focus": item.get("topicFocus", "Any") if item.get("topicFocus") in TOPIC_OPTIONS else "Any",
                "difficulty": item.get("difficulty", "Any") if item.get("difficulty") in DIFFICULTY_OPTIONS else "Any",
            }

        if request_mode in {"random", "random_case"} or item.get("randomCount") or item.get("randomSystems"):
            modality, anatomy = parse_study_hint(item.get("studyHint", ""))
            if item.get("modality") in MODALITY_OPTIONS:
                modality = item["modality"]
            if item.get("anatomy"):
                guessed_anatomy = first_match(str(item["anatomy"]), ANATOMY_PATTERNS)
                if guessed_anatomy != "Any":
                    anatomy = guessed_anatomy

            systems = sorted(collapse_text(value) for value in item.get("randomSystems", []) if collapse_text(value))
            system_mode = "any" if normalized(item.get("randomSystemMode", "")) == "any" else "all"
            subspecialty = SUBSPECIALTY_REVERSE.get((system_mode, tuple(systems)), "Any")
            if subspecialty == "Any":
                subspecialty = infer_subspecialty(item.get("rawInput", "") or item.get("randomQuery", ""))

            return {
                "mode": REQUEST_MODE_RANDOM,
                "diagnosis": "",
                "count": max(1, min(20, safe_int(item.get("randomCount", 1), 1))),
                "random_style": (
                    RANDOM_STYLE_MIXED
                    if normalized(item.get("randomDiversity", "")) == "mixed"
                    else RANDOM_STYLE_SUBSPECIALTY
                    if subspecialty != "Any"
                    else RANDOM_STYLE_MODALITY
                    if modality != "Any" and anatomy == "Any"
                    else RANDOM_STYLE_ANATOMY
                    if anatomy != "Any"
                    else RANDOM_STYLE_ANY
                ),
                "subspecialty": subspecialty,
                "modality": modality,
                "secondary_modality": first_match(str(item.get("secondaryModality", "")), MODALITY_PATTERNS),
                "anatomy": anatomy,
                "age_group": item.get("ageGroup", "Any") if item.get("ageGroup") in AGE_GROUP_OPTIONS else "Any",
                "topic_focus": item.get("topicFocus", "Any") if item.get("topicFocus") in TOPIC_OPTIONS else "Any",
                "difficulty": item.get("difficulty", "Any") if item.get("difficulty") in DIFFICULTY_OPTIONS else "Any",
            }

        diagnosis = collapse_text(item.get("diagnosis", ""))
        if not diagnosis:
            return self._legacy_line_to_row(collapse_text(item.get("rawInput", "")))

        study_hint = collapse_text(item.get("studyHint", ""))
        modality, anatomy = parse_study_hint(study_hint)
        if item.get("modality") in MODALITY_OPTIONS:
            modality = item["modality"]
        if item.get("anatomy"):
            guessed_anatomy = first_match(str(item["anatomy"]), ANATOMY_PATTERNS)
            if guessed_anatomy != "Any":
                anatomy = guessed_anatomy

        return {
            "mode": REQUEST_MODE_SPECIFIC,
            "diagnosis": diagnosis,
            "count": 1,
            "subspecialty": "Any",
            "modality": modality,
            "secondary_modality": first_match(str(item.get("secondaryModality", "")), MODALITY_PATTERNS),
            "anatomy": anatomy,
            "age_group": item.get("ageGroup", "Any") if item.get("ageGroup") in AGE_GROUP_OPTIONS else "Any",
            "topic_focus": item.get("topicFocus", "Any") if item.get("topicFocus") in TOPIC_OPTIONS else "Any",
            "difficulty": item.get("difficulty", "Any") if item.get("difficulty") in DIFFICULTY_OPTIONS else "Any",
        }

    def _last_output_label(self, path_value: str) -> str:
        if not path_value:
            return "No deck generated yet"
        return f"Last deck: {Path(path_value).name}"

    def append_log(self, line: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"{line}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def choose_output(self) -> None:
        OUTPUTS_DIR.mkdir(exist_ok=True)
        chosen = filedialog.asksaveasfilename(
            title="Choose output PowerPoint",
            initialdir=str(OUTPUTS_DIR),
            defaultextension=".pptx",
            filetypes=[("PowerPoint", "*.pptx")],
        )
        if chosen:
            self.output_var.set(chosen)

    def load_diagnoses_file(self) -> None:
        chosen = filedialog.askopenfilename(
            title="Choose requests file",
            initialdir=str(PROJECT_ROOT),
            filetypes=[("Text or JSON", "*.txt *.json"), ("All files", "*.*")],
        )
        if not chosen:
            return

        try:
            path = Path(chosen)
            raw = path.read_text(encoding="utf-8")
            if path.suffix.lower() == ".json":
                data = json.loads(raw)
                if not isinstance(data, list):
                    raise ValueError("JSON request file must contain an array.")
                rows = [self._row_from_json_item(item) for item in data]
            else:
                rows = self._legacy_text_to_rows(raw)

            self._populate_request_rows(rows)
            self.append_log(f"Loaded requests from {path}")
        except Exception as exc:
            messagebox.showerror(APP_TITLE, f"Could not load requests file.\n\n{exc}")

    def request_entries(self) -> list[dict]:
        entries = []
        blocked_paths = self._blocked_case_paths()
        requested_images = max(1, safe_int(self.images_var.get(), 3))
        for index, row in enumerate(self.request_rows, start=1):
            payload = row.to_request_payload(index)
            payload["requestId"] = f"request-{index}"
            payload["includeClinicalHistory"] = self.clinical_history_var.get()
            payload["useOllamaAssist"] = self.ollama_assist_var.get()
            payload["cropMode"] = crop_cli_value(self.crop_mode_var.get())
            payload["markupStyle"] = markup_cli_value(self.markup_style_var.get())
            payload["requestedImagesPerCase"] = requested_images
            if blocked_paths and payload.get("requestMode") != "manual":
                payload["excludeCasePaths"] = blocked_paths
            entries.append(payload)
        return entries

    def set_busy(self, busy: bool) -> None:
        state = "disabled" if busy else "normal"
        for widget, normal_state in self.form_widgets:
            widget.configure(state=state if busy else normal_state)

        self.generate_button.configure(state="disabled" if busy else "normal")
        for row in self.request_rows:
            row.set_busy(busy)

        if busy:
            self.progress.start(12)
            if self.status_var.get() == "Ready":
                self.status_var.set("Working...")
        else:
            self.progress.stop()
            if self.status_var.get() in {"Working...", "Building PowerPoint...", "Checking matches..."}:
                self.status_var.set("Ready")

    def _probe_entries(self, entries: list[dict]) -> dict:
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                suffix="-probe.json",
                prefix="radiopaedia-case-builder-",
                delete=False,
            ) as handle:
                json.dump(entries, handle, indent=2)
                temp_path = handle.name

            completed = subprocess.run(
                [node_path(), str(CLI_SCRIPT), "--probe-input", temp_path],
                cwd=str(PROJECT_ROOT),
                env=command_env(),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                **hidden_subprocess_kwargs(),
            )
            if completed.returncode != 0:
                error_text = completed.stderr.strip() or completed.stdout.strip() or "Unknown probe error."
                raise RuntimeError(error_text)

            return json.loads(completed.stdout)
        finally:
            if temp_path:
                try:
                    Path(temp_path).unlink(missing_ok=True)
                except Exception:
                    pass

    def _prepare_entries(self, entries: list[dict], images_per_case: int) -> dict:
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                suffix="-prepare.json",
                prefix="radiopaedia-case-builder-",
                delete=False,
            ) as handle:
                json.dump(entries, handle, indent=2)
                temp_path = handle.name

            command = [
                node_path(),
                str(CLI_SCRIPT),
                "--prepare-input",
                temp_path,
                "--images-per-case",
                str(images_per_case),
            ]
            if self.clinical_history_var.get():
                command.append("--use-clinical-history")
            if self.ollama_assist_var.get():
                command.append("--use-ollama-assist")

            completed = subprocess.run(
                command,
                cwd=str(PROJECT_ROOT),
                env=command_env(),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                **hidden_subprocess_kwargs(),
            )
            if completed.returncode != 0:
                error_text = completed.stderr.strip() or completed.stdout.strip() or "Unknown prepare error."
                raise RuntimeError(error_text)

            return json.loads(completed.stdout)
        finally:
            if temp_path:
                try:
                    Path(temp_path).unlink(missing_ok=True)
                except Exception:
                    pass

    def _resolve_entries_for_generation(self, requested_entries: list[dict]) -> list[dict] | None:
        source_request_map = {entry.get("requestId"): entry for entry in requested_entries if entry.get("requestId")}
        self.status_var.set("Checking matches...")
        self.append_log("Checking Radiopaedia matches...")
        self.update_idletasks()

        probe_result = self._probe_entries(requested_entries)
        probed_entries = probe_result.get("entries", [])

        missing = [entry for entry in probed_entries if not entry.get("candidates")]
        if missing:
            lines = "\n".join(f"- {entry['rawInput']}" for entry in missing)
            messagebox.showerror(
                APP_TITLE,
                "No case matches were found for these requests.\n\n"
                f"{lines}\n\nTry correcting the diagnosis spelling, changing the modality/anatomy filters, or switching that row to Random Case.",
            )
            self.append_log("No candidates found for:")
            for entry in missing:
                self.append_log(f"  {entry['rawInput']}")
            return None

        resolved_entries = [
            {
                "rawInput": entry["rawInput"],
                "diagnosis": entry.get("diagnosis", ""),
                "studyHint": entry.get("studyHint", ""),
                "selectedCasePath": entry["candidates"][0]["casePath"],
                "selectedCaseTitle": entry["candidates"][0]["title"],
                "originalInput": entry.get("originalInput"),
                "randomSystems": entry.get("randomSystems", []),
                "randomQuery": entry.get("randomQuery", ""),
                "requestId": entry.get("requestId"),
                "sourceRequest": source_request_map.get(entry.get("requestId")),
            }
            for entry in probed_entries
        ]

        ambiguous = [entry for entry in probed_entries if entry.get("needsReview")]
        if ambiguous:
            self.append_log("Some requests need review before building.")
            dialog = MatchReviewDialog(self, ambiguous)
            self.wait_window(dialog)
            if dialog.result is None:
                self.append_log("Generation cancelled during match review.")
                return None

            review_map = {entry["rawInput"]: entry for entry in dialog.result}
            kept_entries = []
            ambiguous_inputs = {item["rawInput"] for item in ambiguous}
            for entry in resolved_entries:
                if entry["rawInput"] in ambiguous_inputs:
                    selected = review_map.get(entry["rawInput"])
                    if not selected:
                        continue
                    kept_entries.append(selected)
                else:
                    kept_entries.append(entry)
            resolved_entries = kept_entries

        if not resolved_entries:
            messagebox.showinfo(APP_TITLE, "No requests are selected for generation.")
            return None

        self.append_log("Selected matches:")
        for entry in resolved_entries:
            self.append_log(f"  {entry['rawInput']} -> {entry['selectedCaseTitle']}")

        return resolved_entries

    def _request_with_review_options(self, item: dict, *, force_same_case: bool = False, exclude_case_paths: list[str] | None = None, exclude_frame_ids: list[str] | None = None) -> dict:
        request = dict(item.get("request") or {})
        source_request = dict(request.get("sourceRequest") or request)
        review_options = dict(item.get("reviewOptions") or {})

        source_request["requestedImagesPerCase"] = max(
            1,
            safe_int(review_options.get("requestedImagesPerCase") or source_request.get("requestedImagesPerCase") or self.images_var.get(), 3),
        )
        source_request["cropMode"] = collapse_text(review_options.get("cropMode") or source_request.get("cropMode") or crop_cli_value(self.crop_mode_var.get())) or "default"
        source_request["markupStyle"] = collapse_text(review_options.get("markupStyle") or source_request.get("markupStyle") or markup_cli_value(self.markup_style_var.get())) or "none"
        source_request["includeClinicalHistory"] = self.clinical_history_var.get()
        source_request["useOllamaAssist"] = self.ollama_assist_var.get()

        blocked_paths = set(self._blocked_case_paths())
        if exclude_case_paths:
            blocked_paths.update(collapse_text(path) for path in exclude_case_paths if collapse_text(path))
        if blocked_paths and source_request.get("requestMode") != "manual":
            source_request["excludeCasePaths"] = sorted(blocked_paths)

        if force_same_case:
            selected_case_path = request.get("selectedCasePath") or item.get("caseData", {}).get("casePath")
            selected_case_title = request.get("selectedCaseTitle") or item.get("caseData", {}).get("caseTitle")
            if selected_case_path:
                source_request["requestMode"] = "manual"
                source_request["selectedCasePath"] = selected_case_path
                source_request["selectedCaseTitle"] = selected_case_title or title_from_case_path(selected_case_path)
                source_request["rawInput"] = selected_case_path
                source_request["diagnosis"] = selected_case_title or title_from_case_path(selected_case_path)
        if exclude_frame_ids:
            source_request["excludeFrameIds"] = [collapse_text(frame_id) for frame_id in exclude_frame_ids if collapse_text(frame_id)]

        return source_request

    def _reroll_prepared_case(self, item: dict, images_per_case: int) -> dict:
        rejected_paths = list(item.get("rejectedCasePaths") or [])
        request = dict(item.get("request") or {})
        current_case_path = request.get("selectedCasePath") or item.get("caseData", {}).get("casePath")
        if current_case_path:
            rejected_paths.append(current_case_path)
        source_request = self._request_with_review_options(item, exclude_case_paths=rejected_paths)

        prepared = self._prepare_entries([source_request], images_per_case)
        items = prepared.get("items", [])
        if not items:
            failures = prepared.get("failures", [])
            raise RuntimeError("\n".join(failures) if failures else "No alternate case could be prepared.")

        refreshed = items[0]
        refreshed["rejectedCasePaths"] = source_request["excludeCasePaths"]
        if prepared.get("failures"):
            for failure in prepared["failures"]:
                self.append_log(failure)
        return refreshed

    def _repick_prepared_images(self, item: dict, images_per_case: int) -> dict:
        request = dict(item.get("request") or {})
        current_case_path = request.get("selectedCasePath") or item.get("caseData", {}).get("casePath")
        excluded_frame_ids = list(item.get("rejectedFrameIds") or [])
        excluded_frame_ids.extend(
            collapse_text(image.get("frameId", ""))
            for image in item.get("caseData", {}).get("images", [])
            if collapse_text(image.get("frameId", ""))
        )
        source_request = self._request_with_review_options(
            item,
            force_same_case=True,
            exclude_frame_ids=sorted({frame_id for frame_id in excluded_frame_ids if frame_id}),
        )
        if current_case_path:
            source_request["selectedCasePath"] = current_case_path

        prepared = self._prepare_entries([source_request], images_per_case)
        items = prepared.get("items", [])
        if not items:
            failures = prepared.get("failures", [])
            raise RuntimeError("\n".join(failures) if failures else "No alternate images could be prepared from this case.")

        refreshed = items[0]
        refreshed["reviewOptions"] = dict(item.get("reviewOptions") or {})
        refreshed["rejectedFrameIds"] = source_request.get("excludeFrameIds", [])
        if prepared.get("failures"):
            for failure in prepared["failures"]:
                self.append_log(failure)
        return refreshed

    def _block_and_reroll_prepared_case(self, item: dict, images_per_case: int) -> dict | None:
        self.block_prepared_case(item)
        return self._reroll_prepared_case(item, images_per_case)

    def start_generation(self) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showinfo(APP_TITLE, "A deck is already being generated.")
            return

        try:
            requested_entries = self.request_entries()
        except ValueError as exc:
            messagebox.showwarning(APP_TITLE, str(exc))
            return

        if not requested_entries:
            messagebox.showwarning(APP_TITLE, "Add at least one case request before generating.")
            return

        if not CLI_SCRIPT.exists():
            messagebox.showerror(
                APP_TITLE,
                f"The app could not find its bundled generator files.\n\nLooked for:\n{CLI_SCRIPT}",
            )
            return

        self._save_state()
        self.set_busy(True)
        self.append_log("")
        self.append_log("Starting generation...")

        try:
            resolved_entries = self._resolve_entries_for_generation(requested_entries)
        except Exception as exc:
            self.set_busy(False)
            self.status_var.set("Build failed")
            self.append_log(str(exc))
            messagebox.showerror(APP_TITLE, f"Could not check case matches.\n\n{exc}")
            return

        if not resolved_entries:
            self.set_busy(False)
            self.status_var.set("Ready")
            return

        try:
            images_per_case = max(1, int(self.images_var.get()))
        except Exception:
            messagebox.showerror(APP_TITLE, "Images per case must be a whole number.")
            self.set_busy(False)
            return

        self.status_var.set("Preparing case previews...")
        self.append_log("Preparing preview images...")

        try:
            prepared = self._prepare_entries(resolved_entries, images_per_case)
        except Exception as exc:
            self.set_busy(False)
            self.status_var.set("Build failed")
            self.append_log(str(exc))
            messagebox.showerror(APP_TITLE, f"Could not prepare case previews.\n\n{exc}")
            return

        prepared_items = prepared.get("items", [])
        if prepared.get("failures"):
            for failure in prepared["failures"]:
                self.append_log(failure)
        if not prepared_items:
            self.set_busy(False)
            self.status_var.set("Build failed")
            messagebox.showerror(APP_TITLE, "No cases could be prepared for preview.")
            return

        self.set_busy(False)
        self.status_var.set("Review cases before export")
        review_dialog = CaseReviewDialog(
            self,
            prepared_items,
            lambda item: self._reroll_prepared_case(item, images_per_case),
            lambda item: self._repick_prepared_images(item, images_per_case),
            self.favorite_prepared_case,
            lambda item: self._block_and_reroll_prepared_case(item, images_per_case),
            self.save_prepared_case,
        )
        self.wait_window(review_dialog)

        if review_dialog.result is None:
            self.status_var.set("Ready")
            self.append_log("Generation cancelled during case review.")
            return

        approved_items = review_dialog.result
        if not approved_items:
            self.status_var.set("Ready")
            messagebox.showinfo(APP_TITLE, "No cases were kept for export.")
            return

        self.set_busy(True)
        self.status_var.set("Building PowerPoint...")

        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix="-prepared.json",
            prefix="radiopaedia-case-builder-",
            delete=False,
        ) as handle:
            json.dump({"items": approved_items}, handle, indent=2)
            temp_input_path = handle.name

        command = [
            node_path(),
            str(CLI_SCRIPT),
            "--render-input",
            temp_input_path,
        ]

        title = self.title_var.get().strip()
        if title:
            command.extend(["--title", title])

        output_path = self.output_var.get().strip()
        if output_path:
            command.extend(["--out", output_path])
        command.extend(["--theme", theme_cli_value(self.theme_var.get())])
        if self.teaching_points_var.get():
            command.append("--include-teaching-points")

        self.worker = threading.Thread(target=self._run_generation, args=(command, temp_input_path), daemon=True)
        self.worker.start()

    def _run_generation(self, command: list[str], temp_input_path: str | None = None) -> None:
        try:
            self.current_process = subprocess.Popen(
                command,
                cwd=str(PROJECT_ROOT),
                env=command_env(),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                **hidden_subprocess_kwargs(),
            )

            output_lines: list[str] = []
            assert self.current_process.stdout is not None
            for line in self.current_process.stdout:
                clean = line.rstrip()
                output_lines.append(clean)
                self.log_queue.put(("log", clean))

            return_code = self.current_process.wait()
            full_output = "\n".join(output_lines)
            self.log_queue.put(("done", return_code))
            self.log_queue.put(("result", full_output))
        except Exception as exc:
            self.log_queue.put(("error", f"{type(exc).__name__}: {exc}"))
        finally:
            self.current_process = None
            if temp_input_path:
                try:
                    Path(temp_input_path).unlink(missing_ok=True)
                except Exception:
                    pass

    def _drain_queue(self) -> None:
        saved_output: str | None = None
        saved_return_code: int | None = None

        try:
            while True:
                kind, payload = self.log_queue.get_nowait()
                if kind == "log":
                    self.append_log(str(payload))
                elif kind == "error":
                    self.set_busy(False)
                    self.status_var.set("Build failed")
                    self._set_log_visible(True)
                    self.append_log(str(payload))
                    messagebox.showerror(APP_TITLE, str(payload))
                elif kind == "done":
                    saved_return_code = int(payload)
                elif kind == "result":
                    saved_output = str(payload)
        except Empty:
            pass

        if saved_output is not None and saved_return_code is not None:
            self._handle_generation_finished(saved_return_code, saved_output)

        self.after(125, self._drain_queue)

    def _handle_generation_finished(self, return_code: int, output: str) -> None:
        self.set_busy(False)
        pptx_match = re.search(r"Created PowerPoint:\s*(.+)", output)
        pptx_path = Path(pptx_match.group(1).strip()) if pptx_match else None

        if return_code == 0 and pptx_path and pptx_path.exists():
            self.status_var.set("Build complete")
            self.last_output_path = str(pptx_path)
            self.last_output_var.set(self._last_output_label(self.last_output_path))
            self._save_state()
            self.append_log(f"Finished successfully: {pptx_path}")
            if self.auto_open_var.get():
                os.startfile(str(pptx_path))
        else:
            self.status_var.set("Build failed")
            self._set_log_visible(True)
            messagebox.showerror(APP_TITLE, "Generation finished with an error.\n\nSee the activity log for details.")

    def open_outputs_folder(self) -> None:
        OUTPUTS_DIR.mkdir(exist_ok=True)
        os.startfile(str(OUTPUTS_DIR))

    def open_project_folder(self) -> None:
        os.startfile(str(PROJECT_ROOT))

    def open_library_folder(self) -> None:
        LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(str(LIBRARY_DIR))

    def open_last_output(self) -> None:
        path = self.last_output_path
        if not path:
            messagebox.showinfo(APP_TITLE, "No generated deck is recorded yet.")
            return
        output_path = Path(path)
        if not output_path.exists():
            messagebox.showwarning(APP_TITLE, f"The last deck could not be found:\n{output_path}")
            return
        os.startfile(str(output_path))

    def build_packaged_app(self) -> None:
        script_path = PROJECT_ROOT / "build-windows-app.ps1"
        if not script_path.exists():
            messagebox.showerror(APP_TITLE, "The packaging script is missing from the project folder.")
            return

        self.set_busy(True)
        self.status_var.set("Building packaged app...")
        self.append_log("Building packaged Windows app...")
        try:
            completed = subprocess.run(
                [powershell_path(), "-ExecutionPolicy", "Bypass", "-File", str(script_path)],
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                **hidden_subprocess_kwargs(),
            )
        finally:
            self.set_busy(False)

        output = (completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else "")
        for line in output.splitlines():
            if line.strip():
                self.append_log(line.rstrip())

        if completed.returncode == 0:
            self.status_var.set("Packaged app built")
            messagebox.showinfo(APP_TITLE, "The packaged desktop app was built successfully.")
        else:
            self.status_var.set("Packaging failed")
            messagebox.showerror(APP_TITLE, "The packaged app build failed.\n\nSee the activity log for details.")

    def refresh_desktop_shortcut(self) -> None:
        script_path = PROJECT_ROOT / "create-desktop-shortcut.ps1"
        if not script_path.exists():
            messagebox.showerror(APP_TITLE, "The desktop shortcut script is missing from the project folder.")
            return

        completed = subprocess.run(
            [powershell_path(), "-ExecutionPolicy", "Bypass", "-File", str(script_path)],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            **hidden_subprocess_kwargs(),
        )
        if completed.returncode != 0:
            messagebox.showerror(APP_TITLE, completed.stderr.strip() or completed.stdout.strip() or "Could not refresh the desktop shortcut.")
            return
        messagebox.showinfo(APP_TITLE, "The desktop shortcut was refreshed.")

    def clear_form(self) -> None:
        self.title_var.set("")
        self.output_var.set("")
        self.images_var.set(3)
        self.theme_var.set(THEME_CLASSIC)
        self.crop_mode_var.set(CROP_MODE_DEFAULT)
        self.markup_style_var.set(MARKUP_STYLE_NONE)
        self.teaching_points_var.set(False)
        self.auto_open_var.set(True)
        self.clinical_history_var.set(True)
        self.ollama_assist_var.set(True)
        self.status_var.set("Ready")
        self._populate_request_rows([{"mode": REQUEST_MODE_SPECIFIC}])

    def on_close(self) -> None:
        self._save_state()
        self.destroy()


def main() -> None:
    app = DeckBuilderApp()
    app.mainloop()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(APP_TITLE, traceback.format_exc())
        raise
