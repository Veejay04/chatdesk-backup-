import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import axiosClient from "./axiosClient";

// Foreground behavior - without this, a notification that arrives while
// the app is open and focused shows nothing at all.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Requests permission and registers this device's Expo push token with the
 * backend. Fails silently (returns without throwing) in every case where
 * push isn't actually usable right now:
 *  - No EAS project configured yet (app.json has no extra.eas.projectId) -
 *    getExpoPushTokenAsync has nothing to build a token against.
 *  - Expo Go on Android (SDK 53+) - remote push is unsupported there
 *    entirely; only a development/production build can receive it.
 *  - Permission denied by the user.
 * None of these should ever surface as an error to the student - the rest
 * of the app works identically whether or not push ends up registered.
 */
export async function registerForPushNotificationsAsync() {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId });

    await axiosClient.post("/notifications/register-device/", { expo_push_token: expoPushToken });
  } catch {
    // Any failure here (no dev build, no EAS project, permission denied,
    // network error) just means this device won't receive push yet.
  }
}
