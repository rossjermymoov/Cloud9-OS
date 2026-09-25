import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const BrandingContext = createContext(null);
const API = '/api';

const DEFAULT_BRANDING = {
  appName: 'Cloud9 OS',
  companyName: 'Cloud9 Fulfillment',
  logoUrl: '',
  primaryColor: '#0056FB',
};

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);

  const refreshBranding = useCallback(async () => {
    try {
      const res = await fetch(`${API}/settings/branding`);
      if (res.ok) {
        const data = await res.json();
        const next = {
          appName: data.app_name || DEFAULT_BRANDING.appName,
          companyName: data.company_name || DEFAULT_BRANDING.companyName,
          logoUrl: data.logo_url || '',
          primaryColor: data.primary_color || DEFAULT_BRANDING.primaryColor,
        };
        setBranding(next);

        // Update document title dynamically
        if (next.appName && typeof document !== 'undefined') {
          document.title = next.appName;
        }
      }
    } catch {
      /* Keep fallback defaults */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBranding();
  }, [refreshBranding]);

  return (
    <BrandingContext.Provider value={{ ...branding, refreshBranding, loading }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    return DEFAULT_BRANDING;
  }
  return ctx;
}
