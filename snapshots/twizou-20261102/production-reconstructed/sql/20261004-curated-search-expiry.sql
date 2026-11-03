-- Additive audit field only; does not modify posts or call the X API.
ALTER TABLE public.authors
  ADD COLUMN IF NOT EXISTS curated_search_expiry jsonb;
NOTIFY pgrst, 'reload schema';
