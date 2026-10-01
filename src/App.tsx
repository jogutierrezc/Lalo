import React, { useState, useEffect } from 'react';
import { Dashboard } from './pages/Dashboard';
import { Widget } from './pages/Widget';
import { Control } from './pages/Control';

export const App: React.FC = () => {
  const [currentRoute, setCurrentRoute] = useState<'dashboard' | 'widget' | 'control'>(() => {
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    const search = window.location.search.toLowerCase();
    if (path.includes('/widget') || hash.includes('#widget') || search.includes('channel=')) {
      return 'widget';
    }
    if (hash.startsWith('#control') || path.includes('/control')) {
      return 'control';
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
      } else if (hash.startsWith('#control') || path.includes('/control')) {
        setCurrentRoute('control');
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

  if (currentRoute === 'widget') return <Widget />;
  return currentRoute === 'control' ? <Control /> : <Dashboard />;
};

export default App;
