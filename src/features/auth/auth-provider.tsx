import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';

import { supabase } from '@/lib/supabase';

import { classifyMemberQuery, type Member, type MemberAccess } from './member-access';

export type { Member, MemberAvatar } from './member-access';

export type AccessError = {
  kind: 'not_member' | 'error';
  message: string;
};

type AuthState = {
  session: Session | null;
  /** The signed-in user's row in the members allowlist. */
  member: Member | null;
  loading: boolean;
  /** Why a signed-in account could not enter the app. */
  accessError: AccessError | null;
};

type AuthContextValue = AuthState & {
  /** Checks membership again with the stored session (after a transient error). */
  retry: () => void;
};

const initialState: AuthState = { session: null, member: null, loading: true, accessError: null };

const AuthContext = createContext<AuthContextValue>({ ...initialState, retry: () => undefined });

async function checkMembership(userId: string): Promise<MemberAccess> {
  try {
    const result = await supabase
      .from('app_members')
      .select('display_name, avatar')
      .eq('user_id', userId)
      .maybeSingle();
    return classifyMemberQuery(result);
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>(initialState);
  const cancelled = useRef(false);

  const apply = useCallback(async (session: Session | null) => {
    if (!session) {
      if (!cancelled.current) setState((prev) => ({ ...prev, session: null, member: null, loading: false }));
      return;
    }

    const access = await checkMembership(session.user.id);
    if (cancelled.current) return;

    if (access.kind === 'member') {
      setState({ session, member: access.member, loading: false, accessError: null });
      return;
    }

    if (access.kind === 'not_member') {
      // A valid account outside the allowlist: end its session for good.
      await supabase.auth.signOut();
      setState({
        session: null,
        member: null,
        loading: false,
        accessError: { kind: 'not_member', message: 'Esta cuenta no tiene acceso a la app.' },
      });
      return;
    }

    // Transient failure (offline, server error, permissions): keep the stored
    // session so a retry or the next launch can get in without signing in again.
    setState({
      session: null,
      member: null,
      loading: false,
      accessError: { kind: 'error', message: `No se pudo verificar el acceso: ${access.message}` },
    });
  }, []);

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    supabase.auth.getSession().then(({ data }) => apply(data.session));
  }, [apply]);

  useEffect(() => {
    cancelled.current = false;
    supabase.auth.getSession().then(({ data }) => apply(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Token refreshes do not change membership; avoid an extra query.
      if (event === 'TOKEN_REFRESHED') {
        setState((prev) => ({ ...prev, session: prev.session ? session : prev.session }));
        return;
      }
      // Defer to avoid calling Supabase inside the auth callback.
      setTimeout(() => apply(session), 0);
    });

    return () => {
      cancelled.current = true;
      listener.subscription.unsubscribe();
    };
  }, [apply]);

  return <AuthContext.Provider value={{ ...state, retry }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
