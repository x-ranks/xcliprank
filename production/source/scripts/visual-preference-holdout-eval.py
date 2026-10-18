"""Evaluate a frozen visual-preference classifier on batch 3 only; never train it."""
from __future__ import annotations

import argparse, csv, hashlib, json, sys
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import joblib
import numpy as np
import open_clip
import requests
import torch
from PIL import Image
from sklearn.metrics import average_precision_score, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
LABEL = {"ideal": 1, "not_ideal": 0}


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--holdout", type=Path, default=Path(r"C:\Users\USER\Documents\site-visual-preference-review-batch3.json"))
    parser.add_argument("--model", type=Path, default=ROOT / "artifacts" / "visual-preference-poc" / "model.joblib")
    parser.add_argument("--training-metrics", type=Path, default=ROOT / "artifacts" / "visual-preference-poc" / "metrics.json")
    parser.add_argument("--training-artifacts", type=Path, default=ROOT / "artifacts" / "visual-preference-poc")
    parser.add_argument("--artifacts", type=Path, default=ROOT / "artifacts" / "visual-preference-holdout")
    return parser.parse_args()


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def artifact_hashes(directory: Path) -> dict[str, str]:
    return {path.name: digest(path) for path in sorted(directory.iterdir()) if path.is_file()}


def load_rows(path: Path) -> tuple[list[dict], dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    seen: set[str] = set()
    rows = []
    for item in raw:
        preference = item.get("preference")
        key = str(item.get("previewImageUrl") or "")
        if preference in LABEL and key and key not in seen:
            seen.add(key)
            rows.append({"post_id": item.get("postId"), "tier": item.get("tier"), "actual": preference, "label": LABEL[preference], "url": key})
    summary = {"total": len(raw), "used": len(rows), "hold_excluded": sum(item.get("preference") == "hold" for item in raw), "class_distribution": {name: sum(row["actual"] == name for row in rows) for name in LABEL}}
    return rows, summary


def fetch_image(session: requests.Session, url: str) -> Image.Image:
    response = session.get(url, timeout=(10, 25), stream=True, headers={"User-Agent": "visual-preference-holdout-eval/1.0"})
    response.raise_for_status()
    if not response.headers.get("content-type", "").startswith("image/"):
        raise ValueError("not_image")
    body = response.raw.read(10 * 1024 * 1024 + 1)
    if len(body) > 10 * 1024 * 1024:
        raise ValueError("too_large")
    with Image.open(BytesIO(body)) as image:
        return image.convert("RGB").copy()


def embed(rows: list[dict]) -> tuple[np.ndarray, list[dict], list[dict]]:
    encoder, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k", device="cpu")
    encoder.eval()
    session = requests.Session()
    vectors: list[np.ndarray] = []
    good: list[dict] = []
    failures: list[dict] = []
    batch: list[torch.Tensor] = []

    def flush() -> None:
        if not batch:
            return
        with torch.no_grad():
            values = encoder.encode_image(torch.stack(batch)).float().cpu().numpy()
        values /= np.maximum(np.linalg.norm(values, axis=1, keepdims=True), 1e-12)
        vectors.extend(values)
        batch.clear()

    for row in rows:
        try:
            batch.append(preprocess(fetch_image(session, row["url"])))
            good.append(row)
            if len(batch) == 8:
                flush()
        except Exception as error:
            failures.append({"post_id": row["post_id"], "reason": type(error).__name__})
    flush()
    return np.asarray(vectors, dtype=np.float32), good, failures


def fixed_metrics(labels: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict:
    predicted = probabilities >= threshold
    truth = labels.astype(bool)
    tp = int(np.sum(predicted & truth)); tn = int(np.sum(~predicted & ~truth))
    fp = int(np.sum(predicted & ~truth)); fn = int(np.sum(~predicted & truth))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    return {"threshold": threshold, "accuracy": (tp + tn) / len(labels), "precision": precision, "recall": recall, "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0, "specificity": specificity, "false_positive_rate": fp / (fp + tn) if fp + tn else 0.0, "balanced_accuracy": (recall + specificity) / 2, "confusion_matrix": [[tn, fp], [fn, tp]], "predicted_ideal_count": int(np.sum(predicted))}


def report(path: Path, metrics: dict) -> None:
    lines = ["# Visual preference holdout evaluation", "", "- Frozen model only: no refit, fine-tuning, or threshold search.", "- Batch 3 labels were used only for this final evaluation.", f"- Usable: {metrics['usable']['count']} / {metrics['input']['used']} ({metrics['usable']['rate']:.1%})", f"- Class distribution: {metrics['usable']['class_distribution']}", "", "## Fixed thresholds", f"- Default 0.5: {metrics['thresholds']['default_0_5']}", f"- Locked high-precision: {metrics['thresholds']['locked_high_precision']}", f"- Majority / all-not-ideal baseline: {metrics['baseline_all_not_ideal']}", "", "## Continuous scores", f"- ROC-AUC: {metrics['continuous']['roc_auc']}", f"- PR-AUC: {metrics['continuous']['pr_auc']}", "- Warning: there is only one positive label; these continuous metrics are highly unstable.", "", "## Only ideal post", f"- {metrics['only_ideal']}", "", "## Conclusion", "- One positive holdout example cannot establish recall or generalization.", "- This evaluation is primarily evidence about false-positive resistance; do not tune thresholds from it.", "- This is not an age, safety, or compliance classifier.", "", "## Integrity", f"- Training artifact hashes unchanged: {metrics['training_artifact_hashes_unchanged']}", f"- Model predict_proba verified: {metrics['model_predict_proba_verified']}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = arguments()
    before = artifact_hashes(args.training_artifacts)
    training = json.loads(args.training_metrics.read_text(encoding="utf-8"))
    locked = training["evaluation"]["recommended_threshold"]["threshold"]
    rows, input_summary = load_rows(args.holdout)
    if input_summary["used"] != 49 or input_summary["class_distribution"] != {"ideal": 1, "not_ideal": 48}:
        raise ValueError(f"unexpected holdout labels: {input_summary}")
    model_data = joblib.load(args.model)
    classifier = model_data["classifier"]
    embeddings, good, failures = embed(rows)
    labels = np.asarray([row["label"] for row in good])
    probabilities = classifier.predict_proba(embeddings)[:, 1]
    args.artifacts.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.artifacts / "embeddings.npz", embeddings=embeddings, post_id=np.asarray([row["post_id"] for row in good]), label=labels)
    default = fixed_metrics(labels, probabilities, 0.5)
    locked_metrics = fixed_metrics(labels, probabilities, float(locked))
    baseline = fixed_metrics(labels, np.zeros_like(probabilities), 0.5)
    ideal_index = int(np.flatnonzero(labels == 1)[0])
    rank = int(1 + np.sum(probabilities > probabilities[ideal_index]))
    predictions = []
    for row, probability in zip(good, probabilities):
        default_prediction = "ideal" if probability >= 0.5 else "not_ideal"
        locked_prediction = "ideal" if probability >= locked else "not_ideal"
        predictions.append({"postId": row["post_id"], "actual": row["actual"], "tier": row["tier"], "probability_ideal": float(probability), "default_prediction": default_prediction, "locked_prediction": locked_prediction, "default_correct": default_prediction == row["actual"], "locked_correct": locked_prediction == row["actual"]})
    after = artifact_hashes(args.training_artifacts)
    if before != after:
        raise RuntimeError("training artifacts changed during holdout evaluation")
    metrics = {"created_at": datetime.now(timezone.utc).isoformat(), "input": input_summary, "usable": {"count": len(good), "rate": len(good) / len(rows), "class_distribution": {name: int(np.sum(labels == value)) for name, value in LABEL.items()}}, "failures": failures, "encoder": {"name": "OpenCLIP ViT-B-32", "pretrained": "laion2b_s34b_b79k", "fine_tuned": False}, "model": {"path": str(args.model), "embedding_dimension": model_data["embedding_dimension"], "classifier_refit": False, "model_predict_proba_verified": True}, "fixed_thresholds": {"default": 0.5, "locked_high_precision_from_training": float(locked)}, "thresholds": {"default_0_5": default, "locked_high_precision": locked_metrics}, "baseline_all_not_ideal": baseline, "continuous": {"roc_auc": float(roc_auc_score(labels, probabilities)), "pr_auc": float(average_precision_score(labels, probabilities)), "warning": "One positive label makes ROC-AUC and PR-AUC highly unstable."}, "only_ideal": {"postId": good[ideal_index]["post_id"], "probability_ideal": float(probabilities[ideal_index]), "rank_among_49": rank, "detected_default": bool(probabilities[ideal_index] >= 0.5), "detected_locked": bool(probabilities[ideal_index] >= locked)}, "training_artifact_hashes_before": before, "training_artifact_hashes_after": after, "training_artifact_hashes_unchanged": True, "model_predict_proba_verified": True, "conclusion": "Holdout labels were not used to retrain, tune, select, or alter any threshold."}
    with (args.artifacts / "predictions.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(predictions[0]))
        writer.writeheader(); writer.writerows(predictions)
    (args.artifacts / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    report(args.artifacts / "report.md", metrics)
    return 0 if len(good) >= 0.8 * len(rows) and len(good) == len(rows) else 2


if __name__ == "__main__":
    sys.exit(main())
