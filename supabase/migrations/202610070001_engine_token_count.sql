CREATE TABLE IF NOT EXISTS public.dream_token_count_limits (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 window_start timestamptz NOT NULL,
 requests integer NOT NULL
);
ALTER TABLE public.dream_token_count_limits ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.dream_allow_token_count(p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE count_now integer;
BEGIN
 INSERT INTO dream_token_count_limits(user_id,window_start,requests)
 VALUES(p_user,date_trunc('minute',clock_timestamp()),1)
 ON CONFLICT(user_id) DO UPDATE SET
 requests=CASE WHEN dream_token_count_limits.window_start<date_trunc('minute',clock_timestamp()) THEN 1 ELSE dream_token_count_limits.requests+1 END,
 window_start=date_trunc('minute',clock_timestamp())
 RETURNING requests INTO count_now;
 RETURN count_now<=30;
END $$;
REVOKE ALL ON FUNCTION public.dream_allow_token_count(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dream_allow_token_count(uuid) TO service_role;
