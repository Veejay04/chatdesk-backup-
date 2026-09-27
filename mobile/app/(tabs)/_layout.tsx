import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import { useTheme } from "../../context/ThemeContext";
import { useTicketBadge } from "../../context/TicketBadgeContext";

// The three destinations a student reaches most often get one-tap access
// here. Everything else (Settings, Profile, SUS Survey, chat History) stays
// behind the hamburger drawer each tab screen still renders, since those
// aren't frequent enough to earn a permanent tab slot.
export default function TabsLayout() {
  const { colors } = useTheme();
  const { unseenCount } = useTicketBadge();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentText,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontFamily: "Montserrat_700Bold", fontSize: 11 },
        // Without this, the tab bar stays reserved at the bottom when the
        // keyboard opens, which throws off each screen's own
        // KeyboardAvoidingView math - the chat input in particular would
        // end up hidden behind the keyboard instead of rising above it.
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => <MaterialIcons name="chat-bubble-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: "Tickets",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="confirmation-number" size={size} color={color} />
          ),
          tabBarBadge: unseenCount > 0 ? unseenCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.errorRed },
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: "Announcements",
          tabBarIcon: ({ color, size }) => <MaterialIcons name="campaign" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
