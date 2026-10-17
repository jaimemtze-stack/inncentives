import type { HostArea, MeResponse } from '@mesa/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken } from './api';

export function useArea() {
  return useQuery({
    queryKey: ['area'],
    queryFn: () => api<{ area: HostArea | null }>('GET', '/auth/area'),
    staleTime: Infinity,
  });
}

/** Current session, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<MeResponse & { csrfToken: string }>('GET', '/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw err;
      }
    },
    retry: false,
  });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['me'] });
}
