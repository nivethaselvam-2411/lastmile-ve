import { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, Modal, ActivityIndicator, FlatList,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FS, IMAGES, SHADOW } from "@/src/theme";
import { api, type Hub } from "@/src/api";
import { useUser, clearStoredUser } from "@/src/hooks/use-user";

type VehicleType = "auto" | "cab";

export default function PassengerHome() {
  const router = useRouter();
  const { user, loading: userLoading, setUser } = useUser();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [pickup, setPickup] = useState<Hub | null>(null);
  const [dropoff, setDropoff] = useState<Hub | null>(null);
  const [vehicle, setVehicle] = useState<VehicleType>("auto");
  const [picker, setPicker] = useState<"pickup" | "dropoff" | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!userLoading && (!user || user.role !== "passenger")) router.replace("/onboarding");
  }, [user, userLoading]);

  useEffect(() => {
    api.hubs().then(setHubs).catch(() => {});
  }, []);

  const canFind = pickup && dropoff && pickup.id !== dropoff.id && !!user;

  const findRide = async () => {
    if (!canFind || !user) return;
    setErr(null);
    setRequesting(true);
    try {
      const rr = await api.requestRide({
        passenger_id: user.id,
        pickup_hub_id: pickup!.id,
        dropoff_hub_id: dropoff!.id,
        vehicle_type: vehicle,
      });
      router.push({ pathname: "/passenger/matching", params: { requestId: rr.id } });
    } catch (e: any) {
      setErr(e.message || "Failed");
    } finally {
      setRequesting(false);
    }
  };

  const logout = async () => {
    await clearStoredUser();
    router.replace("/onboarding");
  };

  return (
    <View style={styles.root} testID="passenger-home">
      <View style={styles.hero}>
        <Image source={IMAGES.passengerBg} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["rgba(16,185,129,0.35)", "rgba(17,24,39,0.65)"]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={["top"]} style={styles.heroInner}>
          <View style={styles.topRow}>
            <View>
              <Text style={styles.hello}>Hi {user?.name?.split(" ")[0] || "there"} 👋</Text>
              <Text style={styles.subline}>Where are you headed?</Text>
            </View>
            <View style={{ flexDirection: "row", gap: SPACING.sm }}>
              <Pressable
                testID="passenger-history-btn"
                onPress={() => router.push("/passenger/history")}
                style={styles.iconBtn}
              >
                <Ionicons name="time-outline" size={20} color="#fff" />
              </Pressable>
              <Pressable testID="passenger-logout-btn" onPress={logout} style={styles.iconBtn}>
                <Ionicons name="log-out-outline" size={20} color="#fff" />
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <ScrollView contentContainerStyle={styles.sheetInner} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionTitle}>Choose your route</Text>

          <Pressable
            testID="pickup-selector"
            onPress={() => setPicker("pickup")}
            style={styles.hubRow}
          >
            <View style={[styles.hubDot, { backgroundColor: COLORS.brandPrimary }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.hubLabel}>Pickup hub</Text>
              <Text style={styles.hubValue} numberOfLines={1}>
                {pickup ? pickup.name : "Select pickup"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.onSurfaceTertiary} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            testID="dropoff-selector"
            onPress={() => setPicker("dropoff")}
            style={styles.hubRow}
          >
            <View style={[styles.hubDot, { backgroundColor: COLORS.brandSecondary }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.hubLabel}>Drop-off hub</Text>
              <Text style={styles.hubValue} numberOfLines={1}>
                {dropoff ? dropoff.name : "Select drop-off"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.onSurfaceTertiary} />
          </Pressable>

          <Text style={[styles.sectionTitle, { marginTop: SPACING.xl }]}>Vehicle preference</Text>
          <View style={styles.vehicleRow}>
            <VehicleChip
              active={vehicle === "auto"}
              onPress={() => setVehicle("auto")}
              icon="bicycle"
              title="Share Auto"
              sub="Up to 3 riders · ₹60 + ₹15/km"
              testID="vehicle-auto"
            />
            <VehicleChip
              active={vehicle === "cab"}
              onPress={() => setVehicle("cab")}
              icon="car"
              title="Share Cab"
              sub="Up to 4 riders · ₹100 + ₹22/km"
              testID="vehicle-cab"
            />
          </View>

          {err && (
            <Text testID="passenger-home-error" style={styles.error}>
              {err}
            </Text>
          )}

          <Pressable
            testID="find-ride-btn"
            disabled={!canFind || requesting}
            onPress={findRide}
            style={[
              styles.cta,
              { backgroundColor: canFind ? COLORS.brandPrimary : COLORS.borderStrong },
            ]}
          >
            {requesting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="git-merge" size={20} color="#fff" />
                <Text style={styles.ctaTxt}>Find Shared Ride</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.tinyFoot}>
            We'll pool you with other riders going the same way. Fare splits automatically.
          </Text>
        </ScrollView>
      </View>

      <Modal
        visible={picker !== null}
        animationType="slide"
        onRequestClose={() => setPicker(null)}
        transparent
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPicker(null)} />
        <View style={styles.pickerSheet} testID="hub-picker">
          <View style={styles.sheetHandle} />
          <Text style={styles.pickerTitle}>
            {picker === "pickup" ? "Select pickup hub" : "Select drop-off hub"}
          </Text>
          <FlatList
            data={hubs}
            keyExtractor={(h) => h.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item }) => {
              const disabled =
                (picker === "pickup" && dropoff?.id === item.id) ||
                (picker === "dropoff" && pickup?.id === item.id);
              return (
                <Pressable
                  testID={`hub-${item.id}`}
                  disabled={disabled}
                  onPress={() => {
                    if (picker === "pickup") setPickup(item);
                    else setDropoff(item);
                    setPicker(null);
                  }}
                  style={[styles.pickerRow, disabled && { opacity: 0.35 }]}
                >
                  <View style={styles.pickerIcon}>
                    <Ionicons name="location" size={18} color={COLORS.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerName}>{item.name}</Text>
                    <Text style={styles.pickerArea}>{item.area}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

function VehicleChip({ active, onPress, icon, title, sub, testID }: any) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[
        styles.vChip,
        active && { borderColor: COLORS.brandPrimary, backgroundColor: COLORS.brandTertiary },
      ]}
    >
      <View
        style={[
          styles.vIconWrap,
          { backgroundColor: active ? COLORS.brandPrimary : COLORS.surfaceSecondary },
        ]}
      >
        <Ionicons name={icon} size={20} color={active ? "#fff" : COLORS.onSurfaceSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.vTitle, active && { color: COLORS.onBrandTertiary }]}>{title}</Text>
        <Text style={styles.vSub}>{sub}</Text>
      </View>
      {active && <Ionicons name="checkmark-circle" size={22} color={COLORS.brandPrimary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.surface },
  hero: { height: 260, backgroundColor: COLORS.brandSecondary, overflow: "hidden" },
  heroInner: { flex: 1, padding: SPACING.lg },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  hello: { color: "#fff", fontSize: FS.xxl, fontWeight: "800" },
  subline: { color: "rgba(255,255,255,0.85)", fontSize: FS.base, marginTop: 4 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center", justifyContent: "center",
  },
  sheet: {
    flex: 1, backgroundColor: COLORS.surface, marginTop: -24,
    borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: SPACING.md,
  },
  sheetHandle: {
    width: 44, height: 5, borderRadius: 3, backgroundColor: COLORS.surfaceTertiary,
    alignSelf: "center", marginBottom: SPACING.md,
  },
  sheetInner: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  sectionTitle: { fontSize: FS.base, fontWeight: "700", color: COLORS.onSurfaceSecondary, marginBottom: SPACING.md },
  hubRow: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    paddingVertical: SPACING.md,
  },
  hubDot: { width: 12, height: 12, borderRadius: 6 },
  hubLabel: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginBottom: 2 },
  hubValue: { fontSize: FS.lg, color: COLORS.onSurface, fontWeight: "600" },
  divider: { height: 1, backgroundColor: COLORS.divider, marginLeft: 28 },
  vehicleRow: { gap: SPACING.md, marginBottom: SPACING.md },
  vChip: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md,
    borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  vIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  vTitle: { fontSize: FS.lg, fontWeight: "700", color: COLORS.onSurface },
  vSub: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
  cta: {
    marginTop: SPACING.lg, height: 54, borderRadius: RADIUS.pill,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    ...SHADOW.card,
  },
  ctaTxt: { color: "#fff", fontSize: FS.lg, fontWeight: "700" },
  error: { color: COLORS.error, fontSize: FS.sm, marginTop: SPACING.sm, textAlign: "center" },
  tinyFoot: { textAlign: "center", color: COLORS.onSurfaceTertiary, fontSize: FS.sm, marginTop: SPACING.md },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  pickerSheet: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: SPACING.lg, maxHeight: "70%", paddingTop: SPACING.md,
  },
  pickerTitle: { fontSize: FS.xl, fontWeight: "800", color: COLORS.onSurface, marginBottom: SPACING.md },
  pickerRow: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  pickerIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  pickerName: { fontSize: FS.lg, fontWeight: "600", color: COLORS.onSurface },
  pickerArea: { fontSize: FS.sm, color: COLORS.onSurfaceTertiary, marginTop: 2 },
});
