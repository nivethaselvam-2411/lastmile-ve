const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = `${BASE}/api${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export type User = {
  id: string;
  name: string;
  phone: string;
  role: "passenger" | "driver";
  vehicle_number?: string | null;
  created_at: string;
};

export type Hub = { id: string; name: string; area: string; lat: number; lng: number };

export type SharedRide = {
  id: string;
  pickup_hub_id: string;
  dropoff_hub_id: string;
  vehicle_type: "auto" | "cab";
  capacity: number;
  passenger_ids: string[];
  distance_km: number;
  total_fare: number;
  per_passenger_fare: number;
  status: "pending" | "accepted" | "completed" | "cancelled";
  driver_id: string | null;
  driver_name: string | null;
  vehicle_number: string | null;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  verified_passenger_ids: string[];
  pickup?: Hub;
  dropoff?: Hub;
  passengers?: (User & { pin: string })[];
};

export type RideRequest = {
  id: string;
  passenger_id: string;
  pickup_hub_id: string;
  dropoff_hub_id: string;
  vehicle_type: "auto" | "cab";
  status: "searching" | "matched" | "in_progress" | "completed" | "cancelled";
  shared_ride_id: string;
  fare_share: number;
  pin: string;
  created_at: string;
};

export const api = {
  register: (b: { name: string; phone: string; role: "passenger" | "driver"; vehicle_number?: string }) =>
    req<User>("/auth/register", { method: "POST", body: JSON.stringify(b) }),
  getUser: (id: string) => req<User>(`/users/${id}`),
  hubs: () => req<Hub[]>("/hubs"),
  requestRide: (b: {
    passenger_id: string;
    pickup_hub_id: string;
    dropoff_hub_id: string;
    vehicle_type: "auto" | "cab";
  }) => req<RideRequest>("/rides/request", { method: "POST", body: JSON.stringify(b) }),
  getRequest: (id: string) =>
    req<{ request: RideRequest; shared_ride: SharedRide | null }>(`/rides/request/${id}`),
  cancelRequest: (id: string) => req(`/rides/request/${id}/cancel`, { method: "POST" }),
  availableRides: () => req<SharedRide[]>("/rides/available"),
  acceptRide: (rideId: string, driverId: string) =>
    req<SharedRide>(`/rides/shared/${rideId}/accept`, {
      method: "POST",
      body: JSON.stringify({ driver_id: driverId }),
    }),
  verifyPin: (rideId: string, passenger_id: string, pin: string) =>
    req(`/rides/shared/${rideId}/verify-pin`, {
      method: "POST",
      body: JSON.stringify({ passenger_id, pin }),
    }),
  completeRide: (rideId: string) =>
    req<SharedRide>(`/rides/shared/${rideId}/complete`, { method: "POST" }),
  sharedRide: (id: string) => req<SharedRide>(`/rides/shared/${id}`),
  passengerHistory: (id: string) =>
    req<{ request: RideRequest; shared_ride: SharedRide | null }[]>(`/rides/history/passenger/${id}`),
  driverHistory: (id: string) => req<SharedRide[]>(`/rides/history/driver/${id}`),
};
