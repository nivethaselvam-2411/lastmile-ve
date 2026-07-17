# Last-Mile: Shared Auto Matcher — PRD

## Overview
Last-Mile is a two-role mobile app (React Native / Expo) that automatically pools passengers travelling the same fixed hub-to-hub route into a shared auto (3 seats) or shared cab (4 seats), splitting the fare equally.

## Roles
1. **Passenger** — request a shared ride between two fixed hubs, get pooled with others, view fare share, driver info, PIN.
2. **Driver** — see incoming pooled ride requests, accept a batch, verify passengers by PIN, complete the ride, view earnings.

## Tech
- Frontend: Expo + Expo Router + TypeScript, react-native-safe-area-context, expo-image, expo-linear-gradient
- Backend: FastAPI + Motor (MongoDB)
- Auth: Simple phone + name (no OTP, MVP style). User stored in AsyncStorage.

## Data model
- `users` — id, name, phone, role (passenger|driver), vehicle_number, created_at
- `hubs` — Chennai seed (Ashok Pillar Metro, Vadapalani, SRM Ramapuram, DLF IT Park, Porur, Guindy, Ekkatuthangal, Alandur, Anna Nagar, Tidel Park)
- `shared_rides` — id, hubs, vehicle_type, capacity, passenger_ids[], driver_id, driver_name, vehicle_number, total_fare, per_passenger_fare, distance_km, status (pending → accepted → completed), verified_passenger_ids[]
- `ride_requests` — id, passenger_id, hubs, vehicle_type, shared_ride_id, fare_share, pin (4 digits), status (searching → matched → in_progress → completed / cancelled)

## Matching algorithm
On request, find a shared_ride with same pickup + dropoff + vehicle_type, status=pending, seats available. If found — join; else create new pool. Recompute per-passenger fare on each join/cancel.

## Fares
Base + per-km (auto: 60 + 15/km, cab: 100 + 22/km). Distance via haversine of hub coordinates.

## Safety
- Fixed public hubs only
- 4-digit PIN each passenger shows the driver at boarding
- Share Trip (native share sheet) + SOS (tel:112)

## Endpoints
- POST /api/auth/register
- GET /api/hubs
- POST /api/rides/request
- GET /api/rides/request/{id} (polling)
- POST /api/rides/request/{id}/cancel
- GET /api/rides/available (driver)
- POST /api/rides/shared/{id}/accept
- POST /api/rides/shared/{id}/verify-pin
- POST /api/rides/shared/{id}/complete
- GET /api/rides/shared/{id}
- GET /api/rides/history/passenger/{id}
- GET /api/rides/history/driver/{id}
