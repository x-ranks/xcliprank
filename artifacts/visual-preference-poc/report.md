# Visual preference PoC report

- Status: completed
- Candidate unique images: 147
- Usable images: 147 (100.0%)
- Class distribution: {'ideal': 71, 'not_ideal': 76}

## Encoder and classifier
- Fixed OpenCLIP ViT-B-32 (laion2b_s34b_b79k); L2-normalized embeddings; Logistic Regression with balanced classes.
- No encoder fine-tuning. Images were memory-only and are not in artifacts.

## Leakage controls
- TWIVIDEO deduplicated by mediaId; site deduplicated by previewImageUrl.
- Primary score is site-only author-group OOF. Held-out authors are excluded from each fold; TWIVIDEO references are training-only.

## Site-only OOF metrics

{'accuracy': 0.8571428571428571, 'precision': 0.625, 'recall': 0.9090909090909091, 'f1': 0.7407407407407407, 'balanced_accuracy': 0.8755980861244019, 'roc_auc': 0.9234449760765551, 'pr_auc': 0.8210889414936464, 'confusion_matrix': [[64, 12], [2, 20]]}
- Majority baseline: {'accuracy': 0.7755102040816326, 'precision': 0.0, 'recall': 0.0, 'f1': 0.0, 'balanced_accuracy': 0.5, 'roc_auc': 0.5, 'pr_auc': 0.22448979591836735, 'confusion_matrix': [[76, 0], [22, 0]]}
- Author leakage check: {'leakage_count': 0, 'passed': True}
- Recommended threshold: {'threshold': 0.737365260354716, 'precision': 1.0, 'recall': 0.2727272727272727, 'predicted_ideal_count': 6}
- Misclassification: {'total': 14, 'by_source': {'site': 14}, 'by_label_tier': {'C': 2, 'B': 1, 'A': 1, 'X': 8, 'D': 2}, 'by_existing_adult_tier': {'A': 3, 'C': 3, 'B': 3, 'S': 4, 'D': 1}}
- Embedding reuse: {'baseline_98_reused_for_expansion': 98, 'batch2_candidates': 49, 'cache_hits_this_run': 147, 'newly_embedded_this_run': 0}

## Comparison with previous 98-image model
- Previous 98: {'primary_oof': {'accuracy': 0.7551020408163265, 'precision': 0.47058823529411764, 'recall': 0.7272727272727273, 'f1': 0.5714285714285714, 'balanced_accuracy': 0.7452153110047848, 'roc_auc': 0.8516746411483254, 'pr_auc': 0.5984179545994641, 'confusion_matrix': [[29, 9], [3, 8]]}, 'majority_baseline': {'accuracy': 0.7755102040816326, 'precision': 0.0, 'recall': 0.0, 'f1': 0.0, 'balanced_accuracy': 0.5, 'roc_auc': 0.5, 'pr_auc': 0.22448979591836735, 'confusion_matrix': [[38, 0], [11, 0]]}, 'threshold_status': 'no_threshold_meets_target'}
- Current 147: {'primary_oof': {'accuracy': 0.8571428571428571, 'precision': 0.625, 'recall': 0.9090909090909091, 'f1': 0.7407407407407407, 'balanced_accuracy': 0.8755980861244019, 'roc_auc': 0.9234449760765551, 'pr_auc': 0.8210889414936464, 'confusion_matrix': [[64, 12], [2, 20]]}, 'majority_baseline': {'accuracy': 0.7755102040816326, 'precision': 0.0, 'recall': 0.0, 'f1': 0.0, 'balanced_accuracy': 0.5, 'roc_auc': 0.5, 'pr_auc': 0.22448979591836735, 'confusion_matrix': [[76, 0], [22, 0]]}, 'threshold_status': 'threshold_meets_target'}

## Decision
- Additional data required. This PoC is not an age, safety, or compliance classifier.
- Next: collect more balanced, independently authored site labels and validate on a future held-out set.

## Generated files
- metrics.json: 4992 bytes
- report.md: 3174 bytes
- embeddings.npz: 284161 bytes
- model.joblib: 5105 bytes
- predictions.csv: 15130 bytes
