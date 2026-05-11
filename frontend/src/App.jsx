import { AuthProvider } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import { ParcelProvider } from "./context/ParcelContext";
import { ThemeProvider } from "./context/ThemeContext";
import AppRoutes from "./routes/AppRoutes";

function AppProviders({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <NotificationProvider>
          <ParcelProvider>{children}</ParcelProvider>
        </NotificationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
