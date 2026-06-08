import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Rules from './pages/Rules';
import History from './pages/History';
import Wallet from './pages/Wallet';
import Profile from './pages/Profile';
import Score from './pages/score';

const SCREENS = {
  home: Home,
  rules: Rules,
  scores: Score,
  history: History,
  wallet: Wallet,
  profile: Profile,
};

export default function MainApp() {
  const location = useLocation();
  const [currentScreen, setCurrentScreen] = useState('home');

  useEffect(() => {
    const tab = location.state?.tab;
    if (tab && SCREENS[tab]) {
      setCurrentScreen(tab);
    }
  }, [location.state]);

  const navigate = (screen) => {
    if (SCREENS[screen]) {
      setCurrentScreen(screen);
    }
  };

  const Screen = SCREENS[currentScreen] ?? Home;
  const screenProps = { onNavigate: navigate, activeScreen: currentScreen };

  return <Screen {...screenProps} />;
}
