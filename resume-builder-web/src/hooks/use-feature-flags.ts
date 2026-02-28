'use client';

import { useEffect, useState } from 'react';
import { api, type FeatureFlagsResponse } from '@/src/lib/api';

const defaultFlags: FeatureFlagsResponse = {
  paymentFeatureEnabled: false,
};

let cachedFlags: FeatureFlagsResponse | null = null;

export default function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlagsResponse>(() => cachedFlags ?? defaultFlags);

  useEffect(() => {
    let cancelled = false;
    if (cachedFlags) {
      setFlags(cachedFlags);
      return;
    }
    api.getFeatureFlags()
      .then((data) => {
        cachedFlags = data;
        if (!cancelled) {
          setFlags(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFlags(defaultFlags);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return flags;
}
