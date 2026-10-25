import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Researcher } from './screens/Researcher';
import './styles.css';

const page = location.pathname.startsWith('/researcher') ? <Researcher /> : <App />;
createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
