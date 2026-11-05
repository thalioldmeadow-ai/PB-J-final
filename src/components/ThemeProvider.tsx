import React, { createContext, useContext, useEffect, useState } from 'react';
import { ThemeType, FontSizeType, FontType, UserSettings } from '../types';

interface ThemeContextType {
  settings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('serene-structure-settings');
    const defaults: UserSettings = {
      theme: 'beige',
      fontSize: 'medium',
      fontType: 'standard',
      scheduleInterval: 30,
      showCycleTracking: true,
      aiEnabled: true,
      aiProvider: 'auto',
      aiAgeBand: 'adult'
    };
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.theme === 'vibrant') {
          parsed.theme = 'orange';
        }
        if (parsed.theme === 'pastel') {
          parsed.theme = 'beige';
        }
        return { ...defaults, ...parsed };
      } catch (e) {
        // ignore and fallback
      }
    }
    return defaults;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    
    // Remove all theme classes
    root.classList.remove('theme-pastel', 'theme-beige', 'theme-vibrant', 'theme-orange', 'theme-green', 'theme-blue', 'theme-pink', 'theme-dark');
    root.classList.add(`theme-${settings.theme}`);

    // Remove all font size classes
    root.classList.remove('font-size-small', 'font-size-medium', 'font-size-large');
    root.classList.add(`font-size-${settings.fontSize}`);

    // Remove all font type classes
    root.classList.remove('font-dyslexic');

    localStorage.setItem('serene-structure-settings', JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (newSettings: Partial<UserSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  return (
    <ThemeContext.Provider value={{ settings, updateSettings }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
