import React, { useState, useEffect } from 'react';
import { Dashboard } from './pages/Dashboard';
import { Widget } from './pages/Widget';

export const App: React.FC = () => {
  const [currentRoute, setCurrentRoute] = useState<'dashboard' | 'widget'>(() => {
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    const search = window.location.search.toLowerCase();
    if (path.includes('/widget') || hash.includes('#widget') || search.includes('channel=')) {
      return 'widget';
    }
    return 'dashboard';
  });

  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      const search = window.location.search.toLowerCase();
      if (path.includes('/widget') || hash.includes('#widget') || search.includes('channel=')) {
        setCurrentRoute('widget');
      } else {
        setCurrentRoute('dashboard');
      }
    };

    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);

    return () => {
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  return currentRoute === 'widget' ? <Widget /> : <Dashboard />;
};

export default App;
