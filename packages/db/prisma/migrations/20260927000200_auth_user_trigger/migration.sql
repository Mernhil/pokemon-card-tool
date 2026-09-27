-- Creates the public."User" row automatically when Supabase Auth creates a
-- new auth.users row (email/password or OAuth), instead of relying on the
-- app to do it on first request. Runs as SECURITY DEFINER because the app's
-- own roles have no INSERT grant on auth.users' trigger target by default,
-- but do need to end up owning a "User" row.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    base_handle TEXT := regexp_replace(split_part(NEW.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g');
    candidate   TEXT;
    attempt     INT := 0;
BEGIN
    IF base_handle IS NULL OR base_handle = '' THEN
        base_handle := 'collector';
    END IF;

    LOOP
        candidate := base_handle || CASE WHEN attempt = 0 THEN '' ELSE '-' || substr(md5(random()::text), 1, 6) END;
        BEGIN
            INSERT INTO public."User" (id, handle) VALUES (NEW.id, candidate);
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            attempt := attempt + 1;
            IF attempt > 5 THEN
                candidate := NEW.id::text;
                INSERT INTO public."User" (id, handle) VALUES (NEW.id, candidate);
                EXIT;
            END IF;
        END;
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
