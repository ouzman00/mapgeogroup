import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import notificationService from "../services/notificationService";
import { getStoredTokens } from "../services/api";

export const NotificationContext = createContext(null);

const NOTIFICATION_REFRESH_INTERVAL_MS = 30000;

function countUnread(items) {
  return items.filter((item) => !item.is_read).length;
}

function isAuthenticationError(error) {
  const status = error?.response?.status;
  if (status === 401) return true;
  if (status !== 403) return false;
  const detail = String(error?.response?.data?.detail || "").toLowerCase();
  return detail.includes("authentification")
    || detail.includes("authentication")
    || detail.includes("credentials")
    || detail.includes("identifiants")
    || detail.includes("token");
}

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);

  const fetchNotifications = useCallback(async ({ silent = false } = {}) => {
    const stored = getStoredTokens();
    if (!stored?.access) {
      setNotifications([]);
      setUnreadTotal(0);
      setLoaded(false);
      return [];
    }

    if (!silent) setLoading(true);
    try {
      const payload = await notificationService.getNotifications({ pageSize: 200 });
      const results = Array.isArray(payload.results) ? payload.results : [];
      setNotifications(results);
      setUnreadTotal(Number(payload.unread_count ?? countUnread(results)));
      setLoaded(true);
      return results;
    } catch (error) {
      if (isAuthenticationError(error)) {
        setNotifications([]);
        setUnreadTotal(0);
        setLoaded(false);
        return [];
      }
      console.error("Erreur chargement notifications:", error);
      throw error;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const markAsRead = useCallback(async (id) => {
    if (!id) return;

    const wasUnread = notifications.some((item) => item.id === id && !item.is_read);
    await notificationService.markAsRead(id);
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, is_read: true } : item)));
    if (wasUnread) {
      setUnreadTotal((value) => Math.max(0, Number(value || 0) - 1));
    }
  }, [notifications]);

  const markAllAsRead = useCallback(async () => {
    await notificationService.markAllAsRead();
    setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
    setUnreadTotal(0);
  }, []);

  const deleteNotifications = useCallback(async (ids = []) => {
    const normalizedIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
    if (!normalizedIds.length) return { deleted: 0, ids: [] };
    const payload = normalizedIds.length === 1
      ? await notificationService.deleteNotification(normalizedIds[0])
      : await notificationService.deleteNotifications(normalizedIds);
    setNotifications((prev) => prev.filter((item) => !normalizedIds.includes(Number(item.id))));
    setUnreadTotal(Number(payload?.unread_count ?? 0));
    return payload;
  }, []);

  useEffect(() => {
    const handleLogin = () => {
      fetchNotifications().catch(() => {});
    };

    const handleRefresh = () => {
      fetchNotifications({ silent: true }).catch(() => {});
    };

    const handleLogout = () => {
      setNotifications([]);
      setUnreadTotal(0);
      setLoaded(false);
    };

    window.addEventListener("mapgeo:login", handleLogin);
    window.addEventListener("mapgeo:logout", handleLogout);
    window.addEventListener("mapgeo:notifications:refresh", handleRefresh);

    if (getStoredTokens()?.access) {
      fetchNotifications().catch(() => {});
    }

    const intervalId = window.setInterval(() => {
      if (getStoredTokens()?.access) {
        fetchNotifications({ silent: true }).catch(() => {});
      }
    }, NOTIFICATION_REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener("mapgeo:login", handleLogin);
      window.removeEventListener("mapgeo:logout", handleLogout);
      window.removeEventListener("mapgeo:notifications:refresh", handleRefresh);
      window.clearInterval(intervalId);
    };
  }, [fetchNotifications]);

  const unreadCount = unreadTotal;

  const value = useMemo(
    () => ({
      notifications,
      loading,
      loaded,
      unreadCount,
      fetchNotifications,
      markAsRead,
      markAllAsRead,
      deleteNotifications,
    }),
    [notifications, loading, loaded, unreadCount, fetchNotifications, markAsRead, markAllAsRead, deleteNotifications],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
