import React from 'react';import {createRoot} from 'react-dom/client';import {App} from '@renderer/App';import '@renderer/globals.css';import '@renderer/workspace.css';import '@renderer/onboarding.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
