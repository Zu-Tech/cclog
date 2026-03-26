"""Compute analytics from conversation summaries."""

from collections import defaultdict
from datetime import datetime

# Cost per million tokens (input/output) by model
# https://docs.anthropic.com/en/docs/about-claude/pricing (March 2026)
# Cache reads cost 0.1x input price — most Claude Code tokens are cache reads
MODEL_COSTS = {
    "opus-4.6": {"input": 5.0, "cache_read": 0.50, "output": 25.0},
    "opus-4.5": {"input": 5.0, "cache_read": 0.50, "output": 25.0},
    "opus-4.1": {"input": 15.0, "cache_read": 1.50, "output": 75.0},
    "opus-4":   {"input": 15.0, "cache_read": 1.50, "output": 75.0},
    "sonnet":   {"input": 3.0, "cache_read": 0.30, "output": 15.0},
    "haiku-4.5": {"input": 1.0, "cache_read": 0.10, "output": 5.0},
    "haiku-3.5": {"input": 0.80, "cache_read": 0.08, "output": 4.0},
    "haiku-3":  {"input": 0.25, "cache_read": 0.03, "output": 1.25},
}

SKIP_MODELS = {"<synthetic>", "synthetic", "", None}


def get_model_cost(model_name: str) -> dict:
    """Get cost per million tokens for a model."""
    if not model_name:
        return MODEL_COSTS["sonnet"]
    name = model_name.lower()
    # Match specific opus versions
    if "opus" in name:
        if "4.6" in name or "4-6" in name:
            return MODEL_COSTS["opus-4.6"]
        if "4.5" in name or "4-5" in name:
            return MODEL_COSTS["opus-4.5"]
        if "4.1" in name or "4-1" in name:
            return MODEL_COSTS["opus-4.1"]
        if "4" in name:
            return MODEL_COSTS["opus-4"]
        return MODEL_COSTS["opus-4.6"]  # default opus
    if "haiku" in name:
        if "4.5" in name or "4-5" in name:
            return MODEL_COSTS["haiku-4.5"]
        if "3.5" in name or "3-5" in name:
            return MODEL_COSTS["haiku-3.5"]
        return MODEL_COSTS["haiku-4.5"]
    return MODEL_COSTS["sonnet"]


def compute_cost(model_name: str, input_tokens: int, output_tokens: int, cache_read_tokens: int = 0) -> float:
    """Compute estimated cost in USD. Separates cache reads (much cheaper)."""
    costs = get_model_cost(model_name)
    # input_tokens here already includes cache_read — subtract it out
    base_input = max(0, input_tokens - cache_read_tokens)
    return (
        (base_input / 1_000_000 * costs["input"])
        + (cache_read_tokens / 1_000_000 * costs.get("cache_read", costs["input"] * 0.1))
        + (output_tokens / 1_000_000 * costs["output"])
    )


def compute_overview(summaries: list[dict]) -> dict:
    total_sessions = len(summaries)
    projects: dict[str, dict] = {}
    models: dict[str, dict] = {}
    daily: dict[str, dict] = {}
    hourly_heatmap: dict[str, int] = {}  # "dow-hour" -> count
    total_input = 0
    total_output = 0
    total_messages = 0
    total_cost = 0.0

    for s in summaries:
        inp = s.get("total_input_tokens", 0)
        out = s.get("total_output_tokens", 0)
        cache_read = s.get("total_cache_read_tokens", 0)
        total_input += inp
        total_output += out
        total_messages += s.get("message_count", 0)
        tokens = inp + out

        # Cost estimation — use first model in list
        s_models = [m for m in s.get("models_used", []) if m not in SKIP_MODELS]
        primary_model = s_models[0] if s_models else "sonnet"
        session_cost = compute_cost(primary_model, inp, out, cache_read)
        total_cost += session_cost

        # Projects
        pp = s.get("project_path", "")
        if pp not in projects:
            projects[pp] = {"session_count": 0, "total_tokens": 0, "cost": 0.0, "last_activity": None}
        projects[pp]["session_count"] += 1
        projects[pp]["total_tokens"] += tokens
        projects[pp]["cost"] += session_cost
        la = s.get("last_activity")
        if la and (projects[pp]["last_activity"] is None or la > projects[pp]["last_activity"]):
            projects[pp]["last_activity"] = la

        # Models (skip synthetic)
        for model in s_models:
            if model not in models:
                models[model] = {"session_count": 0, "total_tokens": 0, "cost": 0.0}
            models[model]["session_count"] += 1
            models[model]["total_tokens"] += tokens
            models[model]["cost"] += session_cost

        # Daily + hourly heatmap
        sa = s.get("started_at")
        if sa:
            try:
                dt = datetime.fromisoformat(sa.replace("Z", "+00:00"))
                date = sa[:10]
                if date not in daily:
                    daily[date] = {"date": date, "session_count": 0, "message_count": 0, "tokens": 0, "cost": 0.0}
                daily[date]["session_count"] += 1
                daily[date]["message_count"] += s.get("message_count", 0)
                daily[date]["tokens"] += tokens
                daily[date]["cost"] += session_cost

                # Heatmap: day of week (0=Mon) x hour
                dow = dt.weekday()  # 0=Monday
                hour = dt.hour
                key = f"{dow}-{hour}"
                hourly_heatmap[key] = hourly_heatmap.get(key, 0) + s.get("message_count", 0)
            except (IndexError, TypeError, ValueError):
                pass

    top_projects = sorted(
        [{"project": k, **v} for k, v in projects.items()],
        key=lambda x: x["total_tokens"],
        reverse=True,
    )

    models_used = sorted(
        [{"model": k, **v} for k, v in models.items()],
        key=lambda x: x["total_tokens"],
        reverse=True,
    )

    daily_activity = sorted(daily.values(), key=lambda x: x["date"])

    # Build full 7x24 heatmap grid
    heatmap = []
    for dow in range(7):
        row = []
        for hour in range(24):
            row.append(hourly_heatmap.get(f"{dow}-{hour}", 0))
        heatmap.append(row)

    return {
        "total_sessions": total_sessions,
        "total_projects": len(projects),
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_messages": total_messages,
        "total_cost": round(total_cost, 2),
        "models_used": models_used,
        "top_projects": top_projects,
        "daily_activity": daily_activity,
        "heatmap": heatmap,  # 7 rows (Mon-Sun) x 24 cols (hours)
    }
