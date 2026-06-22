import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Packages from './pages/Packages';
import Settings from './pages/Settings';
import PackageDetail from './pages/PackageDetail';
import Notifications from './pages/Notifications';
import { NotificationProvider } from './contexts/NotificationContext';

export default function App() {
  return (
    <NotificationProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="packages" element={<Packages />} />
          <Route path="packages/:registry/:name" element={<PackageDetail />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </NotificationProvider>
  );
}
