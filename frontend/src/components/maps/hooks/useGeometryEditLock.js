import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LOCK_TTL_MS = 2 * 60 * 1000;
const RENEW_EVERY_MS = 30 * 1000;

function getSessionEditorId() {
  const key = "mapgeo:geometry-editor-session";
  let value = localStorage.getItem(key);
  if (!value) {
    value = `editor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function readLock(lockKey) {
  try {
    const lock = JSON.parse(localStorage.getItem(lockKey) || "null");
    if (!lock) return null;
    if (Number(lock.expiresAt) < Date.now()) {
      localStorage.removeItem(lockKey);
      return null;
    }
    return lock;
  } catch {
    localStorage.removeItem(lockKey);
    return null;
  }
}

export default function useGeometryEditLock(parcelId, enabled = true) {
  const ownerId = useMemo(() => getSessionEditorId(), []);
  const lockKey = `mapgeo:parcel-geometry-lock:${parcelId || "new"}`;
  const [lock, setLock] = useState(() => readLock(lockKey));
  const channelRef = useRef(null);

  const isOwnedByMe = lock?.ownerId === ownerId;
  const isLockedByOther = Boolean(enabled && lock && !isOwnedByMe);

  const publish = useCallback((nextLock) => {
    try {
      channelRef.current?.postMessage({ lockKey, lock: nextLock });
    } catch {
      // BroadcastChannel can be unavailable in older browsers.
    }
  }, [lockKey]);

  const refreshLock = useCallback(() => {
    const nextLock = readLock(lockKey);
    setLock(nextLock);
    return nextLock;
  }, [lockKey]);

  const acquireLock = useCallback(() => {
    if (!enabled) return { ok: false, reason: "lock-disabled" };

    const currentLock = readLock(lockKey);
    if (currentLock && currentLock.ownerId !== ownerId) {
      setLock(currentLock);
      return { ok: false, reason: "locked", lock: currentLock };
    }

    const nextLock = {
      ownerId,
      ownerLabel: "Utilisateur actif",
      parcelId: parcelId || "new",
      startedAt: currentLock?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: Date.now() + LOCK_TTL_MS,
    };

    localStorage.setItem(lockKey, JSON.stringify(nextLock));
    setLock(nextLock);
    publish(nextLock);
    return { ok: true, lock: nextLock };
  }, [enabled, lockKey, ownerId, parcelId, publish]);

  const releaseLock = useCallback(() => {
    const currentLock = readLock(lockKey);
    if (currentLock?.ownerId === ownerId) {
      localStorage.removeItem(lockKey);
      setLock(null);
      publish(null);
    }
  }, [lockKey, ownerId, publish]);

  useEffect(() => {
    if (!enabled) return undefined;

    refreshLock();

    const handleStorage = (event) => {
      if (event.key === lockKey) refreshLock();
    };

    window.addEventListener("storage", handleStorage);

    if ("BroadcastChannel" in window) {
      channelRef.current = new BroadcastChannel("mapgeo:geometry-locks");
      channelRef.current.onmessage = (event) => {
        if (event.data?.lockKey === lockKey) refreshLock();
      };
    }

    return () => {
      window.removeEventListener("storage", handleStorage);
      channelRef.current?.close?.();
      channelRef.current = null;
    };
  }, [enabled, lockKey, refreshLock]);

  useEffect(() => {
    if (!enabled || !isOwnedByMe) return undefined;

    const interval = window.setInterval(() => {
      const currentLock = readLock(lockKey);
      if (currentLock?.ownerId !== ownerId) {
        setLock(currentLock);
        return;
      }

      const renewed = {
        ...currentLock,
        updatedAt: new Date().toISOString(),
        expiresAt: Date.now() + LOCK_TTL_MS,
      };
      localStorage.setItem(lockKey, JSON.stringify(renewed));
      setLock(renewed);
      publish(renewed);
    }, RENEW_EVERY_MS);

    return () => window.clearInterval(interval);
  }, [enabled, isOwnedByMe, lockKey, ownerId, publish]);

  useEffect(() => releaseLock, [releaseLock]);

  return {
    lock,
    isOwnedByMe,
    isLockedByOther,
    acquireLock,
    releaseLock,
    refreshLock,
  };
}
