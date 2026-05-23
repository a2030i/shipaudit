import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase.js';
import { can as _can, canAll as _canAll, canAny as _canAny } from './permissions.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId) => {
    try {
      const { data } = await supabase
        .from('profiles').select('*').eq('id', userId).single();
      setProfile(data ?? null);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes — only re-fetch profile on actual user change, not token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        setUser(prev => {
          if (prev?.id !== session.user.id) fetchProfile(session.user.id);
          return session.user;
        });
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password });

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  // Permission helpers. Bound to the current profile so call sites
  // don't have to thread `profile` through. `can(key)` is the most
  // common form; `canAny`/`canAll` are for page-level guards.
  const can    = useCallback((key)  => _can(profile, key),    [profile]);
  const canAny = useCallback((keys) => _canAny(profile, keys), [profile]);
  const canAll = useCallback((keys) => _canAll(profile, keys), [profile]);
  const isAdmin = profile?.role === 'admin';

  return (
    <AuthContext.Provider value={{
      user, profile, loading, signIn, signOut,
      can, canAny, canAll, isAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
