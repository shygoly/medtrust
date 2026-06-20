"""MedTrust Local Data Agent — federated multimodal-LoRA data plane.

Runtime selection (best available wins, all import-guarded):

1. ``secretflow`` PYU/HEU/TEEU on SGX/TEE hardware  → confidential path.
2. ``ray`` distributed actors                       → distributed PyTorch FedAvg.
3. plain ``torch`` sequential party loop            → portable real FedAvg.

Only safe, output-gated metadata ever leaves the agent.
"""

__version__ = "0.1.0"
