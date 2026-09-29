import ReactDOM from 'react-dom/client';
import App from './App';
import 'flatpickr/dist/flatpickr.min.css';
import 'flatpickr/dist/themes/dark.css';
import './index.css';
import './styles.css';

// MUHIM: Router faqat App.tsx ichida bir marta o'raladi.
// Ilgari u yerda ham, bu faylda ham Router bor edi —
// react-router v6'da bittasi ichida yana bittasi bo'lishi runtime xatoga
// olib keladi ("You cannot render a <Router> inside another <Router>").
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
