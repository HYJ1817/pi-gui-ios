import { useColorScheme } from 'react-native';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return { dark, background: dark ? '#111418' : '#F4F6FA', surface: dark ? '#20252D' : '#FFFFFF', text: dark ? '#F5F7FA' : '#172331', secondary: dark ? '#AFBAC8' : '#536274', accent: dark ? '#8CB9FF' : '#1559B6', line: dark ? '#343D49' : '#D8DFE8', decorative: dark ? '#263D5B' : '#D3E4FE' };
}
