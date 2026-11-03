import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

import { supabase } from '@/lib/supabase';

export type MemberAvatar = 'mustache' | 'dumbbell';

export type Member = {
  displayName: string;
  avatar: MemberAvatar;
};

type AuthState = {
  session: Session | null;
  /** The signed-in user's row in the members allowlist. */
  member: Member | null;
  loading: boolean;
  /** Set when a valid account is not in the members allowlist. */
  accessError: string | null;
};

const initialState: AuthState = { session: null, member: null, loading: true, accessError: null };

const AuthContext = createContext<AuthState>(initialState);

async function fetchMember(userId: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('app_members')
    .select('display_name, avatar')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return { displayName: data.display_name, avatar: data.avatar === 'dumbbell' ? 'dumbbell' : 'mustache' };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    let cancelled = false;

    const apply = async (session: Session | null) => {
      if (!session) {
        if (!cancelled) setState((prev) => ({ ...prev, session: null, member: null, loading: false }));
        return;
      }
      const member = await fetchMember(session.user.id);
      if (!member) {
        await supabase.auth.signOut();
        if (!cancelled) {
          setState({ session: null, member: null, loading: false, accessError: 'Esta cuenta no tiene acceso a la app.' });
        }
        return;
      }
      if (!cancelled) setState({ session, member, loading: false, accessError: null });
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
