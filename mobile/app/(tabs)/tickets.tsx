import AsyncStorage from "@react-native-async-storage/async-storage";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NavMenu } from "../../components/nav-menu";
import { SkeletonTicketRow } from "../../components/skeleton";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useTicketBadge } from "../../context/TicketBadgeContext";
import axiosClient from "../../lib/axiosClient";
import type { ThemePalette } from "../../theme/colors";

type Ticket = {
  ticket_id: number;
  subject_category: string;
  issue_description: string;
  status: string;
  resolution: string | null;
  created_at: string;
};

const seenTicketsKey = (userId: number) => `chatdesk_seen_resolved_tickets_${userId}`;

export default function TicketsScreen() {
  const { currentUser, logout } = useAuth();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { setUnseenCount } = useTicketBadge();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewingTicket, setViewingTicket] = useState<Ticket | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const userInitial = currentUser?.first_name?.[0]?.toUpperCase() ?? "?";

  const updateBadgeFromTickets = async (rows: Ticket[]) => {
    if (!currentUser) return;
    let seenIds: number[] = [];
    try {
      const stored = await AsyncStorage.getItem(seenTicketsKey(currentUser.user_id));
      seenIds = stored ? JSON.parse(stored) : [];
    } catch {
      seenIds = [];
    }
    const seenSet = new Set(seenIds);
    const unseen = rows.filter((t) => t.status === "resolved" && !seenSet.has(t.ticket_id)).length;
    setUnseenCount(unseen);
  };

  const loadTickets = async () => {
    try {
      const { data } = await axiosClient.get("/tickets/", { params: { creator: "me" } });
      const rows: Ticket[] = data.results ?? data;
      setTickets(rows);
      setLoadFailed(false);
      updateBadgeFromTickets(rows);
    } catch {
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadTickets();
    setIsRefreshing(false);
  };

  const handleView = async (ticket: Ticket) => {
    Haptics.selectionAsync().catch(() => {});
    setViewingTicket(ticket);

    if (!currentUser) return;
    try {
      const key = seenTicketsKey(currentUser.user_id);
      const stored = await AsyncStorage.getItem(key);
      const seenIds: number[] = stored ? JSON.parse(stored) : [];
      if (!seenIds.includes(ticket.ticket_id)) {
        const next = [...seenIds, ticket.ticket_id];
        await AsyncStorage.setItem(key, JSON.stringify(next));
        if (tickets) updateBadgeFromTickets(tickets);
      }
    } catch {
      // Badge just won't clear for this ticket until next successful write - non-critical.
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => setIsMenuOpen(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <MaterialIcons name="menu" size={26} color={colors.accentText} />
        </Pressable>
        <Text style={styles.title}>Tickets</Text>
        <Pressable
          onPress={() => router.push("/profile")}
          hitSlop={12}
          style={styles.avatar}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
        >
          {currentUser?.profile_picture ? (
            <Image source={{ uri: currentUser.profile_picture }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{userInitial}</Text>
          )}
        </Pressable>
      </View>

      {loadFailed ? (
        <ScrollView
          contentContainerStyle={styles.centerStateContainer}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accentText} />}
        >
          <Text style={styles.centerState}>
            {"Tickets aren't available yet - please check back soon."}
          </Text>
        </ScrollView>
      ) : tickets === null ? (
        <View>
          <View style={styles.columnHeaderRow}>
            <Text style={[styles.columnHeader, styles.labelColumn]} />
            <Text style={[styles.columnHeader, styles.statusColumn]}>Status</Text>
            <Text style={[styles.columnHeader, styles.actionColumn]}>Action</Text>
          </View>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonTicketRow key={i} />
          ))}
        </View>
      ) : tickets.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyStateContainer}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accentText} />}
        >
          <View style={styles.emptyIconCircle}>
            <MaterialIcons name="check-circle-outline" size={36} color={colors.accentText} />
          </View>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.centerState}>Nothing to resolve right now - ask ChatDesk anything to get started.</Text>
        </ScrollView>
      ) : (
        <>
          <View style={styles.columnHeaderRow}>
            <Text style={[styles.columnHeader, styles.labelColumn]} />
            <Text style={[styles.columnHeader, styles.statusColumn]}>Status</Text>
            <Text style={[styles.columnHeader, styles.actionColumn]}>Action</Text>
          </View>
          <ScrollView
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accentText} />}
          >
            {tickets.map((ticket) => {
              const isResolved = ticket.status === "resolved";
              return (
                <View key={ticket.ticket_id} style={styles.row}>
                  <Text style={[styles.rowLabel, styles.labelColumn]}>Ticket {ticket.ticket_id}</Text>
                  <View style={styles.statusColumn}>
                    {isResolved ? (
                      <MaterialIcons name="check" size={20} color={colors.textPrimary} />
                    ) : (
                      <Text style={styles.pendingText}>Pending</Text>
                    )}
                  </View>
                  <View style={styles.actionColumn}>
                    <Pressable
                      style={[styles.viewButton, !isResolved && styles.viewButtonDisabled]}
                      onPress={() => handleView(ticket)}
                      disabled={!isResolved}
                    >
                      <Text style={[styles.viewButtonText, !isResolved && styles.viewButtonTextDisabled]}>
                        View
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}

      <Modal
        visible={viewingTicket !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingTicket(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setViewingTicket(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            {viewingTicket ? (
              <>
                <View style={styles.modalHeader}>
                  <View style={styles.modalHeaderText}>
                    <Text style={styles.modalEyebrow}>Ticket {viewingTicket.ticket_id}</Text>
                    <Text style={styles.modalTitle}>{viewingTicket.subject_category}</Text>
                  </View>
                  <View style={styles.modalStatusBadge}>
                    <MaterialIcons name="check-circle" size={14} color={colors.accentText} />
                    <Text style={styles.modalStatusText}>Resolved</Text>
                  </View>
                </View>

                <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                  <Text style={styles.modalSectionLabel}>You asked</Text>
                  <Text style={styles.modalSectionText}>{viewingTicket.issue_description}</Text>

                  <Text style={[styles.modalSectionLabel, styles.modalSectionLabelSpaced]}>Answer</Text>
                  <Text style={styles.modalSectionText}>
                    {viewingTicket.resolution ?? "No response yet."}
                  </Text>
                </ScrollView>

                <Pressable style={styles.modalCloseButton} onPress={() => setViewingTicket(null)}>
                  <Text style={styles.modalCloseButtonText}>Close</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <NavMenu
        visible={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        userInitial={userInitial}
        onLogout={logout}
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    title: { fontSize: 20, fontFamily: "PlusJakartaSans_700Bold", color: colors.textPrimary },
    avatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.accentText,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      overflow: "hidden",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 3,
      elevation: 2,
    },
    avatarImage: { width: 30, height: 30 },
    avatarText: { fontFamily: "Montserrat_700Bold", color: colors.accentText, fontSize: 12 },
    centerStateContainer: { flexGrow: 1, justifyContent: "center" },
    centerState: {
      marginTop: 8,
      textAlign: "center",
      color: colors.textSecondary,
      fontFamily: "Montserrat_400Regular",
      fontSize: 14,
      paddingHorizontal: 24,
    },
    emptyStateContainer: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
    emptyIconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.accent + "1A",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    emptyTitle: {
      fontFamily: "PlusJakartaSans_700Bold",
      fontSize: 17,
      color: colors.textPrimary,
      marginBottom: 4,
    },
    columnHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    columnHeader: {
      fontFamily: "Montserrat_700Bold",
      fontSize: 15,
      color: colors.textPrimary,
      textAlign: "center",
    },
    labelColumn: { flex: 1.1 },
    statusColumn: { flex: 1, alignItems: "center" },
    actionColumn: { flex: 1, alignItems: "center" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowLabel: { fontFamily: "Montserrat_400Regular", fontSize: 15, color: colors.textPrimary },
    pendingText: { fontFamily: "Montserrat_400Regular", fontSize: 14, color: colors.textSecondary },
    viewButton: {
      borderWidth: 1,
      borderColor: colors.textPrimary,
      borderRadius: 16,
      paddingVertical: 6,
      paddingHorizontal: 16,
    },
    viewButtonDisabled: { borderColor: colors.border },
    viewButtonText: { fontFamily: "Montserrat_700Bold", fontSize: 13, color: colors.textPrimary },
    viewButtonTextDisabled: { color: colors.textMuted },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
    },
    modalCard: {
      width: "100%",
      maxWidth: 420,
      maxHeight: "75%",
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 20,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 20,
      elevation: 10,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 16,
    },
    modalHeaderText: { flex: 1 },
    modalEyebrow: {
      fontFamily: "Montserrat_400Regular",
      fontSize: 12,
      color: colors.textMuted,
      marginBottom: 2,
    },
    modalTitle: {
      fontFamily: "PlusJakartaSans_700Bold",
      fontSize: 19,
      color: colors.textPrimary,
    },
    modalStatusBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.accent + "1A",
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    modalStatusText: {
      fontFamily: "Montserrat_700Bold",
      fontSize: 12,
      color: colors.accentText,
    },
    modalBody: { marginBottom: 16 },
    modalSectionLabel: {
      fontFamily: "Montserrat_700Bold",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.4,
      color: colors.textSecondary,
      marginBottom: 6,
    },
    modalSectionLabelSpaced: { marginTop: 16 },
    modalSectionText: {
      fontFamily: "Montserrat_400Regular",
      fontSize: 15,
      lineHeight: 21,
      color: colors.textPrimary,
    },
    modalCloseButton: {
      backgroundColor: colors.accent,
      borderRadius: 14,
      paddingVertical: 13,
      alignItems: "center",
    },
    modalCloseButtonText: {
      fontFamily: "Montserrat_700Bold",
      fontSize: 15,
      color: colors.white,
    },
  });
