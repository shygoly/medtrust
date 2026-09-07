"""AMR synthetic generator library."""

from .composition import composition_frame, sample_organism
from .priors import ResistancePrior, load_q4_presets, PANELS
from .mic import BreakpointTable, MicEngine
from .hospital_profile import PROFILES
from .episode import AmrEpisodeGenerator, GeneratorConfig
from .emit import write_hospital_bundle, write_manifest
from .validate import run_all_gates

__all__ = [
    "composition_frame",
    "sample_organism",
    "ResistancePrior",
    "load_q4_presets",
    "PANELS",
    "BreakpointTable",
    "MicEngine",
    "PROFILES",
    "AmrEpisodeGenerator",
    "GeneratorConfig",
    "write_hospital_bundle",
    "write_manifest",
    "run_all_gates",
]
