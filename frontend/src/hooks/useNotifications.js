import { useContext } from "react";
import { NotificationContext } from "../context/NotificationContext";

export default function useNotifications() {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error(
      "useNotifications doit être utilisé dans un NotificationProvider.",
    );
  }

  return context;
}
