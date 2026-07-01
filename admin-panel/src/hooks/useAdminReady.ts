import { useEffect, useState } from 'react';
import {
  getAdminReadyState,
  initializeAdminClient,
  subscribeAdminReady,
  type AdminReadyState,
} from '../services/adminClient';
import { isAuthenticated } from '../services/auth';

export function useAdminReady() {
  const [ready, setReady] = useState<AdminReadyState>(() => getAdminReadyState());

  useEffect(() => {
    if (!isAuthenticated()) return;

    const sync = () => setReady(getAdminReadyState());
    const unsubscribe = subscribeAdminReady(sync);

    void initializeAdminClient().catch(() => {
      sync();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return ready;
}
