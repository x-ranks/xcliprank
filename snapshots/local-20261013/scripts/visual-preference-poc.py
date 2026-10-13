"""Read-only thumbnail visual-preference PoC. No image bodies are written."""
from __future__ import annotations
import argparse, csv, json, re, sys
from collections import Counter
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import joblib, numpy as np, open_clip, requests, torch
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, balanced_accuracy_score, roc_auc_score, average_precision_score, confusion_matrix
from sklearn.model_selection import StratifiedGroupKFold, GroupKFold

ROOT=Path(__file__).resolve().parents[1]
LABEL={"ideal":1,"not_ideal":0}

def args():
 p=argparse.ArgumentParser()
 p.add_argument("--visual-json",type=Path,default=Path(r"C:\Users\USER\Desktop\visual-reference-review.json"))
 p.add_argument("--site-json",type=Path,default=Path(r"C:\Users\USER\Documents\site-visual-preference-review.json"))
 p.add_argument("--site-batch2-json",type=Path,default=Path(r"C:\Users\USER\Documents\site-visual-preference-review-batch2.json"))
 p.add_argument("--audit",type=Path,default=ROOT/"twivideo-s-tier-audit.md")
 p.add_argument("--artifacts",type=Path,default=ROOT/"artifacts"/"visual-preference-poc")
 p.add_argument("--reuse-artifacts",action="store_true",help="recalculate threshold/report from existing predictions")
 return p.parse_args()

def load(path): return json.loads(path.read_text(encoding="utf-8"))
def thumbs(path):
 out={}
 for line in path.read_text(encoding="utf-8").splitlines():
  m=re.match(r"^\|\s*\d+\s*\|[^|]+\|\s*(\d+)\s*\|\s*(https://[^|]+)",line)
  if m: out.setdefault(m.group(1),m.group(2).strip())
 return out
def records(visual,site,site_batch2,mapping):
 out=[]; seen=set()
 for r in visual:
  key=str(r.get("mediaId") or ""); pref=r.get("preference")
  if key and pref in LABEL and key not in seen:
   seen.add(key); out.append(dict(source="twivideo",key=key,url=mapping.get(key),label=LABEL[pref],preference=pref,tier=r.get("tier"),author="twivideo:"+key,public_id=r.get("itemId"),adult=None))
 seen=set()
 for batch,items in (("batch1",site),("batch2",site_batch2)):
  for r in items:
   key=str(r.get("previewImageUrl") or ""); pref=r.get("preference")
   if key and pref in LABEL and key not in seen:
    seen.add(key); out.append(dict(source="site",batch=batch,key=key,url=key,label=LABEL[pref],preference=pref,tier=r.get("tier"),author=str(r.get("authorUsername") or "post:"+str(r.get("postId"))),public_id=r.get("postId"),adult=r.get("existingAdultTier")))
 return out
def image(session,url):
 r=session.get(url,timeout=(10,25),stream=True,headers={"User-Agent":"visual-preference-poc/1.0"});r.raise_for_status()
 if not r.headers.get("content-type","").startswith("image/"): raise ValueError("not_image")
 b=r.raw.read(10485761)
 if len(b)>10485760: raise ValueError("too_large")
 with Image.open(BytesIO(b)) as x:return x.convert("RGB").copy()
def embed(rows):
 model,_,prep=open_clip.create_model_and_transforms("ViT-B-32",pretrained="laion2b_s34b_b79k",device="cpu");model.eval()
 ses=requests.Session();ok=[];bad=[];batch=[];emb=[]
 def flush():
  if batch:
   with torch.no_grad(): z=model.encode_image(torch.stack(batch)).float().cpu().numpy()
   z/=np.maximum(np.linalg.norm(z,axis=1,keepdims=True),1e-12);emb.extend(z);batch.clear()
 for r in rows:
  try:
   if not r["url"]: raise ValueError("thumbnail_url_missing")
   batch.append(prep(image(ses,r["url"])));ok.append(r)
   if len(batch)==8:flush()
  except Exception as e: bad.append({"source":r["source"],"key":r["key"],"reason":type(e).__name__})
 flush();return np.asarray(emb,dtype=np.float32),ok,bad
def reuse_embeddings(rows,path):
 if not path.exists(): return embed(rows),0
 cached=np.load(path,allow_pickle=False)
 keys=list(zip(cached["source"].astype(str),cached["key"].astype(str)))
 old=dict(zip(keys,cached["embeddings"]))
 reused=[r for r in rows if (r["source"],r["key"]) in old]
 missing=[r for r in rows if (r["source"],r["key"]) not in old]
 fresh,fresh_rows,bad=embed(missing) if missing else (np.empty((0,cached["embeddings"].shape[1]),dtype=np.float32),[],[])
 fresh_map={(r["source"],r["key"]):v for r,v in zip(fresh_rows,fresh)}
 ok=[r for r in rows if (r["source"],r["key"]) in old or (r["source"],r["key"]) in fresh_map]
 z=np.asarray([old.get((r["source"],r["key"]),fresh_map.get((r["source"],r["key"]))) for r in ok],dtype=np.float32)
 return (z,ok,bad),len(reused)
def scores(y,p):
 q=(p>=.5).astype(int)
 return {"accuracy":float(accuracy_score(y,q)),"precision":float(precision_score(y,q,zero_division=0)),"recall":float(recall_score(y,q,zero_division=0)),"f1":float(f1_score(y,q,zero_division=0)),"balanced_accuracy":float(balanced_accuracy_score(y,q)),"roc_auc":float(roc_auc_score(y,p)) if len(set(y))==2 else None,"pr_auc":float(average_precision_score(y,p)) if len(set(y))==2 else None,"confusion_matrix":confusion_matrix(y,q,labels=[0,1]).tolist()}
def threshold_analysis(y,p):
 candidates=[]
 for t in sorted(set(p)):
  mask=p>=t
  if mask.sum()>=3:candidates.append((float(t),float(precision_score(y,mask,zero_division=0)),float(recall_score(y,mask,zero_division=0)),int(mask.sum())))
 good=[x for x in candidates if x[1]>=.9]
 recommended=max(good,default=None,key=lambda x:(x[2],x[1]))
 best=max(candidates,default=None,key=lambda x:(x[1],x[2]))
 pack=lambda x: None if not x else {"threshold":x[0],"precision":x[1],"recall":x[2],"predicted_ideal_count":x[3]}
 return {"target_precision":0.90,"status":"threshold_meets_target" if recommended else "no_threshold_meets_target","recommended_threshold":pack(recommended),"best_available_threshold":None if not best else best[0],"best_available_precision":None if not best else best[1],"best_available_recall":None if not best else best[2],"best_available_predicted_ideal_count":None if not best else best[3],"warning":"同じOOF予測から算出した探索的結果であり本番閾値ではない"}
def evaluate(z,rows):
 si=np.array([i for i,r in enumerate(rows) if r["source"]=="site"]);ti=np.array([i for i,r in enumerate(rows) if r["source"]=="twivideo"])
 y=np.array([rows[i]["label"] for i in si]);g=np.array([rows[i]["author"] for i in si])
 ng=min(5,len(set(g)),min(len(set(g[y==v])) for v in (0,1)))
 splitter=StratifiedGroupKFold(n_splits=ng,shuffle=True,random_state=42) if ng>=2 else GroupKFold(n_splits=2)
 name="StratifiedGroupKFold" if ng>=2 else "GroupKFold";p=np.full(len(si),np.nan);fold=np.full(len(si),-1)
 leakage_free=True
 for n,(tr,te) in enumerate(splitter.split(si,y,g)):
  leakage_free=leakage_free and not bool(set(g[tr]) & set(g[te]))
  train=np.concatenate((ti,si[tr]));m=LogisticRegression(class_weight="balanced",max_iter=2000,random_state=42).fit(z[train],[rows[i]["label"] for i in train])
  p[te]=m.predict_proba(z[si[te]])[:,1];fold[te]=n
 final=LogisticRegression(class_weight="balanced",max_iter=2000,random_state=42).fit(z,[r["label"] for r in rows])
 base=np.full(len(y),int(np.bincount(y).argmax()))
 pred=[]
 for j,i in enumerate(si): pred.append(dict(source="site",batch=rows[i].get("batch","batch1"),public_id=rows[i]["public_id"],key=rows[i]["key"],actual=rows[i]["preference"],predicted="ideal" if p[j]>=.5 else "not_ideal",probability_ideal=float(p[j]),fold=int(fold[j]),tier=rows[i]["tier"],existing_adult_tier=rows[i]["adult"],correct=bool((p[j]>=.5)==bool(y[j]))))
 ta=threshold_analysis(y,p)
 return {"splitter":name,"n_splits":int(ng),"author_leakage_check":{"leakage_count":0 if leakage_free else 1,"passed":leakage_free},"primary_oof":scores(y,p),"majority_baseline":scores(y,base),"recommended_threshold":ta["recommended_threshold"],"threshold_analysis":ta},pred,final
def main():
 a=args();a.artifacts.mkdir(parents=True,exist_ok=True);out=a.artifacts;mp=out/"metrics.json";rp=out/"report.md"
 if a.reuse_artifacts:
  metrics=json.loads(mp.read_text(encoding="utf-8"));pred=list(csv.DictReader((out/"predictions.csv").open(encoding="utf-8")))
  y=np.array([LABEL[x["actual"]] for x in pred]);p=np.array([float(x["probability_ideal"]) for x in pred]);ta=threshold_analysis(y,p);metrics["evaluation"]["recommended_threshold"]=ta["recommended_threshold"];metrics["evaluation"]["threshold_analysis"]=ta
  mp.write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding="utf-8");report(rp,metrics,[mp,rp,out/"embeddings.npz",out/"model.joblib",out/"predictions.csv"]);return 0
 previous=json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else None
 rows=records(load(a.visual_json),load(a.site_json),load(a.site_batch2_json),thumbs(a.audit));(z,ok,bad),reused=reuse_embeddings(rows,out/"embeddings.npz")
 usable=Counter(r["preference"] for r in ok);expected={"candidate_unique_images":147,"class_distribution":{"ideal":71,"not_ideal":76}};actual={"candidate_unique_images":len(rows),"class_distribution":dict(Counter(r["preference"] for r in rows))}
 old_indices=[i for i,r in enumerate(ok) if r.get("batch")!="batch2"]
 metrics={"created_at":datetime.now(timezone.utc).isoformat(),"candidate_unique_images":len(rows),"deduplication":{"class_distribution":dict(Counter(r["preference"] for r in rows)),"expected":expected,"matches_expected":actual==expected},"embedding_reuse":{"baseline_98_reused_for_expansion":len(old_indices),"batch2_candidates":len(rows)-len(old_indices),"cache_hits_this_run":reused,"newly_embedded_this_run":len(ok)-reused},"usable":{"count":len(ok),"rate":len(ok)/len(rows),"classes":dict(usable)},"failures":{"count":len(bad),"by_source":dict(Counter(x["source"] for x in bad)),"records":bad},"encoder":{"name":"OpenCLIP ViT-B-32","pretrained":"laion2b_s34b_b79k","fine_tuned":False},"image_storage":"No image bodies stored."}
 out=a.artifacts;mp=out/"metrics.json";rp=out/"report.md"
 if len(ok)<.8*len(rows):
  metrics["status"]="aborted_insufficient_usable_images";mp.write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding="utf-8");report(rp,metrics,[mp,rp]);report(rp,metrics,[mp,rp]);return 2
 ev,pred,model=evaluate(z,ok);metrics["status"]="completed";metrics["evaluation"]=ev
 wrong=[x for x in pred if not x["correct"]];metrics["misclassification"]={"total":len(wrong),"by_source":dict(Counter(x["source"] for x in wrong)),"by_label_tier":dict(Counter(str(x["tier"] or "none") for x in wrong)),"by_existing_adult_tier":dict(Counter(str(x["existing_adult_tier"] or "none") for x in wrong))}
 old_rows=[ok[i] for i in old_indices];old_ev,_,_=evaluate(z[old_indices],old_rows)
 metrics["comparison_to_previous_98"]={"previous_98":{"primary_oof":old_ev["primary_oof"],"majority_baseline":old_ev["majority_baseline"],"threshold_status":old_ev["threshold_analysis"]["status"]},"current_147":{"primary_oof":ev["primary_oof"],"majority_baseline":ev["majority_baseline"],"threshold_status":ev["threshold_analysis"]["status"]}}
 np.savez_compressed(out/"embeddings.npz",embeddings=z,source=np.array([r["source"] for r in ok]),key=np.array([r["key"] for r in ok]),label=np.array([r["label"] for r in ok]))
 joblib.dump({"classifier":model,"encoder":metrics["encoder"],"embedding_dimension":int(z.shape[1])},out/"model.joblib");loaded=joblib.load(out/"model.joblib");loaded["classifier"].predict_proba(z[:1])
 with (out/"predictions.csv").open("w",newline="",encoding="utf-8") as h:
  w=csv.DictWriter(h,fieldnames=list(pred[0]));w.writeheader();w.writerows(pred)
 mp.write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding="utf-8");files=[mp,rp,out/"embeddings.npz",out/"model.joblib",out/"predictions.csv"];report(rp,metrics,files);report(rp,metrics,files);return 0
def report(path,m,files):
 u=m["usable"];lines=["# Visual preference PoC report","","- Status: "+m["status"],"- Candidate unique images: "+str(m["candidate_unique_images"]),"- Usable images: "+str(u["count"])+" ("+format(u["rate"],".1%")+")","- Class distribution: "+str(u["classes"]),"","## Encoder and classifier","- Fixed OpenCLIP ViT-B-32 (laion2b_s34b_b79k); L2-normalized embeddings; Logistic Regression with balanced classes.","- No encoder fine-tuning. Images were memory-only and are not in artifacts.","","## Leakage controls","- TWIVIDEO deduplicated by mediaId; site deduplicated by previewImageUrl.","- Primary score is site-only author-group OOF. Held-out authors are excluded from each fold; TWIVIDEO references are training-only."]
 if m["status"]=="completed":
  e=m["evaluation"];ta=e["threshold_analysis"];threshold_text=("90% precisionを満たす推奨閾値なし。best_availableは探索的な参考値であり推奨値ではない: "+str(ta) if ta["status"]=="no_threshold_meets_target" else "Recommended threshold: "+str(ta["recommended_threshold"]));lines+=["","## Site-only OOF metrics","",str(e["primary_oof"]),"- Majority baseline: "+str(e["majority_baseline"]),"- Author leakage check: "+str(e["author_leakage_check"]),"- "+threshold_text,"- Misclassification: "+str(m["misclassification"]),"- Embedding reuse: "+str(m.get("embedding_reuse",{}))]
  if "comparison_to_previous_98" in m: lines += ["","## Comparison with previous 98-image model","- Previous 98: "+str(m["comparison_to_previous_98"]["previous_98"]),"- Current 147: "+str(m["comparison_to_previous_98"]["current_147"])]
  lines += ["","## Decision","- Additional data required. This PoC is not an age, safety, or compliance classifier.","- Next: collect more balanced, independently authored site labels and validate on a future held-out set."]
 else:lines+=["","## Decision","- Additional data required: usable images were below 80%; training skipped.","- Failures: "+str(m["failures"])]
 lines+=["","## Generated files"]+[f"- {x.name}: {x.stat().st_size if x.exists() else 0} bytes" for x in files];path.write_text(chr(10).join(lines)+chr(10),encoding="utf-8")
if __name__=="__main__":sys.exit(main())
