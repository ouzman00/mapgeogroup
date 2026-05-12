import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import { hasManagementRole } from "../constants/roleConstants";

const LoginPage = lazy(() => import("../pages/LoginPage.jsx"));
const ForgotPasswordPage = lazy(() => import("../pages/ForgotPasswordPage.jsx"));
const ResetPasswordPage = lazy(() => import("../pages/ResetPasswordPage.jsx"));
const DashboardPage = lazy(() => import("../pages/DashboardPage.jsx"));
const ParcellesPage = lazy(() => import("../pages/ParcellesPage.jsx"));
const ParcelleDetailPage = lazy(() => import("../pages/ParcelleDetailPage.jsx"));
const ParcelleCartoPage = lazy(() => import("../pages/ParcelleCartoPage.jsx"));
const DocumentsPage = lazy(() => import("../pages/DocumentsPage.jsx"));
const DocumentDetailPage = lazy(() => import("../pages/DocumentDetailPage.jsx"));
const NotificationsPage = lazy(() => import("../pages/NotificationsPage.jsx"));
const SupportPage = lazy(() => import("../pages/SupportPage.jsx"));
const SupportTicketDetailPage = lazy(() => import("../pages/SupportTicketDetailPage.jsx"));
const SettingsPage = lazy(() => import("../pages/SettingsPage.jsx"));
const UsersSettingsPage = lazy(() => import("../pages/UsersSettingsPage.jsx"));
const ClientsPage = lazy(() => import("../pages/ClientsPage.jsx"));
const ClientDetailPage = lazy(() => import("../pages/ClientDetailPage.jsx"));
const ClientActivationPage = lazy(() => import("../pages/ClientActivationPage.jsx"));

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-mapgeo-ivory">
      <div className="rounded-3xl border border-mapgeo-line bg-white px-7 py-5 font-semibold text-mapgeo-primary shadow-soft">
        Chargement de votre espace cartographique...
      </div>
    </div>
  );
}

function PrivateRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function InternalRoute({ children }) {
  const { isAuthenticated, isInternalPortal, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return isInternalPortal ? children : <Navigate to="/client/dashboard" replace />;
}

function ClientRoute({ children }) {
  const { isAuthenticated, isClientPortal, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return isClientPortal ? children : <Navigate to="/backoffice/dashboard" replace />;
}

function ManagerRoute({ children }) {
  const { isAuthenticated, isInternalPortal, user, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isInternalPortal) return <Navigate to="/client/dashboard" replace />;

  return hasManagementRole(user)
    ? children
    : <Navigate to="/backoffice/dashboard" replace />;
}

function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return !isAuthenticated ? children : <PortalRedirect />;
}

function PortalRedirect() {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Fallback cohérent : si portal_type est absent, on se base sur le rôle
  const isClient = user?.portal_type
    ? user.portal_type === "client"
    : user?.role === "client";
  const target = isClient ? "/client/dashboard" : "/backoffice/dashboard";

  return <Navigate to={target} replace />;
}

function Page({ children }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

function LegacyParcelsRedirect() {
  const { pathname, search, hash } = useLocation();
  const nextPath = pathname.replace(/^\/parcels(?=\/|$)/, "/parcelles");

  return <Navigate to={`${nextPath}${search}${hash}`} replace />;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PortalRedirect />} />

      <Route
        path="/login"
        element={
          <PublicRoute>
            <Page>
              <LoginPage />
            </Page>
          </PublicRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            <Page>
              <ForgotPasswordPage />
            </Page>
          </PublicRoute>
        }
      />
      <Route
        path="/reset-password/:uid/:token"
        element={
          <Page>
            <ResetPasswordPage />
          </Page>
        }
      />
      <Route
        path="/activate-client/:uid/:token"
        element={
          <Page>
            <ClientActivationPage />
          </Page>
        }
      />

      <Route
        path="/client/dashboard"
        element={
          <ClientRoute>
            <Page>
              <DashboardPage />
            </Page>
          </ClientRoute>
        }
      />

      <Route
        path="/backoffice/dashboard"
        element={
          <InternalRoute>
            <Page>
              <DashboardPage />
            </Page>
          </InternalRoute>
        }
      />


      {/* Redirections legacy : anciennes URLs anglaises conservées sans casser les liens existants */}
      <Route path="/parcels" element={<LegacyParcelsRedirect />} />
      <Route path="/parcels/*" element={<LegacyParcelsRedirect />} />

      {/* Parcelles */}
      <Route
        path="/parcelles"
        element={
          <PrivateRoute>
            <Page>
              <ParcellesPage />
            </Page>
          </PrivateRoute>
        }
      />

      <Route
        path="/parcelles/carto"
        element={
          <PrivateRoute>
            <Page>
              <ParcelleCartoPage />
            </Page>
          </PrivateRoute>
        }
      />

      <Route
        path="/parcelles/:id/carto"
        element={
          <PrivateRoute>
            <Page>
              <ParcelleCartoPage />
            </Page>
          </PrivateRoute>
        }
      />

      <Route
        path="/parcelles/:id"
        element={
          <PrivateRoute>
            <Page>
              <ParcelleDetailPage />
            </Page>
          </PrivateRoute>
        }
      />

      {/* Clients */}
      <Route
        path="/clients"
        element={
          <ManagerRoute>
            <Page>
              <ClientsPage />
            </Page>
          </ManagerRoute>
        }
      />

      <Route
        path="/clients/:id"
        element={
          <ManagerRoute>
            <Page>
              <ClientDetailPage />
            </Page>
          </ManagerRoute>
        }
      />

      {/* Documents */}
      <Route
        path="/documents"
        element={
          <PrivateRoute>
            <Page>
              <DocumentsPage />
            </Page>
          </PrivateRoute>
        }
      />

      <Route
        path="/documents/:id"
        element={
          <PrivateRoute>
            <Page>
              <DocumentDetailPage />
            </Page>
          </PrivateRoute>
        }
      />

      {/* Notifications */}
      <Route
        path="/notifications"
        element={
          <PrivateRoute>
            <Page>
              <NotificationsPage />
            </Page>
          </PrivateRoute>
        }
      />

      {/* Support */}
      <Route
        path="/support"
        element={
          <PrivateRoute>
            <Page>
              <SupportPage />
            </Page>
          </PrivateRoute>
        }
      />

      <Route
        path="/support/:id"
        element={
          <PrivateRoute>
            <Page>
              <SupportTicketDetailPage />
            </Page>
          </PrivateRoute>
        }
      />

      {/* Paramètres */}
      <Route
        path="/settings"
        element={
          <PrivateRoute>
            <Page>
              <SettingsPage />
            </Page>
          </PrivateRoute>
        }
      />

      <Route
        path="/settings/users"
        element={
          <ManagerRoute>
            <Page>
              <UsersSettingsPage />
            </Page>
          </ManagerRoute>
        }
      />

      <Route path="*" element={<PortalRedirect />} />
    </Routes>
  );
}