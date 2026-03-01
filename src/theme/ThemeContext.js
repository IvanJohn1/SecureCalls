/**
 * ThemeContext — global theme state for SecureCall.
 *
 * Usage:
 *   import {useTheme} from '../theme/ThemeContext';
 *   const {colors, isDark, toggleTheme} = useTheme();
 */

import React, {createContext, useContext, useState, useEffect} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {LightColors, DarkColors} from './colors';

const THEME_STORAGE_KEY = 'app_theme';

const ThemeContext = createContext({
  isDark: false,
  colors: LightColors,
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({children}) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Load saved theme preference
    AsyncStorage.getItem(THEME_STORAGE_KEY).then(value => {
      if (value === 'dark') {
        setIsDark(true);
      }
    }).catch(() => {});
  }, []);

  const setTheme = (dark) => {
    setIsDark(dark);
    AsyncStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light').catch(() => {});
  };

  const toggleTheme = () => {
    setTheme(!isDark);
  };

  const colors = isDark ? DarkColors : LightColors;

  return (
    <ThemeContext.Provider value={{isDark, colors, setTheme, toggleTheme}}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export default ThemeContext;
