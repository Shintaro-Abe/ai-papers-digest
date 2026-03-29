"""Shared constants for AI Papers Digest."""

TARGET_CATEGORIES = ["cs.AI", "cs.CL", "cs.CV", "cs.LG", "stat.ML"]

ARXIV_API_BASE = "https://export.arxiv.org/api/query"
ARXIV_RATE_LIMIT_SECONDS = 3
ARXIV_MAX_RESULTS_PER_CATEGORY = 50

HF_API_BASE = "https://huggingface.co/api"

S2_API_BASE = "https://api.semanticscholar.org/graph/v1"
S2_BATCH_FIELDS = "citationCount,tldr,externalIds"

DEFAULT_TOP_N = 7

INITIAL_SCORING_WEIGHTS = {"w1": 0.4, "w2": 0.2, "w3": 0.2, "w4": 0.2}
