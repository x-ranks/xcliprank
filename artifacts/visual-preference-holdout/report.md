# Visual preference holdout evaluation

- Frozen model only: no refit, fine-tuning, or threshold search.
- Batch 3 labels were used only for this final evaluation.
- Usable: 49 / 49 (100.0%)
- Class distribution: {'ideal': 1, 'not_ideal': 48}

## Fixed thresholds
- Default 0.5: {'threshold': 0.5, 'accuracy': 0.9183673469387755, 'precision': 0.2, 'recall': 1.0, 'f1': 0.33333333333333337, 'specificity': 0.9166666666666666, 'false_positive_rate': 0.08333333333333333, 'balanced_accuracy': 0.9583333333333333, 'confusion_matrix': [[44, 4], [0, 1]], 'predicted_ideal_count': 5}
- Locked high-precision: {'threshold': 0.737365260354716, 'accuracy': 1.0, 'precision': 1.0, 'recall': 1.0, 'f1': 1.0, 'specificity': 1.0, 'false_positive_rate': 0.0, 'balanced_accuracy': 1.0, 'confusion_matrix': [[48, 0], [0, 1]], 'predicted_ideal_count': 1}
- Majority / all-not-ideal baseline: {'threshold': 0.5, 'accuracy': 0.9795918367346939, 'precision': 0.0, 'recall': 0.0, 'f1': 0.0, 'specificity': 1.0, 'false_positive_rate': 0.0, 'balanced_accuracy': 0.5, 'confusion_matrix': [[48, 0], [1, 0]], 'predicted_ideal_count': 0}

## Continuous scores
- ROC-AUC: 1.0
- PR-AUC: 1.0
- Warning: there is only one positive label; these continuous metrics are highly unstable.

## Only ideal post
- {'postId': 2404, 'probability_ideal': 0.7944548132637261, 'rank_among_49': 1, 'detected_default': True, 'detected_locked': True}

## Conclusion
- One positive holdout example cannot establish recall or generalization.
- This evaluation is primarily evidence about false-positive resistance; do not tune thresholds from it.
- This is not an age, safety, or compliance classifier.

## Integrity
- Training artifact hashes unchanged: True
- Model predict_proba verified: True
