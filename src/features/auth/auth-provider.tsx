import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

import { supabase } from '@/lib/supabase';

type AuthState = {
  session: Session | null;
  loading: boolean;
  /** Set when a valid account is not in the members allowlist. */
  accessError: string | null;
};

const AuthContext = createContext<AuthState>({ session: null, loading: true, accessError: null });

async function isMember(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('app_members')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return !error && data != null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true, accessError: null });

  useEffect(() => {
    let cancelled = false;

    const apply = async (session: Session | null) => {
      if (session && !(await isMember(session.user.id))) {
        await supabase.auth.signOut();
        if (!cancelled) {
          setState({ session: null, loading: false, accessError: 'Esta cuenta no tiene acceso a la app.' });
        }
        return;
      }
      if (!cancelled) setState({ session, loading: false, accessError: null });
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Token refreshes do not change membership; avoid an extra query.
      if (event === 'TOKEN_REFRESHED') {
        setState((prev) => ({ ...prev, session }));
        return;
      }
      // Defer to avoid calling Supabase inside the auth callback.
      setTimeout(() => apply(session), 0);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
