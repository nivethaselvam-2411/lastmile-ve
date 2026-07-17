import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Share, Alert, Platform, Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FS, SHADOW } from "@/src/theme";
import { api, type RideRequest, type SharedRide } from "@/src/api";

export default function MatchingScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const router = useRouter();
  const [rr, setRr] = useState<RideRequest | null>(null);
  const [sr, setSr] = useState<SharedRide | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    let timer: any;
    const tick = async () => {
      try {
        const data = await api.getRequest(String(requestId));
        if (!alive) return;
        setRr(data.request);
        setSr(data.shared_ride);
        setErr(null);
      } catch (e: any) {
        setErr(e.message);
      }
      timer = setTimeout(tick, 2500);
    };
    tick();
    const el = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(el);
    };
  }, [requestId]);

  const cancel = async () => {
    if (!rr) return;
    setCancelling(true);
    try {
      await api.cancelRequest(rr.id);
      router.replace("/passenger");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setCancelling(false);
    }
  };

  const shareTrip = async () => {
    if (!sr) return;
    const msg = `I'm on a Last-Mile shared ride 🚕
From: ${sr.pickup?.name}
To: ${sr.dropoff?.name}
Driver: ${sr.driver_name || "assigning..."}
Vehicle: ${sr.vehicle_number || "TBA"}
Passengers on board: ${sr.passenger_ids.length}/${sr.capacity}`;
    try {
      await Share.share({ message: msg });
    } catch {}
  };

  const sos = () => {
    Alert.alert(
      "SOS – Contact emergency?",
      "This will attempt to call 112 (India emergency).",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Call 112",
          style: "destructive",
          onPress: () => Linking.openURL(`tel:112`).catch(() => {}),
        },
      ]
    );
  };

  if (!rr && !err) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={COLORS.brandPrimary} />
      </SafeAreaView>
    );
  }

  if (rr?.status === "completed") {
    return (
      <SafeAreaView style={styles.doneRoot} edges={["top", "bottom"]}>
        <View style={styles.doneIcon}>
          <Ionicons name="checkmark" size={44} color="#fff" />
        </View>
        <Text style={styles.doneTitle}>Ride Complete</Text>
        <Text style={styles.doneSub}>Hope you had a smooth trip!</Text>
        <Text style={styles.doneFare}>Fare paid: ₹{rr.fare_share}</Text>
        <Pressable
          testID="back-to-home-btn"
          onPress={() => router.replace("/passenger")}
          style={[styles.cta, { backgroundColor: COLORS.brandPrimary, marginTop: SPACING.xl }]}
        >
          <Text style={styles.ctaTxt}>Back to Home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const searching = rr?.status === "searching" || rr?.status === "matched";
  const active = rr?.status === "in_progress";
  const filled = sr?.passenger_ids.length || 0;
  const cap = sr?.capacity || 3;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="matching-back-btn" onPress={() => router.replace("/passenger")}>
          <Ionicons name="chevron-back" size={26} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {searching ? "Finding your ride" : active ? "Ride Confirmed" : "Ride"}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Route timeline */}
        {sr && (
          <View style={styles.card}>
            <TimelineRow
              dotColor={COLORS.brandPrimary}
              label="PICKUP"
              value={sr.pickup?.name || "-"}
              sub={sr.pickup?.area}
              testID="route-pickup"
            />
            <View style={styles.timelineLine} />
            <TimelineRow
              dotColor={COLORS.brandSecondary}
              label="DROP-OFF"
              value={sr.dropoff?.name || "-"}
              sub={sr.dropoff?.area}
              testID="route-dropoff"
            />
          </View>
        )}

        {/* Searching state */}
        {searching && (
          <View style={styles.card} testID="matching-state">
            <View style={styles.searchTop}>
              <ActivityIndicator color={COLORS.brandPrimary} size="small" />
              <Text style={styles.searchTitle}>
                {rr?.status === "matched"
                  ? `${filled} rider${filled > 1 ? "s" : ""} pooled — looking for a driver`
                  : "Finding riders near you..."}
              </Text>
            </View>
            <Text style={styles.searchSub}>
              Elapsed {elapsed}s · {cap - filled} more seat{cap - filled === 1 ? "" : "s"} available
            </Text>
            <View style={styles.dotsRow}>
              {Array.from({ length: cap }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.capDot,
                    { backgroundColor: i < filled ? COLORS.brandPrimary : COLORS.surfaceTertiary },
                  ]}
                />
              ))}
            </View>
          </View>
        )}

        {/* Active ride state */}
        {active && sr && (
          <>
            <View style={styles.card} testID="driver-info">
              <View style={styles.driverRow}>
                <View style={styles.driverAvatar}>
                  <Ionicons name="person" size={28} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{sr.driver_name}</Text>
                  <Text style={styles.vehicleNum}>{sr.vehicle_number}</Text>
                </View>
                <View style={styles.vehiclePill}>
                  <Ionicons
                    name={sr.vehicle_type === "auto" ? "bicycle" : "car"}
                    size={16}
                    color={COLORS.onBrandTertiary}
                  />
                  <Text style={styles.vehiclePillTxt}>
                    {sr.vehicle_type === "auto" ? "Auto" : "Cab"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.pinCard} testID="pin-display">
              <Text style={styles.pinLabel}>Your Ride PIN</Text>
              <Text style={styles.pinCode}>{rr?.pin}</Text>
              <Text style={styles.pinHint}>Show this to your driver when boarding</Text>
            </View>
          </>
        )}

        {/* Fare + capacity */}
        {sr && (
          <View style={styles.card}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Your fare share</Text>
              <Text style={styles.fareValue}>₹{rr?.fare_share || sr.per_passenger_fare}</Text>
            </View>
            <Text style={styles.fareBreakdown}>
              Total ₹{sr.total_fare} · {sr.distance_km} km · Split across {filled}{" "}
              {filled === 1 ? "rider" : "riders"}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomBar}>
        {active ? (
          <>
            <Pressable testID="share-trip-btn" style={[styles.actionBtn, styles.actionSecondary]} onPress={shareTrip}>
              <Ionicons name="share-social" size={18} color={COLORS.onSurface} />
              <Text style={styles.actionSecondaryTxt}>Share Trip</Text>
            </Pressable>
            <Pressable testID="sos-btn" style={[styles.actionBtn, styles.actionSos]} onPress={sos}>
              <Ionicons name="warning" size={18} color="#fff" />
              <Text style={styles.actionSosTxt}>SOS</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            testID="cancel-ride-btn"
            style={[styles.actionBtn, styles.actionCancel]}
            onPress={cancel}
            disabled={cancelling}
          >
            {cancelling ? (
              <ActivityIndicator color={COLORS.error} />
            ) : (
              <>
                <Ionicons name="close" size={20} color={COLORS.error} />
                <Text style={styles.actionCancelTxt}>Cancel Search</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function TimelineRow({ dotColor, label, value, sub, testID }: any) {
  return (
    <View style={styles.tlRow} testID={testID}>
      <View style={[styles.tlDot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.tlLabel}>{label}</Text>
        <Text style={styles.tlValue}>{value}</Text>
        {sub && <Text style={styles.tlSub}>{sub}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surfaceSecondary },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface },
  header: {
    height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  headerTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface },
  body: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxxl },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, ...SHADOW.card },
  tlRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  tlDot: { width: 14, height: 14, borderRadius: 7 },
  tlLabel: { fontSize: 10, color: COLORS.onSurfaceTertiary, letterSpacing: 1, fontWeight: "700" },
  tlValue: { fontSize: FS.lg, color: COLORS.onSurface, fontWeight: "700", marginTop: 2 },
  tlSub: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  timelineLine: { width: 2, height: 22, backgroundColor: COLORS.borderStrong, marginLeft: 6, marginVertical: 4 },
  searchTop: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  searchTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface, flex: 1 },
  searchSub: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 6 },
  dotsRow: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md },
  capDot: { width: 14, height: 14, borderRadius: 7 },
  driverRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  driverAvatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.brandSecondary,
    alignItems: "center", justifyContent: "center",
  },
  driverName: { fontSize: FS.xl, fontWeight: "700", color: COLORS.onSurface },
  vehicleNum: { fontSize: FS.base, color: COLORS.onSurfaceSecondary, marginTop: 2, letterSpacing: 1 },
  vehiclePill: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: SPACING.md,
    paddingVertical: 6, backgroundColor: COLORS.brandTertiary, borderRadius: RADIUS.pill,
  },
  vehiclePillTxt: { color: COLORS.onBrandTertiary, fontWeight: "700", fontSize: FS.sm },
  pinCard: {
    backgroundColor: COLORS.brandPrimary, borderRadius: RADIUS.lg,
    padding: SPACING.xl, alignItems: "center",
  },
  pinLabel: { color: "rgba(255,255,255,0.9)", fontSize: FS.sm, fontWeight: "700", letterSpacing: 2 },
  pinCode: { color: "#fff", fontSize: 56, fontWeight: "800", letterSpacing: 12, marginTop: SPACING.sm },
  pinHint: { color: "rgba(255,255,255,0.9)", fontSize: FS.sm, marginTop: SPACING.md, textAlign: "center" },
  fareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fareLabel: { fontSize: FS.base, color: COLORS.onSurfaceSecondary, fontWeight: "600" },
  fareValue: { fontSize: FS.xxl, color: COLORS.onSurface, fontWeight: "800" },
  fareBreakdown: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 6 },
  bottomBar: {
    flexDirection: "row", gap: SPACING.md, padding: SPACING.lg,
    borderTopWidth: 1, borderTopColor: COLORS.divider, backgroundColor: COLORS.surface,
  },
  actionBtn: {
    flex: 1, height: 52, borderRadius: RADIUS.pill, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: SPACING.sm,
  },
  actionSecondary: { backgroundColor: COLORS.surfaceSecondary },
  actionSecondaryTxt: { color: COLORS.onSurface, fontSize: FS.base, fontWeight: "700" },
  actionSos: { backgroundColor: COLORS.error },
  actionSosTxt: { color: "#fff", fontSize: FS.base, fontWeight: "700" },
  actionCancel: { borderWidth: 1.5, borderColor: COLORS.error, backgroundColor: COLORS.surface },
  actionCancelTxt: { color: COLORS.error, fontSize: FS.base, fontWeight: "700" },
  doneRoot: { flex: 1, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  doneIcon: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: COLORS.success,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.lg,
  },
  doneTitle: { fontSize: FS.xxl, fontWeight: "800", color: COLORS.onSurface },
  doneSub: { fontSize: FS.base, color: COLORS.onSurfaceSecondary, marginTop: SPACING.sm },
  doneFare: { fontSize: FS.xl, fontWeight: "700", color: COLORS.brandPrimary, marginTop: SPACING.md },
  cta: {
    height: 54, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.xl,
    alignItems: "center", justifyContent: "center", flexDirection: "row",
  },
  ctaTxt: { color: "#fff", fontSize: FS.lg, fontWeight: "700" },
});
