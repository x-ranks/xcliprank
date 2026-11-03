import { fetchFreePostUrl, type FreeAuthor, type FreeCandidate } from "./fxtwitter-curated";
import { classifyContent } from "./content-filter";
import { requiresSafetyReview } from "./adult-score";

// Fetch only the requested public post's metadata. The caller must separately
// perform publication and removal checks before storing or displaying it.
export async function prepareManualXCandidate(url: string, options: {
  fetchPost?: typeof fetchFreePostUrl;
  signal?: AbortSignal;
} = {}): Promise<{ author: FreeAuthor; candidate: FreeCandidate }> {
  const fetchPost = options.fetchPost ?? fetchFreePostUrl;
  const result = await fetchPost(url, "A", fetch, options.signal);
  const { author, candidate } = result;
  if (requiresSafetyReview(candidate.text) || classifyContent(candidate.text).category !== "PASS") {
    throw Error("MANUAL_POST_REVIEW_REQUIRED");
  }
  if (candidate.author_id !== author.id || !candidate.video_url || !candidate.x_post_id) {
    throw Error("MANUAL_POST_IDENTITY_INVALID");
  }
  return { author, candidate };
}
