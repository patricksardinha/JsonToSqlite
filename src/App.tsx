import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import MainLayout from './layouts/MainLayout';
import Home from './pages/Home';
import ImportPage from './pages/ImportPage';
import UpdatePage from './pages/UpdatePage';
import './App.css';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Home />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="update" element={<UpdatePage />} />
          </Route>
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export default App;