import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// RTC/RTM login is an external side effect; React dev StrictMode would run it twice.
createRoot(document.getElementById('root')!).render(<App />);
